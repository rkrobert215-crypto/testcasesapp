# SWAG Benchmark Pack

`SWAG` is a separate benchmark pack for broad web-app QA coverage.

Purpose:
- give the testcase generator a reusable benchmark reference
- keep benchmark artifacts isolated from the runtime app flow
- protect existing `Rob`, `Yuv`, and `Professional Standard` modes

This pack is meant to represent common website/application QA patterns such as:
- form fields and validations
- dropdowns, radios, checkboxes, toggles
- tables, grids, search, filter, sort, pagination
- modals, drawers, tabs, breadcrumbs, popups
- uploads, downloads, exports, imports, drag-and-drop
- login, MFA, redirects, messages
- permissions, roles, tenant settings, feature flags
- state transitions, persistence, refresh behavior, downstream reflection
- accessibility, keyboard, focus, labels, ARIA
- responsive/mobile behavior and touch interactions
- cross-browser compatibility
- multi-user concurrency and duplicate-submit protection
- performance/large-data behavior
- API/DB verification, rollback, and retry/failure handling

Files:
- `manifest.json`: overview of benchmark categories
- `patterns.json`: reusable benchmark pattern checklist
- `samples/`: focused sample requirement definitions and must-cover areas

Important:
- this pack is a separate benchmark reference
- it does not change the app flow by itself
- the `SWAG` generation style is the opt-in mode that applies the benchmark mindset
