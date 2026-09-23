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
3 concurrently. Do not spawn an agent just to wait for it, except for the
required planner handoff described below.

Project roles are registered in `.codex/config.toml`:

- `planner`: read-only brainstorming, designs and implementation plans;
  GPT-6 Astra with `medium` reasoning.
- `api_worker`: NestJS implementation in assigned API files.
- `web_worker`: Next.js implementation in assigned UI files.
- `verifier`: independent reproduction, behavioral tests and builds.
- `reviewer`: read-only correctness, architecture, secret-handling and simplicity review.

For every actual planning phase, hand off its substantive reasoning and authored
output to `planner`: brainstorming, requirements exploration, option comparison,
architecture/design, task decomposition, implementation plans, and planning
stages of Superpowers skills. This includes small plans when the user asks for
one. Routine implementation choices and the parent's coordination do not need
a separate plan. The parent may read code and gather facts in parallel, but
must not present a Sol-authored plan as though Astra wrote it.

For interactive brainstorming, keep `planner` active across turns: relay the
user's answers and relevant constraints to it, bring its next question/design
back to the user, and continue until the planning workflow is complete. Follow
any applicable skill stages or required review gates. If a planning skill calls
for a written spec/plan, `planner` authors the content and the parent writes it
to the repository if needed; the planner remains read-only. Do not start
dependent implementation before the necessary planning result is available.

API/UI implementation workers use GPT-6 Sol with `high` reasoning. The main
project session defaults to Sol/high; a model explicitly selected in the client
may override that default.

The parent owns requirements, shared API contracts, integration and the final
report. Each delegation must give the goal, acceptance criteria, exact writable
files (or read-only scope), dependencies and expected verification/report.
One file has one writer at a time. Agree shared types/contracts before parallel
edits; never revert another agent's work. Children do not delegate further.

Use the native role selector when available. If the client exposes only a
generic spawn tool, read the corresponding `.codex/agents/<role>.toml` and pass
its instructions with the bounded assignment. In that fallback, explicitly
request `gpt-6-astra`/`medium` for planning and `gpt-6-sol`/`high` for API/UI
workers. If explicit model selection requires a short or empty history fork,
use it and include the relevant task context, project rules and skill stage in
the assignment. Do not claim the custom role was loaded automatically. If agent
tools or the required model are unavailable, disclose the limitation; do not
silently substitute Sol for Astra planning.

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

## Task orchestration

For work that needs a plan, let `planner` prepare it and satisfy any applicable
design or plan review gate before implementation. Once the required plan is
approved, the parent carries the task through implementation, verification,
review and fixes without asking to proceed at each handoff. For work that does
not need a plan, start at implementation. Respect skill-specific gates; this
workflow does not bypass them.

Before assigning work, the parent records the task's acceptance criteria,
dependencies, file ownership and required checks in the agent assignment or
current task context. Spawn only agents with useful, bounded work. Parallelize
independent edits only after shared contracts and file ownership are settled.
After edits settle, one verifier owns full checks and their shared resources.
Use an independent reviewer for substantial or security-sensitive changes;
apply mandatory project review checklists even when reviewing locally.

If a check fails or review finds an actionable issue, send the evidence to the
responsible worker, integrate the fix and rerun the affected checks plus any
required full checks. The parent decides whether acceptance criteria are met;
an agent's completion message alone is not proof. Continue until the task is
ready or a real blocker remains. Ask the user only for essential missing input,
a change of scope or an external decision that cannot be made from the task.
Keep the current stage and next action clear in task updates so interrupted work
can resume from the conversation without a per-task state file.

Finish with the behavior delivered, checks actually run and their results, and
any remaining risks or blocked checks. Never call work verified when a required
check failed or did not run. Commit, push and deploy remain separate actions
subject to their existing authorization rules.

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
