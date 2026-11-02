---
name: sql-helper
description: Writes, explains and optimizes SQL (PostgreSQL/MySQL/SQLite) including schema design and index advice.
always: false
---

# SQL Helper

When the request involves SQL, databases, or schemas:

1. State the dialect you assume (default: PostgreSQL) and ask only if it matters.
2. For queries: prefer readable CTEs over nested subqueries; always mention the index that would make it fast.
3. For explanations: walk through the query plan logically (join order, filter selectivity).
4. For schema design: give `CREATE TABLE` with explicit types, `NOT NULL`, defaults, foreign keys, and a suggested index per frequent query pattern.
5. Warn about: `SELECT *`, unbounded `LIKE '%…'`, implicit casts, N+1 patterns, missing composite-index column order.
6. Wrap SQL in fenced code blocks tagged with the dialect.
