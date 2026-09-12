# credsScrapper

A tool that discovers public GitHub repositories, clones them, and scans both
the current file tree and the full commit history for accidentally leaked
secrets (API keys, tokens, private keys — ~41 known service formats, plus a
generic high-entropy detector for anything else). State is persisted so a
stopped run resumes without re-scanning what's already done.

This is an npm-workspaces monorepo, two applications:

| App | What it is |
|---|---|
| [`apps/api`](apps/api) | NestJS backend, hexagonal architecture, Prisma/SQLite — the whole detection engine, git orchestration, GH Archive discovery, and the HTTP/WebSocket API |
| [`apps/web`](apps/web) | Next.js dashboard — trigger a discover/scan run, watch live progress, browse findings |

Design docs: [`../docs/superpowers/specs/`](../docs/superpowers/specs) —
`2026-09-12-nestjs-backend-design.md` and `2026-09-12-nextjs-frontend-design.md`
explain *why* each piece is shaped the way it is.

## Guardrails (read before touching detection or scan code)

- **Detection is passive; live testing is a separate, opt-in step.** The
  scanner itself never authenticates with a credential it found — only
  format/regex/entropy detection. Once a repo owner's authorization is
  admin-approved, the Testing tab lets *that owner* voluntarily run a
  read-only "is this key still active" check against each of their own
  findings, so they know what to rotate. That check is gated behind the
  approved authorization and goes through `KeyValidatorPort` — it is
  never triggered automatically or for a repo the caller doesn't own.
- **Findings are stored as plaintext for now** (an explicit MVP tradeoff, not
  an oversight) — `findings.secretValue` in the database is the raw secret.
  Encryption at rest is a known gap before any real/shared use.
- No auth exists yet. The frontend calls the API directly over plain HTTP —
  see `apps/web`'s own note about this being a deliberate, temporary
  simplification that goes away the moment an auth/user model is added.

## Prerequisites

- Node.js 20+ (tested on Node 22) and `git` on `PATH` — the scanner shells
  out to the real `git` binary, it does not use a JS git library.
- No database server to install: Prisma talks to a SQLite file
  (`apps/api/dev.db`, created on first migration).

## Project layout

```
credsScrapper/
  package.json               root — npm workspaces: ["apps/*"]
  package-lock.json          single lockfile for the whole workspace
  README.md                  this file

  apps/
    api/                     NestJS backend — @credsscrapper/api
      .env / .env.example    DATABASE_URL, PORT, FRONTEND_ORIGIN, SCAN_WORKDIR
      prisma/
        schema.prisma        candidates / scanned_repos / findings tables
        migrations/
      src/
        main.ts              bootstraps Nest, reads PORT
        app.module.ts
        modules/scanner/     the one module — everything lives under it
          domain/            entities, detection logic, enums, types
            detection/         patterns.ts, entropy.ts, engine.ts, descriptions.ts
            constant/          *.constant.ts — E-prefixed enums (ESecretType, EScanStatus, ...)
            types/             *.type.ts — I-prefixed interfaces (IFinding, IRepoRef, ...)
          application/       use-cases (plain classes) + ports (abstract classes)
            use-cases/         discover-repos, run-scan-loop, scan-repository, get-findings, get-scan-status
            ports/             *.port.ts — StateRepositoryPort, GitOperationsPort, DiscoveryFeedPort, ProgressPort, ...
          infrastructure/    adapters implementing the ports above
            persistence/       Prisma repository + mapper (Prisma model never leaves this folder)
            git/               shells out to `git` (clone --bare, ls-tree -z, log -p, ...)
            discovery/         GH Archive HTTP client
            jobs/              in-memory job runner (tracks discover/scan job status)
            websocket/         ProgressGateway — pushes job progress to the frontend
          presentation/      REST controllers + DTOs
        shared/di/           provideUseCase() — wires a plain-class use-case into Nest DI
      tests/
        unit/                mirrors src/ — no DB, no NestJS, use-cases built with `new` + fakes
        integration/         real SQLite (via Prisma) and real temporary git repos

    web/                     Next.js dashboard — @credsscrapper/web
      .env.example           NEXT_PUBLIC_API_URL
      src/
        app/
          layout.tsx
          page.tsx           Server Component — fetches initial queue status + findings
          dashboard.tsx      Client Component — composes the three pieces below
        components/
          scan-controls.tsx    Discover/Scan buttons, workers/maxRepos inputs
          progress-panel.tsx   WebSocket subscription + GET /jobs/:id polling fallback
          findings-table.tsx   secretType filter + table
        lib/
          api-client.ts        the one place that calls fetch — everything goes through here
          constant/            ESecretType/EScanStatus/EJobStatus mirrored from the api
          types/                IFinding/IQueueStatus/IJobProgressEvent mirrored from the api
      tests/components/      Vitest + Testing Library — asserts behavior, never markup/CSS
```

## Setup

```bash
npm install                                   # once, installs both workspaces

cp apps/api/.env.example apps/api/.env        # DATABASE_URL, PORT, FRONTEND_ORIGIN, SCAN_WORKDIR
cp apps/web/.env.example apps/web/.env        # NEXT_PUBLIC_API_URL

cd apps/api && npx prisma migrate deploy && cd -
```

`prisma migrate deploy` creates `apps/api/dev.db` and applies the schema. Run
it again any time `apps/api/prisma/schema.prisma` changes.

## Running it

One command from the repo root (`credsScrapper/`) starts both:

```bash
npm run dev
```

Runs the API (`:3000`) and the web app (`:3001`) together via `concurrently`,
labelled `[api]`/`[web]` in the combined output. `Ctrl-C` stops both. Open
`http://localhost:3001` — that's the whole UI.

Prefer separate terminals (two independent logs, restart one without the
other)? Run the two workspace scripts directly instead:

```bash
npm run start:dev -w apps/api   # NestJS, watch mode, http://localhost:3000
npm run dev -w apps/web         # Next.js, http://localhost:3001
```

> **Known gotcha:** if `apps/api`'s dev server or build ever throws
> `Cannot find module '.../dist/main'` (or a build reports success but
> `dist/` is empty), its incremental TypeScript cache has desynced from
> `dist/` — almost always because `dist/` got deleted by hand (`rm -rf dist`)
> without also clearing the cache. Fix: `rm apps/api/tsconfig.build.tsbuildinfo`
> and rebuild. `nest-cli.json` already sets `deleteOutDir: false` specifically
> so a normal `build`/`start:dev` never triggers this itself — it only
> recurs if `dist/` is removed out-of-band while the cache survives.

Other useful commands, all run from the repo root with `-w apps/api` or
`-w apps/web`:

| Command | apps/api | apps/web |
|---|---|---|
| Dev server (watch) | `npm run start:dev -w apps/api` | `npm run dev -w apps/web` |
| Production build | `npm run build -w apps/api` → `dist/` | `npm run build -w apps/web` → `.next/` |
| Run the build | `npm run start:prod -w apps/api` (needs `build` first) | `npm run start -w apps/web` (needs `build` first) |
| Tests | `npm run test -w apps/api` | `npm run test -w apps/web` |
| Lint | — | `npm run lint -w apps/web` |
| Prisma Studio (browse the DB) | `npx prisma studio` (run inside `apps/api`) | — |

## Running a scan

1. **Discover** — pulls the last hour of public `PushEvent`s from
   [GH Archive](https://www.gharchive.org/) and queues new candidate repos in
   the `candidates` table.
2. **Scan** — takes queued repos (`git clone --bare`), scans the HEAD tree
   and the full commit history, writes rows to `findings`. Set `workers` > 1
   to clone/scan several repos concurrently (each worker gets its own
   Prisma-transaction-guarded claim on the queue, so two workers can never
   grab the same repo).

Both are one click in the dashboard (Discover / Scan buttons, with a
`workers` field for the second). Directly against the API:

```bash
curl -X POST http://localhost:3000/discover
# {"jobId":"..."}

curl -X POST http://localhost:3000/scan -H 'content-type: application/json' -d '{"workers": 4}'
# {"jobId":"..."}

curl http://localhost:3000/jobs/<jobId>
# {"id":"...","type":"scan","status":"running","processed":3,...}

curl http://localhost:3000/scan/status
# {"pendingCandidates":123,"scannedByStatus":{"done":40,"failed":2}}

curl http://localhost:3000/findings
curl "http://localhost:3000/findings?secretType=aws_access_key_id&limit=20"
```

A stopped scan resumes safely on the next run — a repo already marked `done`
is never re-scanned, and a repo stuck `in_progress` past its stale timeout
(`staleTimeoutSeconds` in the `POST /scan` body, default 3600) is requeued
automatically at the start of the next scan.

Live progress while a job runs is pushed over WebSocket
(`socket.io`, events `job:<jobId>` and `job`) — that's what the dashboard's
progress panel listens to; `GET /jobs/:id` is the polling fallback if the
socket hasn't connected yet.

## Inspecting the database directly

```bash
cd apps/api
npx prisma studio                 # browser UI on the SQLite file
# or
sqlite3 dev.db "SELECT owner, name, status FROM scanned_repos;"
sqlite3 dev.db "SELECT secretType, COUNT(*) FROM findings GROUP BY secretType ORDER BY 2 DESC;"
```

## Testing

```bash
npm run test -w apps/api     # Jest — unit + integration, no network calls
npm run test -w apps/web     # Vitest — component behavior, no appearance checks
npm run build -w apps/api    # nest build
npm run build -w apps/web    # next build
```

Git-based tests build real temporary git repositories (no mocked git, no
network) to cover the actual edge cases this scanner has to survive: binary
files, non-ASCII filenames, and the exact false-positive patterns the
entropy detector was tuned against (file paths, camelCase identifiers with
no digits, `KEY=VALUE` assignments).

## Architecture at a glance

**`apps/api`** follows ports & adapters (hexagonal): `domain/` has zero
framework dependency (no NestJS, no Prisma import) — it's the detection
logic, entities, enums and types. `application/` holds use-cases as plain
classes (constructible with `new` in a unit test, no DI container needed)
plus the `*.port.ts` abstract classes they depend on — a port doubles as its
own NestJS injection token, no separate `Symbol`. `infrastructure/`
implements each port (Prisma repository, git CLI adapter, GH Archive HTTP
client, WebSocket gateway, in-memory job runner) and is the only layer
allowed to import Prisma or Node's `fs`/`child_process`. `presentation/` is
the REST controllers, thin — they call exactly one use-case each.
`scanner.module.ts` is the single file that wires which adapter implements
which port.

**`apps/web`** is one dashboard screen — no auth, no i18n, no design system.
It calls the API directly (`NEXT_PUBLIC_API_URL`) for both REST calls and
the WebSocket connection, which is a deliberate simplification: there's no
auth token yet to protect by routing everything through a server-side proxy.
The moment auth exists, this should move to Server Actions + httpOnly
cookies (see the frontend design spec for the full reasoning).
