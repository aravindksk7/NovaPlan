# Insert Task in the Middle + Subtask Date Inheritance

Date: 2026-10-13
Scope: `NovaPlan.html` (single-file app), new Playwright spec.

## Problem

1. New tasks can only be appended: `addRootTask` adds at the end of the root list and
   `addChildTask` adds at the end of a parent's children. There is no way to place a
   row between existing tasks.
2. A new subtask always gets today's date. Summary rollup then overwrites the parent's
   start and end dates with the child's dates, so a parent that had its own dates
   loses them as soon as the first subtask is added.

## Goals

- Insert a task above or below any existing row, at root or child level, with WBS
  codes of all following rows adjusted automatically.
- A new subtask takes its parent's start and end dates, so the parent's dates do not
  change when the subtask is added.

## Non-goals

- Keyboard shortcut for insert.
- Drag-and-drop reordering.
- A persistent `sort_order` column or any schema change.

## Design

### 1. Insert above / below

**UI.** The row context menu (`ContextMenu.show`) gets two items placed before the
Indent/Outdent group: `Insert Task Above` and `Insert Task Below`.

**Semantics.** The new row is a sibling of the clicked row: same `parent_id`, same
level. "Above" takes the clicked row's sibling position and pushes it down. "Below"
takes the next sibling position, which means it lands after the clicked row's entire
subtree when that row has children.

**Storage.** New method `storage.insertTaskAt(fields, anchorId, position)` where
`position` is `"above"` or `"below"`. In a single transaction it:

1. Inserts the row with a temporary unique `wbs_code` (`tmp-new`).
2. Calls `resequenceWbsInDb({ placeId, anchorId, position })`, which orders the
   anchor's sibling list by current WBS as today, then moves `placeId` to sit
   immediately before or after `anchorId`.
3. Returns the new id.

**Renumbering.** `resequenceWbsInDb` becomes two-phase to respect the `UNIQUE`
constraint on `wbs_code`: first every row whose code changes is set to `tmp-<id>`,
then the final codes are written. Only rows whose code actually changes are touched.
This also removes the same collision risk from the existing outdent path.

Descendants follow their parent automatically because codes are assigned by walking
the tree (`2` becomes `3`, `2.1` becomes `3.1`).

**Dependencies.** Predecessors are stored by task id (`dependencies` table and
`predecessor_ids`), and the Predecessors column renders WBS codes from ids, so the
displayed codes update after renumbering with no extra work.

**After insert.** `AppShell.refresh()` then `editTaskTitle(id)`, matching the
existing add flows.

### 2. Subtask inherits parent dates

`addChildTask(parent)` sets:

- `start_date` = `parent.start_date`, `end_date` = `parent.end_date`
- `duration_hours` and `remaining_hours` = working days in that span multiplied by
  `workingHoursPerDay()` (minimum one day)

If either parent date is not a valid ISO date, fall back to today and a one-day
duration (current behaviour).

This applies to every subtask added, not only the first. The parent's rolled-up
duration hours therefore grow with each child; its dates do not change.

Insert Above/Below uses the same rule: when the clicked row has a parent, the new
sibling takes that parent's dates. At root level it keeps today's date.

### 3. Shared defaults

`addRootTask`, `addChildTask`, and the new insert path share a single
`newTaskFields(overrides)` helper returning the default task column values, with a
`datesFromParent(parent)` helper supplying the date and duration overrides.

## Error handling

Each add path keeps its `try/catch` and reports failure through `showToast`.
`insertTaskAt` runs inside `transact`, so a failed renumber rolls back the insert.

## Testing

New `tests/task-insert.spec.js` (Playwright, same harness as
`tests/tools-dropdown.spec.js`):

- Insert Above at root: new row takes the clicked row's code, later roots shift by one.
- Insert Below at root on a task with children: new row lands after the subtree,
  children keep their parent prefix.
- Insert between two child tasks: sibling codes shift, other parents untouched.
- A dependency on a shifted task still points to the same task, shown under its new
  WBS code.
- New subtask has the parent's start and end dates, and the parent's dates are
  unchanged afterwards.
- Subtask of a parent with no valid dates falls back to today.

Existing `tests/tools-dropdown.spec.js` must still pass.
