---
name: push
description: Publish this project's task changes on a new branch from freshly fetched main, commit, push, create a pull request, and give a short report. Use when the user invokes /push or $push, or asks for this publishing workflow. Creating or editing this skill does not execute it.
---

# Push

Run this workflow for the current task in MyMalvare. Reply in Ukrainian.
Read the root and applicable scoped `AGENTS.md` before publishing.

## Authorization and scope

The user's invocation of `/push` or `$push` authorizes creating a branch,
committing the task changes, pushing that branch, and opening its PR.
It supplies the explicit commit/push permission required by project rules;
do not ask for that permission again. A request only to create/edit this
skill does not authorize publishing. Do not merge the PR or push to main.

Determine the task's changes from the conversation and Git state, including
relevant unpushed commits, staged/unstaged edits, and new files. Do not
assume all dirty files belong to the task. In this repository, local DB
backups, scan data, `.env` files, Git caches, and unrelated `searchDorking/`
changes must not be swept into a commit. Ask only if ownership of changes
or the target repository cannot be determined from available context.

## Start from current main

1. Inspect the repository root, status, current branch, local commits,
   remotes, and upstream configuration. Select the remote for this repo's
   `main` and PR target; use `origin` when it is the correct one. Verify
   Git and an authenticated GitHub tool/`gh` are available. Do not print
   credentials or raw finding values while inspecting changes.
2. Fetch `refs/heads/main` from that remote into its remote-tracking ref
   and record the fetched commit SHA. For example, with verified origin:
   `git fetch origin +refs/heads/main:refs/remotes/origin/main`.
   If fetch fails or main is missing, stop with the specific blocker.
   Never substitute cached local main, the current branch, or another
   default branch for the user's required up-to-date main.
3. Create a fresh `codex/<short-task-name>` branch **at that fetched SHA**;
   add a suffix if the name already exists. Prefer an isolated worktree
   based on this SHA so the user's current checkout and edits stay intact.
   Use the managed worktree tool if available, then create the branch there.
4. Transfer only this task's changes. Inspect relevant local commits before
   selecting them; apply selected commits without committing, then transfer
   scoped tracked edits (including deletions) and selected untracked files.
   Preserve binary content. Do not copy an entire stale tree over main:
   that would revert unrelated upstream changes. Resolve ordinary conflicts
   against the current main while preserving task intent. Keep original
   edits and recovery material until the transferred diff is verified.

## Validate and publish

5. Review the complete diff against the fetched main and run the checks
   required by applicable AGENTS.md and skills for the affected apps.
   Previous checks can be reused only when they cover the same final code
   and base. For documentation-only changes validate files/links/metadata
   and the diff; do not run unrelated app suites. Fix failures attributable
   to the task. If required checks remain blocked or failing, report that
   blocker before publishing; never describe an unrun check as passing.
6. Stage explicit task paths, review the staged diff and `git diff --check`,
   then create a concise commit describing the resulting change. Do not
   use blanket `git add .` or include generated local data. If there is no
   task diff against main, report that instead of creating an empty PR.
7. Fetch main again immediately before the first push. If it advanced,
   rebase the unpublished task branch onto the new SHA, resolve conflicts,
   and repeat checks affected by that change. Verify that the latest fetched
   main is an ancestor of the branch. If main keeps changing, report the
   blocker rather than publishing from a stale base.
8. Push only the new branch with upstream tracking. Do not force-push or
   overwrite existing remote work. Open a PR targeting **main** using `gh`
   or an available GitHub connector. Lead its short description with the
   problem and resulting behavior; include the checks actually performed
   and any material limitations. Respect an existing PR template. With gh,
   write the description to a temporary UTF-8 file and use `--body-file`.
9. Verify the remote branch matches the local commit and the PR has the
   intended repository, head branch, and base `main`. Attach its URL to this
   task with `mcp__codex_app__attach_artifact` when available. If a push or
   PR-create response is uncertain, inspect remote state and existing PRs
   before retrying; reuse the same branch/PR instead of making duplicates.

Do not change global Git settings, bypass hooks, delete user changes, or
merge as a side effect. Authentication, permissions, or unresolved semantic
conflicts may block completion: preserve the prepared work and report the
exact completed step and the remaining blocker.

## Short report

Return the PR link, branch and abbreviated commit SHA, 2–3 short bullets
describing the changes, and one line of actual validation results. State
that the branch is based on freshly fetched main and include its short SHA.
If incomplete, identify what succeeded and what prevented the next step.
