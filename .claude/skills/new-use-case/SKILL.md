---
name: new-use-case
description: Use when adding a new backend capability to credsScrapper's NestJS scanner module - a new operation that needs its own use-case, following the existing hexagonal architecture (ports/use-cases/adapters/controller). Use when the user says "add an endpoint for X", "add a use-case", or describes new scanner behavior.
---

credsScrapper's `apps/api` is hexagonal: `domain` has no dependencies, `application` defines use-cases against port interfaces, `infrastructure` implements the ports, `presentation` exposes HTTP/WebSocket.

Existing examples to copy the shape of: `credsScrapper/apps/api/src/modules/scanner/application/use-cases/scan-repository.use-case.ts` and its port `application/ports/git-operations.port.ts` + adapter `infrastructure/git/git-cli-adapter.ts`.

Steps:

1. **Check for an existing port first.** List `credsScrapper/apps/api/src/modules/scanner/application/ports/*.port.ts` — if the external effect you need (fs, git, http, persistence, progress/websocket, logging) is already covered, reuse it. Only add a new port if none fits.
2. **New port (if needed)** — `application/ports/<name>.port.ts`: a plain interface, no implementation.
3. **Adapter (if new port added)** — `infrastructure/<area>/<name>.adapter.ts` implementing the port.
4. **Use-case** — `application/use-cases/<name>.use-case.ts`, depends only on port interfaces (constructor injection), no direct adapter imports.
5. **DI registration** — wire the use-case and any new port→adapter binding through `shared/di/provide-use-case.ts`, following the pattern already used for the existing use-cases.
6. **Controller** — add or extend a controller in `presentation/` (see `scan.controller.ts`, `findings.controller.ts`, `jobs.controller.ts`, `discover.controller.ts` for the existing split by resource) calling the use-case and mapping to a DTO in `presentation/dto/`.
7. **Test** — add a unit test under `apps/api/tests/unit/scanner/` for the use-case (mock the ports), and an integration test under `apps/api/tests/integration/scanner/` if it touches Prisma or the real DB.

After wiring, run `hex-architecture-reviewer` (project subagent) to catch layer violations before finishing.
