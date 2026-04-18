# Regression Benchmark Scaffold

This folder is a lightweight benchmark scaffold for prompt and coverage regressions.

Purpose:
- keep a small set of representative requirements that we can re-run after prompt or provider changes
- record the must-cover areas for each benchmark so quality drops are easier to spot
- avoid changing the app flow while still giving the project a stable QA baseline

Recommended manual loop:
1. Pick one benchmark case from `manifest.json`.
2. Generate testcases in the app or with `generate_testcases_xlsx.py`.
3. Compare the output against the `mustCover` and `mustPreserveTerms` lists.
4. If coverage drops or the suite drifts into generic examples, tighten the shared prompt logic before shipping changes.

The benchmark scaffold is intentionally simple and separate from runtime code.
