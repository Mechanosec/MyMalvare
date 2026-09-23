# credsScrapper

What this is and how to run it: [`README.md`](README.md). This file is
about *how development happens* — which skill to use, and when,
so a rule doesn't get skipped because nobody remembered it.

## Mandatory workflow

Skills live at `../.agents/skills/<name>/SKILL.md` relative to this directory.
Read and apply the relevant skill; paths starting with `credsScrapper/` in a
skill are relative to the Git root.

| Change | Required workflow |
|---|---|
| New scanner backend capability/endpoint | Read `new-use-case` before implementation. For other backend modules follow their existing port/use-case/adapter structure. |
| Add or edit a detected secret type/pattern | Read `add-scan-pattern`; keep patterns, descriptions, both constants and tests in sync. |
| Finish a change under `apps/api/src/modules/scanner/` | Apply `hex-architecture-reviewer`. |
| Change findings, `secretValue`, detection output, logging, or findings UI | Apply `secret-handling-reviewer`. |
| Finish a feature or fix in either app | Apply `lazy-simplifier` to the changed code. |

These reviews are mandatory when their trigger applies. Apply the checklists
in the current task; no separate agent or Claude plugin is required. Report
actionable findings or state that no issues were found.

## Standing rules

- **Never `git commit` or `git push` without explicit permission for that
  specific action, even mid-task.** Finishing a task is not permission to
  commit. Ask, or wait to be told.
- **Run the tests and build for every app whose code you touched before saying a
  change is done.** `npm run test -w apps/api`, `npm run test -w
  apps/web`, `npm run build -w <app>` — from `credsScrapper/` (the npm workspace root, not the Git root). For documentation/config/skill-only changes, validate paths, commands, skill metadata and the diff; app tests/builds are not required.
  Run focused tests while editing. Run each affected app's full suite and build
  after integration cases and final review fixes settle. Repeat a passing full
  check only when later relevant edits invalidate it.
- **No fake or invented data in the UI.** An unreachable API states that
  plainly (see `apps/web/src/app/page.tsx`'s pattern); it never renders a
  plausible-looking empty result as if the API had actually answered.
- **Hexagonal layering is enforced by review, not by a lint rule yet**:
  `domain/` imports nothing from outer layers; `application/` may use domain types and its own ports, but never concrete infrastructure adapters; `infrastructure/`
  implements those ports; `presentation/` calls exactly one use-case per
  route and does no business logic inline. See `hex-architecture-reviewer`
  for the full check.
- **Naming, inherited from the `datatector` reference project**: enums
  and constants in `<concept>.constant.ts` under a `constant/` directory,
  `E`-prefixed; interfaces and type aliases in `<concept>.type.ts` under
  a `types/` directory, `I`/`T`-prefixed; a `*.port.ts` is the one
  exception (an abstract class, no prefix, doubles as its own NestJS DI
  token).
- **Detection itself is passive, always.** The scanner
  (`modules/scanner/domain/detection`) never authenticates with a
  credential it finds — format/regex/entropy only.
  **Live key testing is a separate, opt-in feature** the *repo owner*
  triggers themselves from the Testing tab, exactly once per key/repo
  action, only for a repo with an admin-approved `RepoAuthorization`.
  It exists so a user whose keys leaked can find out which are still
  active and rotate them — see `KeyValidatorPort`/`LiveKeyValidatorAdapter`.
  Any checker there must stay a single read-only "who am I"-style
  request (never an action the key's real owner would notice), and
  must go through that port — never a direct `fetch` from a use-case
  or controller. See the README's "Guardrails" section.
- **Findings are stored as plaintext on purpose (MVP tradeoff).** Don't
  "fix" this unilaterally by hashing/masking at the database layer — the
  frontend's reveal-on-click UI is the intended control point. Encryption
  at rest is a known, deliberately deferred gap.
- **Keep it lean.** One port per real infrastructure boundary, not one
  per method. A use-case does the one thing its name says. Prefer the
  shape the working code already has over inventing new structure —
  that's what the `lazy-simplifier` row above exists to
  catch when it slips through anyway.

## Quick reference

```bash
npm install                     # once, from credsScrapper/
npm run dev                     # starts Redis with podman compose, then api :3000 and web :3001
npm run test -w apps/api        # Jest
npm run test -w apps/web        # Vitest
npm run build -w apps/api
npm run build -w apps/web
```

Full setup, architecture, and API examples: [`README.md`](README.md).

## Codex verification step (replaces the Claude hook)

After editing backend source TypeScript, format only changed files with the
installed Prettier and then type-check before final tests. From `credsScrapper/`:

```sh
./node_modules/.bin/prettier --write apps/api/src/path/to/changed-file.ts
./node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json
```

Replace the example path with the files actually changed. Respect the API's
`.prettierrc`; do not format unrelated files. This is an explicit agent step,
not an automatic hook. Report checks that could not run and their reason.

## Current-code caveats

Read `../AGENTS.md` too. Older README/design sections predate authentication
and Redis/BullMQ workers; verify against current code and package scripts.
`npm run dev` needs Podman/Compose for Redis. `npm run stop` currently calls
`podman compose down -v`, which removes compose volumes; inspect lifecycle
commands before running them.
