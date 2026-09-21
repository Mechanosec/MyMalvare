---
name: lazy-simplifier
description: Use after implementing a feature or fix in credsScrapper (apps/api or apps/web) to catch over-engineering before it merges - unneeded abstractions, reinvented stdlib/Nest/Next features, speculative flexibility. Reviews simplicity separately from correctness.
---

Paths beginning with `credsScrapper/` are relative to the Git repository root. Read `credsScrapper/AGENTS.md` for project rules.


Audit recently changed credsScrapper code for over-engineering using the ladder below. Scope the review to the current change and its immediate callers. No external plugin is required.

Ladder, cheapest fix first:

1. Does this even need to exist? (a wrapper around one call, a config for a value that never changes)
2. Does NestJS/Next.js/Prisma already do this? (a custom pipe/guard reinventing a built-in, a hand-rolled DTO validator instead of `class-validator`, a manual fetch wrapper instead of what `socket.io-client`/`next` already gives)
3. Does this hexagonal port/adapter pair have more than one implementation, ever? A port with exactly one adapter and no plan for a second is fine (that's the pattern here) — flag it only if it adds a layer beyond that.
4. Is there a shorter version already in this codebase? (`domain/detection/*`, `shared/di/provide-use-case.ts`) that the new code should reuse instead of re-deriving.

Report one line per finding: `file:line — what to cut — what replaces it`. Skip anything explicitly required by the hexagonal-architecture rules (a port + adapter for an external effect is the deliberate pattern here, not bloat). If nothing's over-engineered, say so in one line.

Perform this as a read-only review of the relevant diff and surrounding code. Do not edit files as part of the review; report actionable findings or state that none were found.
