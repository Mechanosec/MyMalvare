# credsScrapper

What this is and how to run it: [`README.md`](README.md). This file is
about *how development happens* — which agent or skill to use, and when,
so a rule doesn't get skipped because nobody remembered it.

## Mandatory workflow

Each row is a trigger, not a suggestion. If the trigger applies, do the
action before considering the change finished.

| When you're about to… | Do this |
|---|---|
| Add a new backend capability/endpoint (`apps/api`) | Invoke skill `new-use-case` first — it lays out the port/use-case/adapter/controller shape before you write anything |
| Add or edit a detected secret type/pattern | Invoke skill `add-scan-pattern` — one pattern touches four files (backend pattern, description, backend constant, frontend constant) plus a test; the skill lists all four so one isn't missed |
| Finish any change under `apps/api/src/modules/scanner/` | Dispatch the `hex-architecture-reviewer` agent before calling it done — checks dependency direction (domain → application → infrastructure/presentation) and that a new external effect went through a port, not a direct adapter call |
| Finish any change touching `findings`, `secretValue`, detection output, logging, or the web findings UI | Dispatch the `secret-handling-reviewer` agent — checks the raw secret doesn't reach a log line, an unnecessary API response, or the frontend beyond the one intended reveal UI |
| Finish implementing a feature or fix, in either app | Run skill `ponytail-review` (or dispatch the `lazy-simplifier` agent for the same check scoped to just-touched files) — catches unneeded abstraction, reinvented stdlib/Nest/Next, speculative flexibility, before it ships |

These agents/skills already exist in this repo's `.claude/` (agents:
`hex-architecture-reviewer`, `lazy-simplifier`, `secret-handling-reviewer`;
skills: `new-use-case`, `add-scan-pattern`) — don't recreate them, and
don't skip a row because the change "looks small." A missed pattern
constant is invisible until someone notices a finding with no label; a
missed port is invisible until a second implementation is needed and the
use-case has to be rewritten.

## Standing rules

- **Never `git commit` or `git push` without explicit permission for that
  specific action, even mid-task.** Finishing a task is not permission to
  commit. Ask, or wait to be told.
- **Run the tests and build for every app you touched before saying a
  change is done.** `npm run test -w apps/api`, `npm run test -w
  apps/web`, `npm run build -w <app>` — from the repo root. A change that
  compiles is not a change that's verified.
- **No fake or invented data in the UI.** An unreachable API states that
  plainly (see `apps/web/src/app/page.tsx`'s pattern); it never renders a
  plausible-looking empty result as if the API had actually answered.
- **Hexagonal layering is enforced by review, not by a lint rule yet**:
  `domain/` imports nothing from outer layers; `application/` depends
  only on `application/ports/*.port.ts` abstractions; `infrastructure/`
  implements those ports; `presentation/` calls exactly one use-case per
  route and does no business logic inline. See `hex-architecture-reviewer`
  for the full check.
- **Naming, inherited from the `datatector` reference project**: enums
  and constants in `<concept>.constant.ts` under a `constant/` directory,
  `E`-prefixed; interfaces and type aliases in `<concept>.type.ts` under
  a `types/` directory, `I`/`T`-prefixed; a `*.port.ts` is the one
  exception (an abstract class, no prefix, doubles as its own NestJS DI
  token).
- **Detection is passive, always.** Never add a network call that
  authenticates as a credential this tool found — format/regex/entropy
  detection only. See the README's "Guardrails" section.
- **Findings are stored as plaintext on purpose (MVP tradeoff).** Don't
  "fix" this unilaterally by hashing/masking at the database layer — the
  frontend's reveal-on-click UI is the intended control point. Encryption
  at rest is a known, deliberately deferred gap.
- **Keep it lean.** One port per real infrastructure boundary, not one
  per method. A use-case does the one thing its name says. Prefer the
  shape the working code already has over inventing new structure —
  that's what the `ponytail-review`/`lazy-simplifier` row above exists to
  catch when it slips through anyway.

## Quick reference

```bash
npm install                     # once, from the repo root
npm run dev                     # both apps together (api :3000, web :3001)
npm run test -w apps/api        # Jest
npm run test -w apps/web        # Vitest
npm run build -w apps/api
npm run build -w apps/web
```

Full setup, architecture, and API examples: [`README.md`](README.md).
Design history: `../docs/superpowers/specs/2026-09-12-nestjs-backend-design.md`
and `../docs/superpowers/specs/2026-09-12-nextjs-frontend-design.md`.
