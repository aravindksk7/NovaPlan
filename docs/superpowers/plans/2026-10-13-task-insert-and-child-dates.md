# Task Insert + Subtask Date Inheritance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users insert a task above or below any row with WBS codes renumbered automatically, and make new subtasks take their parent's start and end dates.

**Architecture:** Everything lives in the single-file app `NovaPlan.html` (one `<script type="module">`). Sibling order is derived from `wbs_code`, so a mid-list insert is "insert row with a temporary code, then renumber with the new row placed next to an anchor". Renumbering becomes two-phase to respect the `UNIQUE` constraint on `wbs_code`.

**Tech Stack:** Vanilla JS, sql.js (SQLite in browser), Playwright for end-to-end tests.

Spec: `docs/superpowers/specs/2026-10-13-task-insert-and-child-dates-design.md`

## Things to know

- The app script is a module, so `state` / `AppShell` are **not** reachable from `page.evaluate`. Tests drive the DOM only.
- A fresh browser context starts with an empty plan (zero rows).
- Grid rows are `tr[data-task-id]`; cells are `td[data-key="<column key>"]`. Useful keys: `wbs_code`, `title`, `start_date`, `end_date`, `duration_hours`, `predecessors_display`.
- A single click on an editable cell opens an input; `Enter` commits.
- Editing `start_date` shifts `end_date` to keep duration, so tests set start first, then end.
- After `New Task`, `+` (add child), or insert, the title cell is already in edit mode with focus.
- Run tests with `npx playwright test <file>` from `C:\AKPlanner`.

## File structure

- Modify `NovaPlan.html`
  - storage object (~line 3176): `insertTaskRow`, `insertTaskAt`, two-phase `resequenceWbsInDb(placement)`
  - `ContextMenu.show` (~line 4118): two new menu items
  - `AppShell` (~line 6049): `addRootTask`, `addChildTask` slimmed, new `insertSiblingTask`
  - near `findTask` (~line 6706): `newTaskFields`, `datesFromParent`
  - help text (~line 1203): one new list item
- Create `tests/task-insert.spec.js`

---

### Task 1: Subtask inherits parent dates

**Files:**
- Create: `tests/task-insert.spec.js`
- Modify: `NovaPlan.html` (`AppShell.addRootTask`, `AppShell.addChildTask`, helpers near `findTask`)

- [ ] **Step 1: Write the failing tests**

Create `tests/task-insert.spec.js`:

```js
const { test, expect } = require("@playwright/test");
const path = require("path");

const APP_URL = "file:///" + path.resolve(__dirname, "../NovaPlan.html").replace(/\\/g, "/");

function rowByTitle(page, title) {
  return page.locator("tr[data-task-id]").filter({
    has: page.locator('td[data-key="title"]', { hasText: title })
  });
}

function cell(page, title, key) {
  return rowByTitle(page, title).locator(`td[data-key="${key}"]`);
}

// Types a title into the title cell that is already in edit mode.
async function nameNewTask(page, title) {
  await expect(page.locator('td[data-key="title"] input')).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(rowByTitle(page, title)).toHaveCount(1);
}

async function addRoot(page, title) {
  await page.click("#new-task-btn");
  await nameNewTask(page, title);
}

async function addChild(page, parentTitle, title) {
  await rowByTitle(page, parentTitle).locator(".add-child").click();
  await nameNewTask(page, title);
}

async function setCell(page, title, key, value) {
  await cell(page, title, key).click();
  const input = cell(page, title, key).locator("input");
  await input.fill(value);
  await input.press("Enter");
  await expect(cell(page, title, key)).toHaveText(value);
}

async function insertSibling(page, anchorTitle, position, title) {
  await cell(page, anchorTitle, "wbs_code").click({ button: "right" });
  await page.locator("#context-menu .context-menu-item", { hasText: `Insert Task ${position}` }).click();
  await nameNewTask(page, title);
}

// [[wbs, title], ...] in display order
async function outline(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("tr[data-task-id]")].map(row => [
      row.querySelector('td[data-key="wbs_code"]').textContent.trim(),
      row.querySelector('td[data-key="title"]').textContent.replace(/[▸▾]/g, "").trim()
    ])
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await page.waitForSelector("#loading-overlay", { state: "hidden" });
  await page.waitForFunction(() => !document.getElementById("new-task-btn").disabled);
});

test.describe("Subtask date inheritance", () => {
  test("new subtask takes parent dates and parent dates stay unchanged", async ({ page }) => {
    await addRoot(page, "Phase");
    await setCell(page, "Phase", "start_date", "2026-11-02");
    await setCell(page, "Phase", "end_date", "2026-11-06");

    await addChild(page, "Phase", "Kid");

    await expect(cell(page, "Kid", "start_date")).toHaveText("2026-11-02");
    await expect(cell(page, "Kid", "end_date")).toHaveText("2026-11-06");
    await expect(cell(page, "Phase", "start_date")).toHaveText("2026-11-02");
    await expect(cell(page, "Phase", "end_date")).toHaveText("2026-11-06");
    // Mon-Fri = 5 working days at the default 8h/day
    expect(Number(await cell(page, "Kid", "duration_hours").textContent())).toBe(40);
  });

  test("second subtask also takes the parent span", async ({ page }) => {
    await addRoot(page, "Phase");
    await setCell(page, "Phase", "start_date", "2026-11-02");
    await setCell(page, "Phase", "end_date", "2026-11-06");
    await addChild(page, "Phase", "Kid");

    await addChild(page, "Phase", "Twin");

    await expect(cell(page, "Twin", "start_date")).toHaveText("2026-11-02");
    await expect(cell(page, "Twin", "end_date")).toHaveText("2026-11-06");
    await expect(cell(page, "Phase", "start_date")).toHaveText("2026-11-02");
    await expect(cell(page, "Phase", "end_date")).toHaveText("2026-11-06");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/task-insert.spec.js`
Expected: both FAIL — `Kid` start date is today's date instead of `2026-11-02`.

- [ ] **Step 3: Add the shared helpers**

In `NovaPlan.html`, directly above `function findTask(id) {`:

```js
    function newTaskFields(overrides = {}) {
      const date = todayIso();
      return {
        task_type: DEFAULT_TYPE,
        title: "New Task",
        start_date: date,
        end_date: date,
        actual_start_date: null,
        actual_end_date: null,
        duration_hours: workingHoursPerDay(),
        actual_hours: 0,
        remaining_hours: workingHoursPerDay(),
        progress: 0,
        predecessor_ids: "",
        resource: "",
        comments: "",
        tags: "",
        jira_url: "",
        color: "",
        is_milestone: 0,
        is_highlighted: 0,
        parent_id: null,
        status: "Not Started",
        priority: "Medium",
        sprint_id: null,
        manually_scheduled: 0,
        constraint_type: null,
        constraint_date: null,
        ...overrides
      };
    }

    function datesFromParent(parent) {
      if (!parent || !isValidIsoDate(parent.start_date) || !isValidIsoDate(parent.end_date) || parent.end_date < parent.start_date) return {};
      const hours = Math.max(1, workingDaysBetween(parent.start_date, parent.end_date)) * workingHoursPerDay();
      return { start_date: parent.start_date, end_date: parent.end_date, duration_hours: hours, remaining_hours: hours };
    }

```

- [ ] **Step 4: Use them in `addRootTask` and `addChildTask`**

Replace the whole bodies of both methods in `AppShell`:

```js
      async addRootTask() {
        try {
          const id = await state.storage.insertTask(newTaskFields({
            wbs_code: WBSUtils.nextRootCode(state.tasks)
          }));
          await this.refresh();
          this.editTaskTitle(id);
        } catch (error) {
          showToast(`Unable to add task: ${error.message}`, "error");
        }
      },
      async addChildTask(parent) {
        try {
          const id = await state.storage.insertTask(newTaskFields({
            wbs_code: WBSUtils.nextChildCode(parent, state.tasks),
            parent_id: parent.id,
            ...datesFromParent(parent)
          }));
          await this.refresh();
          this.editTaskTitle(id);
        } catch (error) {
          showToast(`Unable to add child task: ${error.message}`, "error");
        }
      },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx playwright test tests/task-insert.spec.js`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add tests/task-insert.spec.js NovaPlan.html
git commit -m "feat: new subtask inherits parent start and end dates"
```

---

### Task 2: Insert task above / below with WBS renumbering

**Files:**
- Modify: `tests/task-insert.spec.js`
- Modify: `NovaPlan.html` (storage `insertTask` / `resequenceWbsInDb`, `ContextMenu.show`, `AppShell`)

- [ ] **Step 1: Write the failing tests**

Append to `tests/task-insert.spec.js`:

```js
test.describe("Insert task in the middle", () => {
  test("Insert Above at root shifts later roots", async ({ page }) => {
    await addRoot(page, "Alpha");
    await addRoot(page, "Beta");
    await addRoot(page, "Gamma");

    await insertSibling(page, "Beta", "Above", "Mid");

    expect(await outline(page)).toEqual([["1", "Alpha"], ["2", "Mid"], ["3", "Beta"], ["4", "Gamma"]]);
  });

  test("Insert Below a parent lands after its subtree and children keep their prefix", async ({ page }) => {
    await addRoot(page, "Alpha");
    await addChild(page, "Alpha", "Kid");
    await addRoot(page, "Beta");
    await addChild(page, "Beta", "Cub");

    await insertSibling(page, "Alpha", "Below", "Mid");

    expect(await outline(page)).toEqual([
      ["1", "Alpha"], ["1.1", "Kid"], ["2", "Mid"], ["3", "Beta"], ["3.1", "Cub"]
    ]);
  });

  test("Insert between child tasks renumbers only those siblings", async ({ page }) => {
    await addRoot(page, "Alpha");
    await addChild(page, "Alpha", "Kid");
    await addChild(page, "Alpha", "Twin");
    await addRoot(page, "Beta");

    await insertSibling(page, "Twin", "Above", "Mid");

    expect(await outline(page)).toEqual([
      ["1", "Alpha"], ["1.1", "Kid"], ["1.2", "Mid"], ["1.3", "Twin"], ["2", "Beta"]
    ]);
  });

  test("inserted child sibling takes the parent dates", async ({ page }) => {
    await addRoot(page, "Phase");
    await setCell(page, "Phase", "start_date", "2026-11-02");
    await setCell(page, "Phase", "end_date", "2026-11-06");
    await addChild(page, "Phase", "Kid");

    await insertSibling(page, "Kid", "Above", "Mid");

    await expect(cell(page, "Mid", "start_date")).toHaveText("2026-11-02");
    await expect(cell(page, "Mid", "end_date")).toHaveText("2026-11-06");
    await expect(cell(page, "Phase", "start_date")).toHaveText("2026-11-02");
    await expect(cell(page, "Phase", "end_date")).toHaveText("2026-11-06");
  });

  test("dependency follows its task after renumbering", async ({ page }) => {
    await addRoot(page, "Alpha");
    await addRoot(page, "Beta");
    await cell(page, "Beta", "predecessors_display").click();
    const input = cell(page, "Beta", "predecessors_display").locator("input");
    await input.fill("1");
    await input.press("Enter");
    await expect(cell(page, "Beta", "predecessors_display")).toHaveText(/^1/);

    await insertSibling(page, "Alpha", "Above", "Mid");

    expect(await outline(page)).toEqual([["1", "Mid"], ["2", "Alpha"], ["3", "Beta"]]);
    await expect(cell(page, "Beta", "predecessors_display")).toHaveText(/^2/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/task-insert.spec.js`
Expected: the 5 new tests FAIL (timeout waiting for the `Insert Task Above` / `Insert Task Below` menu item); the 2 from Task 1 pass.

- [ ] **Step 3: Storage — positional insert and two-phase renumber**

In the storage object, replace `insertTask` with:

```js
      insertTaskRow(fields) {
        const columns = Object.keys(fields);
        const params = columns.map(key => fields[key]);
        const placeholders = columns.map(() => "?").join(",");
        this.db.run(`INSERT INTO tasks (${columns.join(",")}) VALUES (${placeholders})`, params);
        return Number(execOne(this.db, "SELECT last_insert_rowid() AS id").id);
      },
      async insertTask(fields) {
        return this.transact(async () => this.insertTaskRow(fields));
      },
      // Inserts a sibling of anchorId directly "above" or "below" it and renumbers WBS codes.
      async insertTaskAt(fields, anchorId, position) {
        return this.transact(async () => {
          const id = this.insertTaskRow({ ...fields, wbs_code: "tmp-new" });
          this.resequenceWbsInDb({ placeId: id, anchorId: Number(anchorId), position });
          return id;
        });
      },
```

Replace `resequenceWbsInDb` with:

```js
      resequenceWbsInDb(placement) {
        const rows = execRows(this.db, "SELECT id, parent_id FROM tasks");
        const childrenByParent = new Map();
        for (const row of rows) {
          const key = row.parent_id == null ? "root" : String(row.parent_id);
          if (!childrenByParent.has(key)) childrenByParent.set(key, []);
          childrenByParent.get(key).push(Number(row.id));
        }
        const current = new Map(execRows(this.db, "SELECT id, wbs_code FROM tasks").map(r => [Number(r.id), r.wbs_code]));
        for (const [key, siblings] of childrenByParent) {
          const placing = placement && siblings.includes(placement.placeId);
          const list = placing ? siblings.filter(id => id !== placement.placeId) : siblings;
          list.sort((a, b) => compareWbs(current.get(a), current.get(b)));
          if (placing) {
            const anchorIndex = list.indexOf(placement.anchorId);
            const at = anchorIndex === -1 ? list.length : placement.position === "above" ? anchorIndex : anchorIndex + 1;
            list.splice(at, 0, placement.placeId);
          }
          childrenByParent.set(key, list);
        }
        const updates = [];
        const assign = (parentId, prefix) => {
          const key = parentId == null ? "root" : String(parentId);
          const list = childrenByParent.get(key) || [];
          list.forEach((id, index) => {
            const code = prefix ? `${prefix}.${index + 1}` : String(index + 1);
            updates.push([code, id]);
            assign(id, code);
          });
        };
        assign(null, "");
        // wbs_code is UNIQUE: park changed rows on temporary codes before writing final ones.
        const changed = updates.filter(([code, id]) => current.get(id) !== code);
        for (const [, id] of changed) this.db.run("UPDATE tasks SET wbs_code = ? WHERE id = ?", [`tmp-${id}`, id]);
        for (const [code, id] of changed) this.db.run("UPDATE tasks SET wbs_code = ? WHERE id = ?", [code, id]);
      },
```

- [ ] **Step 4: `AppShell.insertSiblingTask`**

Add to `AppShell` directly after `addChildTask`:

```js
      async insertSiblingTask(anchorId, position) {
        try {
          const anchor = findTask(anchorId);
          if (!anchor) return;
          const parent = anchor.parent_id == null ? null : findTask(anchor.parent_id);
          const id = await state.storage.insertTaskAt(
            newTaskFields({ parent_id: anchor.parent_id ?? null, ...datesFromParent(parent) }),
            anchor.id,
            position
          );
          await this.refresh();
          this.editTaskTitle(id);
        } catch (error) {
          showToast(`Unable to insert task: ${error.message}`, "error");
        }
      },
```

- [ ] **Step 5: Context menu items**

In `ContextMenu.show`, change the start of the `items` array to:

```js
        const items = [
          { label: "👁️ View Details", action: () => DetailsDrawer.open(this.activeTaskId) },
          { separator: true },
          { label: "⬆️ Insert Task Above", action: () => AppShell.insertSiblingTask(this.activeTaskId, "above") },
          { label: "⬇️ Insert Task Below", action: () => AppShell.insertSiblingTask(this.activeTaskId, "below") },
          { separator: true },
          { label: "➡️ Indent Task", action: () => this.indent() },
```

(the rest of the array is unchanged)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx playwright test`
Expected: all tests pass (7 in `task-insert.spec.js` plus the existing `tools-dropdown.spec.js` suite).

- [ ] **Step 7: Commit**

```bash
git add tests/task-insert.spec.js NovaPlan.html
git commit -m "feat: insert task above/below with automatic WBS renumbering"
```

---

### Task 3: Help text

**Files:**
- Modify: `NovaPlan.html` (help section "Task Hierarchy: Parents and Subtasks", ~line 1203)

- [ ] **Step 1: Update the help list**

Replace the first `<li>` of that list with these two items:

```html
          <li>Click <code>+</code> on any row to add a subtask beneath it. The parent row turns <strong>bold</strong> — it is now a <em>summary row</em>. A new subtask starts with its parent's planned start and end dates.</li>
          <li>Right-click any row and choose <strong>Insert Task Above</strong> or <strong>Insert Task Below</strong> to add a task at that position, at the same level. WBS codes of the rows that follow are renumbered automatically.</li>
```

- [ ] **Step 2: Run the full suite**

Run: `npx playwright test`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add NovaPlan.html
git commit -m "docs: describe insert above/below and subtask date inheritance in help"
```
