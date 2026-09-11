# Next.js Frontend — Design Spec

Date: 2026-09-12
Status: approved for planning (user asked to proceed directly, no further Q&A round)

## Purpose

A minimal web UI for the credsScrapper NestJS backend (`apps/api`): buttons to
trigger discover/scan, live progress instead of a hanging button, a findings
table. Second sub-project per the original decomposition (backend first,
frontend after) — the backend API is complete and tested (82/82 Jest tests).

## Scope (deliberately small — one screen)

One route, `/` (App Router):

- Queue status panel: pending candidates count, scanned-by-status breakdown
  (`GET /scan/status`).
- Controls: "Discover" button (`POST /discover`), "Scan" button with a
  `workers` number input and optional `maxRepos` input (`POST /scan`).
- Live progress panel: while a job is running, shows its status/message/count,
  updated over WebSocket (`job:<id>` / `job` events from `ProgressGateway`);
  falls back to polling `GET /jobs/:id` if the socket hasn't connected yet.
- Findings table: `GET /findings`, with a `secretType` filter dropdown (values
  from the same `ESecretType` enum the backend already declares — duplicated
  as a frontend constant since there is no shared package between the two
  apps, matching how datatector's own web app keeps its enums independent of
  the api's).

No auth, no other pages. Nothing beyond this is in scope for this pass.

## Deviation from the datatector reference, and why

Datatector's web app never lets the browser call its API directly — every
call goes through a Server Action so an auth token never reaches
`localStorage` or a component. **That rule exists to protect a token.**
credsScrapper's API has no auth/user model yet (explicit scope boundary
already stated in the backend design spec), so there is no token to leak, and
live job progress needs a real-time channel from the browser to the API
(Socket.io) that a server-only proxy would only complicate for no security
benefit at this stage. So: the browser calls the NestJS API directly, via a
public `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`), for both REST
calls and the WebSocket connection. The API's `FRONTEND_ORIGIN` CORS setting
already exists for exactly this. **Revisit this the moment auth is added** —
at that point the token-handling rules from datatector's `apps/web/CLAUDE.md`
apply and this becomes a Server Action + httpOnly-cookie design instead.

Also not carried over, because there is nothing here to apply them to yet:
i18n/dictionaries, product analytics taxonomy, Sentry, GrowthBook, the design
system / Claude Design sync workflow. One internal screen with no visual
design source does not need any of them. If this grows into the customer-
facing SaaS from the original vision, revisit per-item, not wholesale.

## What is carried over from datatector

- Server Components by default; a Client Component only for a reason —
  here: the button handlers, the WebSocket subscription, and the live-
  updating progress/findings state. Everything else (initial queue status,
  initial findings list) is fetched server-side in the page component.
- File/naming conventions: enums/constants in `constant/<concept>.constant.ts`
  under a `constant/` directory, interfaces/type aliases in
  `types/<concept>.type.ts` under a `types/` directory, `E`/`I`/`T` prefixes,
  object shapes as `interface`.
- `lib/api-client.ts` as the one place that builds a URL and calls `fetch`
  against the API — nothing under `app/` calls `fetch` directly. (Unlike
  datatector, this file runs both server- and client-side here, per the
  deviation above.)
- Never fake data: an unreachable/not-yet-answering API renders a stated
  absence, not invented rows or an endless spinner.

## Structure

```
apps/web/
  src/
    app/
      page.tsx              — the one screen, Server Component, fetches
                               initial queue status + findings
      layout.tsx
    components/
      scan-controls.tsx      — Client Component: buttons + inputs + job trigger
      progress-panel.tsx      — Client Component: WebSocket subscription + display
      findings-table.tsx      — Client Component: filter dropdown + table
                                 (re-fetches on filter change)
    lib/
      api-client.ts           — fetchQueueStatus, startDiscover, startScan,
                                 fetchFindings, fetchJob
      constant/
        secret-type.constant.ts   — ESecretType, mirrored from the api
      types/
        finding.type.ts            — IFinding (mirrors IFindingRecord)
        queue-status.type.ts       — IQueueStatus
        job-progress-event.type.ts — IJobProgressEvent
  package.json                — @credsscrapper/web
```

## Testing

Vitest + `@testing-library/react`, matching datatector's stated principle: a
component test asserts a decision (did the button call `startScan` with the
right body, did the progress panel update on a socket event, which branch a
prop chose), never appearance (no class name, no markup snapshot) — there is
no design system or visual spec here to check appearance against.

## Explicitly out of scope

- Auth / sessions (moves this design to Server Actions + httpOnly cookies
  the day it's added).
- i18n, analytics, Sentry, GrowthBook, Claude Design sync.
- Any page beyond `/`.
- Postgres/multi-tenant concerns (unchanged from the backend spec).
