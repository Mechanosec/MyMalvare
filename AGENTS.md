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
