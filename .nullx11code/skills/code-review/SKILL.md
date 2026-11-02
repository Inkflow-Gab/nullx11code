---
name: code-review
description: Reviews changed or pasted code for bugs, security issues, and style problems, then suggests concrete fixes.
always: false
---

# Code Review

When the user asks for a review (of a file, a diff, or pasted code):

1. Read the relevant files with tools if paths are given — do not review from imagination.
2. Check, in priority order:
   - **Correctness**: off-by-ones, null/undefined handling, race conditions, broken logic.
   - **Security**: injection, unsafe deserialization, secrets in code, path traversal, missing auth checks.
   - **Performance**: N+1 queries, needless loops, unbounded memory growth.
   - **Maintainability**: dead code, misleading names, missing error handling.
3. Output format:
   - First line: verdict — `APPROVE`, `APPROVE WITH NITS`, or `REQUEST CHANGES`.
   - Then a table: `severity | file:line | issue | fix` (severity: 🔴 🟡 🟢).
   - End with the 2–3 highest-impact fixes as code suggestions.
4. Never pad the review. If the code is fine, say so in one line.
