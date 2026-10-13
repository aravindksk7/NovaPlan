# Excel Import — Design

## Goal

Let a user load tasks from an `.xlsx` workbook, so a NovaPlan Excel export can be
brought back in with its outline and dependency links intact, and so plans kept in
a spreadsheet can be imported without a CSV detour.

## Decisions

- **Append, never replace.** Imported tasks are added after the existing plan, the
  same as CSV import. Nothing is deleted. (SQL import stays the only full restore.)
- **Scope: tasks, hierarchy, dependencies.** RAID, Change Log, Summary, Workload and
  Scenarios sheets are ignored.

## Behaviour

**Entry point.** The existing import button, renamed `Import SQL/CSV/Excel`. The
file input also accepts `.xlsx`. A confirm dialog titled `Import Excel` explains
that rows are appended.

**Tasks.** Rows come from the sheet named `Tasks`, or the first sheet when there is
no sheet of that name. Columns are matched with the same names and aliases as CSV
import (`Task Name`/`Title`/`Summary`/`Name`, `Planned Start Date`/`Start`, …); rows
without a task name are skipped. Cells are read as formatted text, with real Excel
date cells formatted as `yyyy-mm-dd`, so both exported ISO strings and dates typed
in Excel work. Derived columns (Critical Path, Float, variances, …) are ignored.

**Hierarchy.** A row whose `Parent WBS` equals the `WBS` of another row *in the same
workbook* becomes that row's child. References to WBS codes not in the workbook are
ignored (the row becomes a root task).

**Dependencies.** Rows of the `Dependencies` sheet link imported tasks by
`Successor WBS` / `Predecessor WBS`, with `Type` (FS/SS/FF/SF, default FS) and
`Lag Hours` (default 0). Rows that reference a WBS not in the workbook, or a task
to itself, are skipped. Dates are imported as written; nothing is rescheduled.

**WBS codes.** Imported tasks keep the workbook's row order and are renumbered to
follow the existing plan (a workbook `1, 1.1, 2` appended to a three-task plan
becomes `4, 4.1, 5`).

**Failure.** The whole import is one transaction. A workbook with no task rows, an
invalid date range, a parent loop, or a circular dependency fails with an
`Import failed: …` toast and leaves the plan unchanged.

## Implementation

All in `NovaPlan.html`:

- `SQLiteStorage.insertImportedRows(rows)` — the per-row mapping extracted unchanged
  from `importCSV`; returns `{ id, wbs, parentWbs }` per inserted row.
- `SQLiteStorage.importCSV` — parses and calls `insertImportedRows` (no behaviour change).
- `SQLiteStorage.importExcel(taskRows, dependencyRows)` — inserts, links parents,
  writes dependencies, checks for cycles, resequences WBS codes.
- `ExportSystem.readWorkbook(arrayBuffer)` — lazy-loads SheetJS through the existing
  `loadXlsx()` and returns `{ taskRows, dependencyRows }`.
- `App.handleImport` — `.xlsx` branch.

## Tests

`tests/import-excel.spec.js` (Playwright): export → import round trip; hand-made
workbook with alias columns and real date cells; dependency type and lag; unknown
references skipped; rollback on invalid rows and circular links; rejected file type.
