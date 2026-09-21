# Working in MyMalvare with Codex

Respond in Ukrainian unless the user requests another language.

## Repository map

- `credsScrapper/`: npm-workspaces project with a NestJS API and Next.js UI.
  Read `credsScrapper/AGENTS.md` before changing anything in that project,
  including when the current directory is the Git root.
- `searchDorking/` (if present locally): separate JavaScript CLI. Read its `README.md`; run
  `npm test` from that directory after code changes.

There is no root `package.json`. Run npm commands in the relevant project.

## Working rules

- Do not commit or push without explicit permission for that action.
- Preserve unrelated user changes, local databases, backups, and scan data.
- Never include real credentials or finding values in logs, examples, tool
  output, or reports. Use synthetic fixtures for tests.
- Keep changes focused and follow the existing architecture.
- Report checks actually run, failures, and checks not run.

## Agent delegation

The user wants useful agent delegation as the normal project workflow. Delegate
bounded independent work when it can run alongside useful parent work; do not
ask for delegation permission on every task. Handle tiny or tightly coupled
changes locally. Use the smallest useful team, normally 1–2 children, at most
3 concurrently. Do not spawn an agent just to wait for it.

Project roles are registered in `.codex/config.toml`:

- `api_worker`: NestJS implementation in assigned API files.
- `web_worker`: Next.js implementation in assigned UI files.
- `verifier`: independent reproduction, behavioral tests and builds.
- `reviewer`: read-only correctness, architecture, secret-handling and simplicity review.

The parent owns requirements, shared API contracts, integration and the final
report. Each delegation must give the goal, acceptance criteria, exact writable
files (or read-only scope), dependencies and expected verification/report.
One file has one writer at a time. Agree shared types/contracts before parallel
edits; never revert another agent's work. Children do not delegate further.

Use the native role selector when available. If the client exposes only a
generic spawn tool, read the corresponding `.codex/agents/<role>.toml` and pass
its instructions with the bounded assignment. Do not claim the custom role
was loaded automatically in that fallback. If agent tools are unavailable,
perform the same workflow locally and disclose that limitation.

Workers may run focused checks while implementing. Give the verifier exclusive
ownership of full tests/builds after the relevant edits settle. Serialize checks
that share build artifacts, a database or browser. Use isolated test data, never
real leaked keys, and never include secret values in inter-agent messages.
An independent reviewer is useful for substantial or security-sensitive changes;
mandatory project review checklists still apply when the parent reviews locally.

The parent must inspect agent results and resolve findings before completion.
Only the parent publishes, and only with user authorization for that action.
Child agents never commit, push, reset, deploy or delete data/volumes.
See [the setup guide](docs/codex-agents.md) for examples and verification.

## Project skills

Codex skills live under `.agents/skills/`, each with a `SKILL.md`:

- `new-use-case`: new scanner backend capability or endpoint.
- `add-scan-pattern`: detected secret formats and rules.
- `hex-architecture-reviewer`: scanner architecture review.
- `secret-handling-reviewer`: findings, logs, and secret exposure review.
- `lazy-simplifier`: simplicity review after features and fixes.
- `push`: publish task changes in a new branch from freshly fetched main,
  commit, push, open a PR, and report briefly. Invoking `/push` or `$push`
  explicitly authorizes those actions for that task; creating/editing the
  skill does not invoke it. Merging remains outside its scope.

Read the relevant skill before using it. If it is not listed in the session's
skill picker, open its `SKILL.md` directly and follow it. Review skills can
be applied in the current task without a separate agent or Claude plugin.
See `credsScrapper/AGENTS.md` for mandatory triggers.

Codex workflows are maintained here and in `.agents/skills/`.
