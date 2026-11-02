---
name: commit-msg
description: Writes conventional, well-scoped git commit messages from the staged diff or a description of the change.
always: false
---

# Commit Message Writer

When asked to write a commit message:

1. Run `git diff --staged` (or `git diff` if nothing staged) with the shell tool to see the real change.
2. If the diff is empty, ask the user what changed.
3. Produce ONE Conventional Commit line:
   - `type(scope): summary` where type ∈ feat | fix | docs | refactor | perf | test | chore | build | ci
   - summary is imperative mood, lowercase, no trailing period, ≤ 72 chars.
4. Add a body only when the *why* is non-obvious: wrap at 72 chars, bullets for multiple reasons.
5. Add a `BREAKING CHANGE:` footer only if APIs/behavior changed incompatibly.
6. Offer to run `git commit` for the user (approval required).
