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

Delegate bounded independent work only when it can run alongside useful parent
work and has a clear output worth the extra agent context. Do not ask for
delegation permission on every task. Handle tiny or tightly coupled changes
locally. Use the smallest useful team, normally 1–2 children, at most 3
concurrently. Do not spawn an agent just to wait for it.

Project roles are registered in `.codex/config.toml`:

- `planner`: read-only brainstorming, designs and implementation plans;
  GPT-6 Astra with `medium` reasoning.
- `api_worker`: NestJS implementation in assigned API files.
- `web_worker`: Next.js implementation in assigned UI files.
- `verifier`: independent reproduction, behavioral tests and builds.
- `reviewer`: read-only correctness, architecture, secret-handling and simplicity review.

Use `planner` for substantive architecture, cross-component design, difficult
option comparison, or a written spec/implementation plan required by the user
or an applicable skill. For a bounded change with an already approved approach,
the parent handles routine implementation choices and short task decomposition
without a planning agent. Do not turn every small plan into a separate agent
handoff. The parent may read code and gather facts in parallel, but must not
present a Sol-authored plan as though Astra wrote it.

When substantive interactive brainstorming needs `planner`, keep it active
across turns and relay only decisions and relevant constraints, not the entire
transcript. Follow applicable skill stages and required review gates, but do
not add project-specific approval gates or ask again for a decision already
made at the same stage. If a skill requires a written spec/plan, `planner`
authors it and the parent writes it if needed; the planner remains read-only.
Do not start dependent implementation before a required approval.

The main project session defaults to GPT-6 Sol/`medium`. API workers use
Sol/`high` for scanner, authorization, and concurrency-sensitive changes;
web workers use Sol/`medium`, and verifier uses `medium`. Reviewer uses
Sol/`high` for correctness and security. Raise effort for a specific complex
assignment when justified; a model explicitly selected in the client may
override the main default.

The parent owns requirements, shared API contracts, integration and the final
report. Each delegation must give the goal, acceptance criteria, exact writable
files (or read-only scope), dependencies and expected verification/report.
One file has one writer at a time. Agree shared types/contracts before parallel
edits; never revert another agent's work. Children do not delegate further.

Use the native role selector when available. If the client exposes only a
generic spawn tool, read the corresponding `.codex/agents/<role>.toml` and pass
its instructions and configured model/effort with the bounded assignment. Use
a short or empty history fork with the relevant task context to avoid copying
the whole conversation. Do not claim the custom role loaded automatically.
If a required agent/model is unavailable, disclose the limitation.

Workers may run focused checks while implementing. Give one verifier exclusive
ownership of full tests/builds after code, integration cases and review fixes
for that app settle; repeat a passing full check only after relevant changes.
Serialize checks that share build artifacts, a database or browser. Use isolated
test data, never real leaked keys, and never include secret values in
inter-agent messages. For substantial or security-sensitive changes, use one
integrated final review; apply all mandatory project checklists in that pass,
including when the parent reviews locally. Request an earlier review only for
a concrete risk that cannot wait until integration.

The parent must inspect agent results and resolve findings before completion.
Only the parent publishes, and only with user authorization for that action.
Child agents never commit, push, reset, deploy or delete data/volumes.
See [the setup guide](docs/codex-agents.md) for examples and verification.

## Task orchestration

For work that needs a substantive plan, let `planner` prepare it and satisfy
applicable design/plan review gates. Once the required stage is approved, carry
the task through implementation, verification, review and fixes without asking
to proceed at each handoff. For already scoped work that needs no new plan,
start at implementation. Respect skill-specific gates; do not invent extra
ones or re-open an approved decision without a scope change.

Before assigning work, the parent records acceptance criteria, dependencies,
file ownership and required checks in the assignment or current task context.
Spawn only agents with useful, bounded work. Once a shared API contract is
stable, start independent UI work while backend implementation continues; the
endpoint need not be finished first. One file has one writer. Batch related
feedback to a worker at meaningful milestones instead of sending a message
after every small result. While agents work, do independent local work; if none
is available, wait for a milestone with a bounded wait rather than repeated
30-second polls, keeping user updates within 60 seconds.

Run focused tests during implementation and high-risk integration scenarios
before the final full suites. After final review fixes settle, one verifier
owns full checks and shared resources. Do not repeat green full checks for
unchanged code. Apply mandatory project review checklists in the integrated
review even when reviewing locally.

If a check fails or review finds an actionable issue, send grouped evidence to
the responsible worker, integrate the fix and rerun affected focused checks
plus any full checks invalidated by the change. The parent decides whether
acceptance criteria are met; an agent's completion message alone is not proof.
Continue until the task is
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
