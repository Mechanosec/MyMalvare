# credsScrapper: expanded detection, key validity testing, status filter, and leak-commit dedup

## Context

credsScrapper (NestJS hexagonal backend `apps/api` + Next.js frontend `apps/web`) discovers GitHub repos, scans them for leaked secrets, and lists findings. Today:

- Detection is a flat list of independent regex patterns (`ESecretType` + `PATTERNS`), no notion of paired keys.
- `Finding` rows have no validity/status field — every match is permanently "new."
- The same secret found both in the HEAD tree (path-based) and in git history (`git log -p` diff-based) is stored as separate, unrelated `Finding` rows — no dedup, no record of which commit introduced the leak.
- Discovery and scan progress stream to the frontend via a shared `ProgressPort` → `InMemoryJobRunner` → WebSocket (`job:${jobId}` channel) with `GET /jobs/:id` HTTP polling as fallback. The frontend has three tabs (Overview, Findings, Repositories) driven by plain client state in `dashboard.tsx`.

## Goals

1. Detect more secret types, including paired public/private key material (e.g. AWS access key ID + secret access key), by adding regex patterns — no new "pairing" data model, each type stays an independent pattern.
2. Add a "Testing" tab: pick a repo, review its findings' keys one by one, and record a validity verdict for each — a human-in-the-loop workflow, not an automated prober.
3. Persist a validity status (`valid` / `invalid` / `unknown`) per finding; surface it as a badge and filter on the Findings page.
4. Deduplicate findings for the same secret value within a repo: keep one row, prefer path-based location data over the git-diff placeholder, and record every commit where the secret appears (for a future leak-timeline graph — out of scope here).

## Non-goals

- No cross-key "pairing" data model (public+private are just two independent `ESecretType`s).
- No leak-timeline graph/visualization — only the data (`leakCommits`) this needs.
- **No automated live validation against third-party services.** `credsScrapper` discovers repos from the public GH Archive event stream — i.e. third parties' repos, not just the user's own. `CLAUDE.md`'s standing rule ("Detection is passive, always. Never add a network call that authenticates as a credential this tool found") exists precisely to keep the tool from authenticating to a live service using a credential it scraped from someone else's repo without that owner's authorization — doing so would be unauthorized access to a third-party system, not a defensive-security action. "Testing" is therefore a **manual, human-recorded verdict**, not an automated prober; the tool never dials out with a found secret.

## 1. Expanded detection patterns

Add to `ESecretType` / `PATTERNS` / `DESCRIPTIONS` (backend `domain/constant`, `domain/detection`) and mirror in `apps/web/src/lib/constant/secret-type.constant.ts`, one test per type, following the existing `add-scan-pattern` skill. Every addition has a genuine fixed, vendor-documented prefix/marker — consistent with `patterns.ts`'s own rule that a pattern matches the token itself with no surrounding context required, so a bespoke AWS-secret-key regex and several other "obvious" popular-service candidates (Heroku, Datadog, CircleCI, Algolia, Segment, Auth0, Vercel, a generic Azure AD client secret) were deliberately excluded: their real tokens are bare hex/base64/UUID strings with no fixed shape, which would either flood false positives or rely on nearby text context — exactly what `GENERIC_HIGH_ENTROPY` already exists to catch instead.

- `OPENSSH_PRIVATE_KEY`, `PGP_PRIVATE_KEY_BLOCK` — the "private half" of a pair, distinct from the existing generic `PRIVATE_KEY_PEM`
- `GCP_SERVICE_ACCOUNT_KEY` — JSON-embedded private key credentials file
- `AZURE_STORAGE_ACCOUNT_KEY`
- `NEW_RELIC_API_KEY`, `POSTMAN_API_KEY`, `DATABRICKS_TOKEN`, `NOTION_API_TOKEN`, `TERRAFORM_CLOUD_TOKEN`, `LINEAR_API_KEY`, `SENTRY_AUTH_TOKEN`, `FIGMA_PERSONAL_ACCESS_TOKEN`, `GRAFANA_API_KEY`, `DROPBOX_SHORT_LIVED_TOKEN`

14 new types total. Each is a mechanical addition (regex + description + frontend mirror + unit test), no engine changes needed.

## 2. Finding status (valid / invalid / unknown)

- Prisma: `Finding.status String @default("unknown")` (values: `unknown` | `valid` | `invalid`, cast via `EFindingStatus` in `prisma-state.mapper.ts`, same pattern as `EScanStatus`).
- Backend `IFinding` domain type gains `status: EFindingStatus`.
- Frontend `IFinding` type mirrors it; `findings-table.tsx` gets a `StatusBadge`-style badge column and a `MultiSelect` filter (mirrors the existing secret-type/repo filter pattern), backed by a new query param threaded through `get-findings.use-case.ts` and its controller/DTO.

## 3. Key validity testing (new "Testing" tab) — manual, human-recorded verdicts

No automated network calls to third-party services (see Non-goals). The tool's role is to make manual review fast: list a repo's keys one at a time and let the user record what they found out (by whatever means they choose outside the tool — that's on them, not `credsScrapper`).

### Backend

- New use-case `application/use-cases/set-finding-status.use-case.ts` (`SetFindingStatusUseCase`): given a `findingId` and an `EFindingStatus`, persists it via the new `StateRepositoryPort.updateFindingStatus(id, status)` method. Pure CRUD, no job/progress needed — it's a synchronous single-row update triggered by a user click.
- The worklist itself reuses the existing `GetFindingsUseCase`/`GET /findings?repoIds=`+`limit=` endpoint — no new read endpoint needed, since that use-case already supports filtering by `repoIds`.
- One new controller endpoint on the existing findings controller: `PATCH /findings/:id/status` (body: `{ status: EFindingStatus }`) calling `SetFindingStatusUseCase`.
- The existing `ProgressPort`/`InMemoryJobRunner`/WebSocket machinery is **not used here** — there is no background job, just direct request/response per click. The "log" the user asked for is simply the worklist UI updating live as they mark each row (see below), which needs no job infrastructure.

### Frontend

- `TABS` in `dashboard.tsx` gains `{ id: 'testing', label: 'Testing' }`.
- New `testing-panel.tsx` component: a repo picker (reuses `fetchFindingsRepoOptions()`), then a worklist table of that repo's findings (type, masked secret with the same reveal-on-click `SecretValue` control as the Findings page, current status) with three buttons per row — **Valid / Invalid / Unknown** — that PATCH the status and update the row in place. Each action appends a line to a simple in-component activity log (e.g. "AWS_ACCESS_KEY_ID in src/config.ts marked valid") so the user has the requested visible trail of what happened during the session, without needing the job/WebSocket machinery built for long-running background scans.

## 4. Dedup + leak-commit tracking

- Prisma: `Finding.leakCommits String?` — JSON-encoded array of commit SHAs (SQLite has no native array type; same "plain String, cast in app code" convention already used for enum-like columns), ordered oldest-first. The oldest entry is the "commit where the developer first leaked the key."
- The dedup/promote/merge logic lives entirely inside `PrismaStateRepository.addFinding()` — its signature is unchanged, so `scan-repository.use-case.ts` needs **no changes at all**; it already calls `addFinding` once per match regardless of scan order. Inside `addFinding`:
  - Look up an existing `Finding` by `(repoId, secretType, secretValue)`.
  - **No existing row** → insert normally, `leakCommits: JSON.stringify([commitSha])`.
  - **Existing row found**:
    - Merge `commitSha` into the parsed `leakCommits` array if not already present (append; history scan already walks commits oldest-to-newest via `iterCommitDiffs`, so simple append preserves chronological order).
    - If the new match is path-based (`filePath !== '<commit-diff>'`) and the existing row's `filePath === '<commit-diff>'`, promote: update `filePath`, `lineNumber`, `context`, and `commitSha` (now the HEAD sha, matching what a path-based row's `commitSha` means) to the new values — path data wins over the diff placeholder.
    - Otherwise leave the existing row's location fields untouched, just persist the merged `leakCommits`.
- `StateRepositoryPort` additionally gains `updateFindingStatus(id, status)` for the manual verdict feature, and `IFindingsFilter` gains `statuses?: readonly EFindingStatus[]`.

## Testing

- Unit tests per new secret pattern (per `add-scan-pattern` skill convention).
- Unit test for `SetFindingStatusUseCase`: persists the given status via the port.
- Unit test for `PrismaStateRepository.addFinding`'s dedup/promote logic: same secret value found first via diff-scan then via path-scan promotes filePath/commitSha and merges leakCommits; reverse order does not regress filePath; a brand-new secret value inserts a fresh row with `leakCommits: [commitSha]`.
- Existing `hex-architecture-reviewer` / `secret-handling-reviewer` / `ponytail-review` checks apply post-implementation (repo convention).
