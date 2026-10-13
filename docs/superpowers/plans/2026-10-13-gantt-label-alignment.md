# Gantt Timeline Text Alignment + Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Gantt timeline text left / centre / right alignment, beside-bar positions, auto-fit overflow, auto-contrast colour, and font size / bold / italic.

**Architecture:** Everything lives in the single-file app `NovaPlan.html` (one `<script type="module">`). Label placement moves into one pure function, `GanttChart.ganttLabelLayout`, used by both the renderer and the drag preview. `GanttChart.ganttLabel` resolves text, position, alignment and style (measuring text with a canvas) and `GanttChart.ganttLabelNode` turns that into an SVG `<text>`. Four new `tasks` columns hold per-task alignment and style; three new keys in the `ganttLabels` setting hold the global defaults.

**Tech Stack:** Vanilla JS, sql.js (SQLite in browser), SVG, Playwright for end-to-end tests.

Spec: `docs/superpowers/specs/2026-10-13-gantt-label-alignment-design.md`

## Things to know

- The app script is a module, so `state` / `GanttChart` are **not** reachable from `page.evaluate`. Tests drive the DOM only.
- A fresh browser context starts with an empty plan (zero rows), dark theme, split view (grid + Gantt), zoom 100% = 18px per day.
- Grid rows are `tr[data-task-id]`; cells are `td[data-key="<column key>"]`.
- Editing `start_date` shifts `end_date` to keep duration, so tests set start first, then end.
- Gantt bars are `#gantt-body .gantt-bar[data-task-id]` (`<rect>` with `x` / `width`, or a `<polygon>` with `data-cx` for milestones). Labels are `#gantt-body .gantt-label[data-task-id]`.
- A plain click on a bar opens the "Gantt Timeline Text" dialog. `Tools` → `Gantt Label Settings` opens the global settings form.
- Default bar colour for a new task is `#4488ff`; summary bars are `#7d8590`.
- Layout constants: `ROW_HEIGHT = 38`, `BAR_HEIGHT = 20`, `BAR_PADDING_TOP = 9`. Milestone diamonds have radius 12.
- Line numbers below are from the working tree at plan time and drift as you edit. Search for the quoted code.
- The working tree has unrelated uncommitted changes in `NovaPlan.html` and `README.md`. Commit with `git add -p` or commit those first; do not revert them.
- Run tests with `npx playwright test <file>` from `C:\AKPlanner`.

## File structure

- Modify `NovaPlan.html`
  - constants (~line 1718): label constants
  - near `cssVar` (~line 1826): `contrastTextColor`
  - row normaliser (~line 2390), `CREATE TABLE` (~line 2936), migrations (~line 3046), `loadSettings` (~line 3153)
  - Excel import (~line 3497) and export `taskRows` (~line 5119)
  - `GanttChart` (~line 4538-4850): `buildBodySvg` call sites, `ganttLabel`, `ganttLabelLayout`, `measureLabel`, `ganttLabelNode`, `editTimelineText`, `dragMove`
  - `editGanttLabelSettings` (~line 6538), `showFormDialog` (~line 7056), `showGanttTimelineTextDialog` (~line 7182)
  - help text (~line 1379)
- Create `tests/gantt-label-alignment.spec.js`
- Modify `README.md`

---

### Task 1: Data model

No visible behaviour changes in this task; the existing suite is the check.

**Files:**
- Modify: `NovaPlan.html`

- [ ] **Step 1: Replace the label constants**

Find:

```js
    const DEFAULT_GANTT_LABELS = { source: "task", position: "inside" };
    const GANTT_LABEL_POSITIONS = ["inside", "middle", "above", "below"];
```

Replace with:

```js
    const DEFAULT_GANTT_LABELS = { source: "task", position: "inside", align: "", size: "m", overflow: "outside" };
    const GANTT_LABEL_POSITIONS = ["inside", "middle", "above", "below", "before", "after"];
    const GANTT_TASK_LABEL_POSITIONS = ["above", "middle", "below", "before", "after"];
    const GANTT_LABEL_ALIGNS = ["left", "center", "right"];
    const GANTT_LABEL_SIZES = { s: 9, m: 11, l: 13 };
    const GANTT_LABEL_OVERFLOWS = ["outside", "truncate"];
    const GANTT_LABEL_PAD = 6;
```

- [ ] **Step 2: Extend the row normaliser**

Find:

```js
        gantt_label_position: ["above", "below", "middle"].includes(text(row.gantt_label_position)) ? text(row.gantt_label_position) : "",
```

Replace with:

```js
        gantt_label_position: GANTT_TASK_LABEL_POSITIONS.includes(text(row.gantt_label_position)) ? text(row.gantt_label_position) : "",
        gantt_label_align: GANTT_LABEL_ALIGNS.includes(text(row.gantt_label_align)) ? text(row.gantt_label_align) : "",
        gantt_label_size: Object.hasOwn(GANTT_LABEL_SIZES, text(row.gantt_label_size)) ? text(row.gantt_label_size) : "",
        gantt_label_bold: ["0", "1"].includes(text(row.gantt_label_bold)) ? text(row.gantt_label_bold) : "",
        gantt_label_italic: text(row.gantt_label_italic) === "1" ? "1" : "",
```

- [ ] **Step 3: Add the columns to the schema**

In the `CREATE TABLE tasks` statement find:

```
            gantt_label_font TEXT,
```

Replace with:

```
            gantt_label_font TEXT,
            gantt_label_align TEXT,
            gantt_label_size TEXT,
            gantt_label_bold TEXT,
            gantt_label_italic TEXT,
```

In the migration list find:

```js
          ["gantt_label_font", "ALTER TABLE tasks ADD COLUMN gantt_label_font TEXT"],
```

Replace with:

```js
          ["gantt_label_font", "ALTER TABLE tasks ADD COLUMN gantt_label_font TEXT"],
          ["gantt_label_align", "ALTER TABLE tasks ADD COLUMN gantt_label_align TEXT"],
          ["gantt_label_size", "ALTER TABLE tasks ADD COLUMN gantt_label_size TEXT"],
          ["gantt_label_bold", "ALTER TABLE tasks ADD COLUMN gantt_label_bold TEXT"],
          ["gantt_label_italic", "ALTER TABLE tasks ADD COLUMN gantt_label_italic TEXT"],
```

- [ ] **Step 4: Validate the new settings keys**

In `loadSettings` find:

```js
        if (!GANTT_LABEL_POSITIONS.includes(settings.ganttLabels.position)) settings.ganttLabels.position = DEFAULT_GANTT_LABELS.position;
```

Add directly below it:

```js
        if (!["", ...GANTT_LABEL_ALIGNS].includes(settings.ganttLabels.align)) settings.ganttLabels.align = DEFAULT_GANTT_LABELS.align;
        if (!Object.hasOwn(GANTT_LABEL_SIZES, settings.ganttLabels.size)) settings.ganttLabels.size = DEFAULT_GANTT_LABELS.size;
        if (!GANTT_LABEL_OVERFLOWS.includes(settings.ganttLabels.overflow)) settings.ganttLabels.overflow = DEFAULT_GANTT_LABELS.overflow;
```

- [ ] **Step 5: Run the existing suite**

Run: `npx playwright test`
Expected: all existing tests PASS (same count as before the change).

- [ ] **Step 6: Commit**

```bash
git add -p NovaPlan.html
git commit -m "feat: add data model for Gantt label alignment and style"
```

---

### Task 2: Layout helper, measured overflow, drag preview

**Files:**
- Create: `tests/gantt-label-alignment.spec.js`
- Modify: `NovaPlan.html` (`GanttChart`)

- [ ] **Step 1: Write the failing tests**

Create `tests/gantt-label-alignment.spec.js`:

```js
const { test, expect } = require("@playwright/test");
const path = require("path");

const APP_URL = "file:///" + path.resolve(__dirname, "../NovaPlan.html").replace(/\\/g, "/");
const PAD = 6;
const LONG_TITLE = "Long title that will not fit";

function rowByTitle(page, title) {
  return page.locator("tr[data-task-id]").filter({
    has: page.locator('td[data-key="title"]', { hasText: title })
  });
}

function cell(page, title, key) {
  return rowByTitle(page, title).locator(`td[data-key="${key}"]`);
}

async function taskId(page, title) {
  return rowByTitle(page, title).getAttribute("data-task-id");
}

async function ganttBar(page, title) {
  return page.locator(`#gantt-body .gantt-bar[data-task-id="${await taskId(page, title)}"]`);
}

async function ganttLabel(page, title) {
  return page.locator(`#gantt-body .gantt-label[data-task-id="${await taskId(page, title)}"]`);
}

// Left edge and width of a (non-milestone) bar, in SVG units.
async function barBox(page, title) {
  const bar = await ganttBar(page, title);
  return { x: Number(await bar.getAttribute("x")), w: Number(await bar.getAttribute("width")) };
}

async function labelX(page, title) {
  return Number(await (await ganttLabel(page, title)).getAttribute("x"));
}

async function waitForAppReady(page) {
  await page.waitForSelector("#loading-overlay", { state: "hidden" });
  await page.waitForFunction(() => !document.getElementById("new-task-btn").disabled);
}

async function addRoot(page, title) {
  await page.click("#new-task-btn");
  await expect(page.locator('td[data-key="title"] input')).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(rowByTitle(page, title)).toHaveCount(1);
}

async function setCell(page, title, key, value) {
  await cell(page, title, key).click();
  const input = cell(page, title, key).locator("input");
  await input.fill(value);
  await input.press("Enter");
  await expect(cell(page, title, key)).toHaveText(value);
}

// Adds a root task with the given planned dates.
async function addTask(page, title, start, end) {
  await addRoot(page, title);
  await setCell(page, title, "start_date", start);
  await setCell(page, title, "end_date", end);
}

let pageErrors;

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto(APP_URL);
  await waitForAppReady(page);
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test.describe("Gantt label: default placement", () => {
  test("a title that fits is centred inside the bar", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");

    const label = await ganttLabel(page, "Alpha");
    await expect(label).toHaveAttribute("data-position", "inside");
    await expect(label).toHaveAttribute("text-anchor", "middle");
    await expect(label).toHaveText("Alpha");
    const { x, w } = await barBox(page, "Alpha");
    expect(await labelX(page, "Alpha")).toBeCloseTo(x + w / 2, 1);
  });

  test("a title too long for its bar moves to the right of the bar", async ({ page }) => {
    await addTask(page, LONG_TITLE, "2026-11-02", "2026-11-02");

    const label = await ganttLabel(page, LONG_TITLE);
    await expect(label).toHaveAttribute("data-position", "after");
    await expect(label).toHaveAttribute("text-anchor", "start");
    await expect(label).toHaveText(LONG_TITLE);
    const { x, w } = await barBox(page, LONG_TITLE);
    expect(await labelX(page, LONG_TITLE)).toBeCloseTo(x + w + PAD, 1);
  });

  test("a milestone label sits after the diamond", async ({ page }) => {
    await addTask(page, "Gate", "2026-11-02", "2026-11-02");
    await rowByTitle(page, "Gate").locator(".milestone-toggle").check();

    const label = await ganttLabel(page, "Gate");
    await expect(label).toHaveAttribute("data-position", "after");
    await expect(label).toHaveAttribute("text-anchor", "start");
    const cx = Number(await (await ganttBar(page, "Gate")).getAttribute("data-cx"));
    expect(await labelX(page, "Gate")).toBeCloseTo(cx + 12 + PAD, 1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/gantt-label-alignment.spec.js`
Expected: 3 FAIL. The first fails on `data-position` (attribute missing); the second because the label is truncated or absent; the third on `data-position`.

- [ ] **Step 3: Replace `ganttLabel` and `ganttLabelNode`, add `ganttLabelLayout` and `measureLabel`**

In `GanttChart`, replace the whole of `ganttLabel(task, width) { ... }` and `ganttLabelNode(x, y, value, position, width = 0, style = {}, taskId) { ... }` with:

```js
      ganttLabel(task, width) {
        const settings = { ...DEFAULT_GANTT_LABELS, ...(state.settings?.ganttLabels || {}) };
        const custom = text(task.gantt_label).trim();
        const hasCustom = Boolean(custom);
        const raw = hasCustom ? custom : settings.source === "custom" ? "" : task.title;
        const value = text(raw).trim();
        let position = hasCustom
          ? (GANTT_TASK_LABEL_POSITIONS.includes(task.gantt_label_position) ? task.gantt_label_position : "above")
          : (GANTT_LABEL_POSITIONS.includes(settings.position) ? settings.position : DEFAULT_GANTT_LABELS.position);
        // A diamond cannot hold text.
        if (task.is_milestone && !task.is_summary && (position === "inside" || position === "middle")) position = "after";
        if (!value) return { text: "", position };
        const align = (hasCustom && task.gantt_label_align) || settings.align || "";
        const size = GANTT_LABEL_SIZES[(hasCustom && task.gantt_label_size) || settings.size] || GANTT_LABEL_SIZES.m;
        const font = GANTT_LABEL_FONTS.some(item => item.value === task.gantt_label_font) ? task.gantt_label_font : "";
        const italic = hasCustom && task.gantt_label_italic === "1";
        const boldFlag = hasCustom ? task.gantt_label_bold : "";
        // Empty flag = automatic: bold when the text sits on the bar.
        const isBold = onBar => boldFlag === "1" || (boldFlag !== "0" && onBar);
        let inside = position === "inside" || position === "middle";
        let shown = value;
        if (inside) {
          const room = Number(width) - 2 * GANTT_LABEL_PAD;
          const measure = candidate => this.measureLabel(candidate, { size, bold: isBold(true), italic, font });
          if (measure(value) > room) {
            if (settings.overflow === "truncate") {
              shown = "";
              for (let n = value.length - 1; n >= 1; n--) {
                const candidate = `${value.slice(0, n)}...`;
                if (measure(candidate) <= room) {
                  shown = candidate;
                  break;
                }
              }
              if (!shown) return { text: "", position };
            } else {
              position = "after";
              inside = false;
            }
          }
        }
        if (!inside && shown.length > 36) shown = `${shown.slice(0, 33)}...`;
        return {
          text: shown,
          position,
          align,
          size,
          bold: isBold(inside),
          italic,
          font,
          color: /^#[0-9a-fA-F]{6}$/.test(task.gantt_label_color || "") ? task.gantt_label_color : ""
        };
      },
      measureLabel(value, { size, bold, italic, font }) {
        const ctx = this._measureCtx || (this._measureCtx = document.createElement("canvas").getContext("2d"));
        const family = font || this._labelFamily || (this._labelFamily = getComputedStyle(document.body).fontFamily || "sans-serif");
        ctx.font = `${italic ? "italic " : ""}${bold ? "700 " : ""}${size}px ${family}`;
        return ctx.measureText(value).width;
      },
      // x, y, w: the bar's left edge, top and width (for a milestone, the diamond's bounds).
      ganttLabelLayout({ x, y, w, position, align, isMilestone = false }) {
        const pos = isMilestone && (position === "inside" || position === "middle") ? "after" : position;
        const midY = y + BAR_HEIGHT / 2 + 4;
        if (pos === "before") return { x: x - GANTT_LABEL_PAD, y: midY, anchor: "end", baseline: "middle", inside: false, position: pos };
        if (pos === "after") return { x: x + w + GANTT_LABEL_PAD, y: midY, anchor: "start", baseline: "middle", inside: false, position: pos };
        const inside = pos === "inside" || pos === "middle";
        const resolved = GANTT_LABEL_ALIGNS.includes(align) ? align : inside ? "center" : "left";
        const pad = inside ? GANTT_LABEL_PAD : 0;
        return {
          x: resolved === "left" ? x + pad : resolved === "right" ? x + w - pad : x + w / 2,
          y: inside ? midY : pos === "below" ? y + BAR_HEIGHT + 8 : y - 3,
          anchor: resolved === "left" ? "start" : resolved === "right" ? "end" : "middle",
          baseline: inside ? "middle" : "",
          inside,
          position: pos
        };
      },
      ganttLabelNode(x, y, w, label, taskId, barColor, isMilestone = false) {
        const layout = this.ganttLabelLayout({ x, y, w, position: label.position, align: label.align, isMilestone });
        const fill = label.color || (layout.inside ? "#ffffff" : (cssVar("--text-primary") || "#e6edf3"));
        const node = this.textNode(layout.x, layout.y, label.text, fill, label.size);
        if (taskId) node.dataset.taskId = taskId;
        // The drag preview re-runs the layout from these.
        node.dataset.position = layout.position;
        node.dataset.align = label.align || "";
        node.classList.add("gantt-label");
        node.setAttribute("pointer-events", "none");
        node.setAttribute("text-anchor", layout.anchor);
        if (label.font) node.setAttribute("font-family", label.font);
        if (label.bold) node.setAttribute("font-weight", "700");
        if (label.italic) node.setAttribute("font-style", "italic");
        if (layout.baseline) node.setAttribute("dominant-baseline", layout.baseline);
        return node;
      },
```

(`barColor` is unused until Task 5.)

- [ ] **Step 4: Update the two call sites in `buildBodySvg`**

Find (milestone branch):

```js
            if (label.text) svg.appendChild(this.ganttLabelNode(x + 14, y, label.text, label.position, 0, label, task.id));
```

Replace with:

```js
            if (label.text) svg.appendChild(this.ganttLabelNode(x - 12, y, 24, label, task.id, color, true));
```

Find (bar branch):

```js
            if (label.text) svg.appendChild(this.ganttLabelNode(x, y, label.text, label.position, w, label, task.id));
```

Replace with:

```js
            if (label.text) svg.appendChild(this.ganttLabelNode(x, y, w, label, task.id, color));
```

- [ ] **Step 5: Use the layout helper in the drag preview**

In `dragMove`, find the line:

```js
        const labelEl = svg.querySelector(`.gantt-label[data-task-id="${ds.task.id}"]`);
```

Add directly below it:

```js
        const moveLabel = (x, w) => {
          if (!labelEl) return;
          const layout = GanttChart.ganttLabelLayout({
            x,
            y: 0,
            w,
            position: labelEl.dataset.position,
            align: labelEl.dataset.align,
            isMilestone: Boolean(ds.task.is_milestone)
          });
          labelEl.setAttribute("x", layout.x);
        };
```

Then replace the four `if (labelEl) { ... }` blocks in the same function:

Milestone branch — replace

```js
          if (labelEl) {
            const pos = ds.task.gantt_label_position || "above";
            const labelX = pos === "above" || pos === "below" ? newCx : newCx + 14;
            labelEl.setAttribute("x", labelX);
          }
```

with

```js
          moveLabel(newCx - r, r * 2);
```

`drag` mode — replace

```js
            if (labelEl) {
              const pos = ds.task.gantt_label_position || "above";
              const inside = pos === "inside" || pos === "middle";
              const labelX = inside ? newX + ds.origW / 2 : newX;
              labelEl.setAttribute("x", labelX);
            }
```

with

```js
            moveLabel(newX, ds.origW);
```

`left-resize` mode — replace

```js
            if (labelEl) {
              const pos = ds.task.gantt_label_position || "above";
              const inside = pos === "inside" || pos === "middle";
              const labelX = inside ? newX + newW / 2 : newX;
              labelEl.setAttribute("x", labelX);
            }
```

with

```js
            moveLabel(newX, newW);
```

`right-resize` mode — replace

```js
            if (labelEl) {
              const pos = ds.task.gantt_label_position || "above";
              const inside = pos === "inside" || pos === "middle";
              const labelX = inside ? ds.origX + newW / 2 : ds.origX;
              labelEl.setAttribute("x", labelX);
            }
```

with

```js
            moveLabel(ds.origX, newW);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx playwright test tests/gantt-label-alignment.spec.js`
Expected: 3 PASS.

Run: `npx playwright test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/gantt-label-alignment.spec.js
git add -p NovaPlan.html
git commit -m "feat: shared Gantt label layout with measured overflow"
```

---

### Task 3: Timeline text dialog — alignment, beside-bar positions, size, bold, italic

**Files:**
- Modify: `tests/gantt-label-alignment.spec.js`
- Modify: `NovaPlan.html` (`showGanttTimelineTextDialog`, `editTimelineText`)

- [ ] **Step 1: Write the failing tests**

In `tests/gantt-label-alignment.spec.js`, add these helpers after `addTask`:

```js
// Presses a toggle button unless it is already pressed.
async function press(button) {
  if (await button.getAttribute("aria-pressed") !== "true") await button.click();
}

async function openTextDialog(page, title) {
  await (await ganttBar(page, title)).click();
  const box = page.locator(".modal-box");
  await expect(box).toContainText("Gantt Timeline Text");
  return box;
}

// Fills the timeline text dialog for a task and saves it.
async function setLabel(page, title, { text, position, align, size, bold, italic, color } = {}) {
  const box = await openTextDialog(page, title);
  if (text != null) await box.locator('input[type="text"]').fill(text);
  if (position) await press(box.locator(`button[data-position="${position}"]`));
  if (align) await press(box.locator(`button[data-align="${align}"]`));
  if (size != null) await box.locator('select[data-field="size"]').selectOption(size);
  if (bold) await press(box.locator('button[data-style="bold"]'));
  if (italic) await press(box.locator('button[data-style="italic"]'));
  if (color) await box.locator('input[type="color"]').fill(color);
  await box.locator(".modal-foot button.primary").click();
  await expect(page.locator(".modal-box")).toHaveCount(0);
}

// Starts dragging a bar and holds it. Returns a function that releases the mouse.
async function dragHold(page, title, dxPx, grip = "middle") {
  const bar = await ganttBar(page, title);
  const box = await bar.boundingBox();
  const x = grip === "right" ? box.x + box.width - 3 : box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dxPx / 2, y, { steps: 4 });
  await page.mouse.move(x + dxPx, y, { steps: 4 });
  return async () => {
    await page.mouse.up();
    await page.waitForTimeout(400);
  };
}
```

Append these describes at the end of the file:

```js
test.describe("Gantt label: alignment", () => {
  for (const position of ["above", "below", "middle"]) {
    test(`left, center and right alignment for text ${position} the bar`, async ({ page }) => {
      await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
      const pad = position === "middle" ? PAD : 0;
      const expected = {
        left: { anchor: "start", x: ({ x }) => x + pad },
        center: { anchor: "middle", x: ({ x, w }) => x + w / 2 },
        right: { anchor: "end", x: ({ x, w }) => x + w - pad }
      };

      for (const align of ["left", "center", "right"]) {
        await setLabel(page, "Alpha", { text: "Go", position, align });

        const label = await ganttLabel(page, "Alpha");
        await expect(label).toHaveAttribute("data-align", align);
        await expect(label).toHaveAttribute("data-position", position);
        await expect(label).toHaveAttribute("text-anchor", expected[align].anchor);
        expect(await labelX(page, "Alpha")).toBeCloseTo(expected[align].x(await barBox(page, "Alpha")), 1);
      }
    });
  }

  test("without an alignment, text above starts at the bar and text in the middle is centred", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");

    await setLabel(page, "Alpha", { text: "Go", position: "above" });
    let label = await ganttLabel(page, "Alpha");
    await expect(label).toHaveAttribute("data-position", "above");
    await expect(label).toHaveAttribute("text-anchor", "start");
    let box = await barBox(page, "Alpha");
    expect(await labelX(page, "Alpha")).toBeCloseTo(box.x, 1);

    await setLabel(page, "Alpha", { position: "middle" });
    label = await ganttLabel(page, "Alpha");
    await expect(label).toHaveAttribute("data-position", "middle");
    await expect(label).toHaveAttribute("text-anchor", "middle");
    box = await barBox(page, "Alpha");
    expect(await labelX(page, "Alpha")).toBeCloseTo(box.x + box.w / 2, 1);
  });

  test("clicking the pressed alignment button clears the alignment", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
    await setLabel(page, "Alpha", { text: "Go", position: "above", align: "right" });
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("data-align", "right");

    const box = await openTextDialog(page, "Alpha");
    await expect(box.locator('button[data-align="right"]')).toHaveAttribute("aria-pressed", "true");
    await box.locator('button[data-align="right"]').click();
    await box.locator(".modal-foot button.primary").click();

    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("data-align", "");
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("text-anchor", "start");
  });
});

test.describe("Gantt label: beside the bar", () => {
  test("before ends left of the bar and after starts right of it", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");

    await setLabel(page, "Alpha", { text: "Go", position: "before" });
    let label = await ganttLabel(page, "Alpha");
    await expect(label).toHaveAttribute("data-position", "before");
    await expect(label).toHaveAttribute("text-anchor", "end");
    let box = await barBox(page, "Alpha");
    expect(await labelX(page, "Alpha")).toBeCloseTo(box.x - PAD, 1);

    await setLabel(page, "Alpha", { position: "after" });
    label = await ganttLabel(page, "Alpha");
    await expect(label).toHaveAttribute("data-position", "after");
    await expect(label).toHaveAttribute("text-anchor", "start");
    box = await barBox(page, "Alpha");
    expect(await labelX(page, "Alpha")).toBeCloseTo(box.x + box.w + PAD, 1);
  });

  test("alignment buttons are disabled for before and after", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
    const box = await openTextDialog(page, "Alpha");

    await box.locator('button[data-position="before"]').click();
    for (const align of ["left", "center", "right"]) {
      await expect(box.locator(`button[data-align="${align}"]`)).toBeDisabled();
    }

    await box.locator('button[data-position="below"]').click();
    await expect(box.locator('button[data-align="left"]')).toBeEnabled();
  });
});

test.describe("Gantt label: text style", () => {
  test("size, bold and italic are applied to the label", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");

    await setLabel(page, "Alpha", { text: "Go", position: "above", size: "l", bold: true, italic: true });

    const label = await ganttLabel(page, "Alpha");
    await expect(label).toHaveAttribute("font-size", "13");
    await expect(label).toHaveAttribute("font-weight", "700");
    await expect(label).toHaveAttribute("font-style", "italic");
  });

  test("text in the middle is bold until Bold is switched off", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
    await setLabel(page, "Alpha", { text: "Go", position: "middle" });
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("font-weight", "700");

    const box = await openTextDialog(page, "Alpha");
    await expect(box.locator('button[data-style="bold"]')).toHaveAttribute("aria-pressed", "true");
    await box.locator('button[data-style="bold"]').click();
    await box.locator(".modal-foot button.primary").click();
    await expect(page.locator(".modal-box")).toHaveCount(0);

    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("data-position", "middle");
    await expect(await ganttLabel(page, "Alpha")).not.toHaveAttribute("font-weight", "700");
  });

  test("label settings survive a reload", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
    await setLabel(page, "Alpha", { text: "Go", position: "below", align: "right", size: "s", italic: true });
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("data-align", "right");

    await page.reload();
    await waitForAppReady(page);

    const label = await ganttLabel(page, "Alpha");
    await expect(label).toHaveAttribute("data-position", "below");
    await expect(label).toHaveAttribute("text-anchor", "end");
    await expect(label).toHaveAttribute("font-size", "9");
    await expect(label).toHaveAttribute("font-style", "italic");
    const box = await openTextDialog(page, "Alpha");
    await expect(box.locator('button[data-align="right"]')).toHaveAttribute("aria-pressed", "true");
    await expect(box.locator('select[data-field="size"]')).toHaveValue("s");
  });

  test("Clear removes the label and its style", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
    await setLabel(page, "Alpha", { text: "Go", position: "above", align: "right", size: "l" });

    const box = await openTextDialog(page, "Alpha");
    await box.locator(".modal-foot button.danger").click();

    const label = await ganttLabel(page, "Alpha");
    await expect(label).toHaveText("Alpha");
    await expect(label).toHaveAttribute("data-position", "inside");
    await expect(label).toHaveAttribute("font-size", "11");
  });
});

test.describe("Gantt label: dragging", () => {
  test("a right-aligned label follows the bar's right edge while it is moved", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
    await setLabel(page, "Alpha", { text: "Go", position: "above", align: "right" });
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("data-align", "right");

    const release = await dragHold(page, "Alpha", 36);
    const box = await barBox(page, "Alpha");
    expect(await labelX(page, "Alpha")).toBeCloseTo(box.x + box.w, 1);
    await release();
  });

  test("a right-aligned label follows the edge while the bar is resized", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
    await setLabel(page, "Alpha", { text: "Go", position: "above", align: "right" });
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("data-align", "right");
    const before = await barBox(page, "Alpha");

    const release = await dragHold(page, "Alpha", 36, "right");
    const box = await barBox(page, "Alpha");
    expect(box.w).toBeGreaterThan(before.w);
    expect(await labelX(page, "Alpha")).toBeCloseTo(box.x + box.w, 1);
    await release();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/gantt-label-alignment.spec.js`
Expected: the 3 tests from Task 2 PASS; every new test FAILS, timing out on `button[data-align=...]`, `button[data-position="before"]`, `select[data-field="size"]` or `button[data-style="bold"]`.

- [ ] **Step 3: Rebuild the position / style section of the dialog**

In `showGanttTimelineTextDialog`, replace everything from the line

```js
        const posLabel = document.createElement("div");
```

through the line

```js
        content.append(summary, textLabel, posLabel, positionWrap, styleGrid);
```

(inclusive) with:

```js
        const rowLabel = value => {
          const div = document.createElement("div");
          div.style.cssText = "color:var(--text-primary);font-size:13px;font-weight:600;margin-bottom:6px";
          div.textContent = value;
          return div;
        };
        const toggleButton = (label, attr, value, onClick) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = label;
          btn.dataset[attr] = value;
          btn.addEventListener("click", onClick);
          return btn;
        };
        const setPressed = (btn, active) => {
          btn.className = active ? "primary" : "";
          btn.setAttribute("aria-pressed", String(active));
        };
        const capital = value => value[0].toUpperCase() + value.slice(1);

        let position = GANTT_TASK_LABEL_POSITIONS.includes(task.gantt_label_position) ? task.gantt_label_position : "above";
        let align = GANTT_LABEL_ALIGNS.includes(task.gantt_label_align) ? task.gantt_label_align : "";
        // "" = automatic: bold when the text sits in the middle of the bar.
        let boldFlag = ["0", "1"].includes(task.gantt_label_bold) ? task.gantt_label_bold : "";
        let italic = task.gantt_label_italic === "1";
        const boldOn = () => boldFlag === "1" || (boldFlag === "" && position === "middle");

        const positionWrap = document.createElement("div");
        positionWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px";
        const alignWrap = document.createElement("div");
        alignWrap.style.cssText = "display:flex;gap:8px";
        const boldBtn = toggleButton("Bold", "style", "bold", () => {
          boldFlag = boldOn() ? "0" : "1";
          sync();
        });
        const italicBtn = toggleButton("Italic", "style", "italic", () => {
          italic = !italic;
          sync();
        });
        const sync = () => {
          const beside = position === "before" || position === "after";
          for (const btn of positionWrap.querySelectorAll("button")) setPressed(btn, btn.dataset.position === position);
          for (const btn of alignWrap.querySelectorAll("button")) {
            setPressed(btn, !beside && btn.dataset.align === align);
            btn.disabled = beside;
          }
          setPressed(boldBtn, boldOn());
          setPressed(italicBtn, italic);
        };
        for (const value of GANTT_TASK_LABEL_POSITIONS) {
          positionWrap.appendChild(toggleButton(capital(value), "position", value, () => {
            position = value;
            sync();
          }));
        }
        for (const value of GANTT_LABEL_ALIGNS) {
          alignWrap.appendChild(toggleButton(capital(value), "align", value, () => {
            align = align === value ? "" : value;
            sync();
          }));
        }

        const fieldLabel = value => {
          const label = document.createElement("label");
          label.style.cssText = "display:block;color:var(--text-primary);font-size:13px;font-weight:600";
          label.textContent = value;
          return label;
        };
        const styleGrid = document.createElement("div");
        styleGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px";

        const colorLabel = fieldLabel("Text color");
        const hadColor = /^#[0-9a-fA-F]{6}$/.test(task.gantt_label_color || "");
        // Untouched and never set = automatic colour.
        let colorTouched = false;
        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.value = hadColor ? task.gantt_label_color : "#e6edf3";
        colorInput.style.cssText = "display:block;width:100%;height:34px;border-radius:6px;padding:2px;margin-top:6px;cursor:pointer";
        colorInput.addEventListener("input", () => {
          colorTouched = true;
        });
        colorLabel.appendChild(colorInput);

        const fontLabel = fieldLabel("Font");
        const fontSelect = document.createElement("select");
        fontSelect.style.cssText = "display:block;width:100%;height:34px;border-radius:6px;margin-top:6px";
        for (const font of GANTT_LABEL_FONTS) {
          const option = document.createElement("option");
          option.value = font.value;
          option.textContent = font.label;
          fontSelect.appendChild(option);
        }
        fontSelect.value = GANTT_LABEL_FONTS.some(font => font.value === task.gantt_label_font) ? task.gantt_label_font : GANTT_LABEL_FONTS[0].value;
        fontLabel.appendChild(fontSelect);

        const sizeLabel = fieldLabel("Size");
        const sizeSelect = document.createElement("select");
        sizeSelect.dataset.field = "size";
        sizeSelect.style.cssText = "display:block;width:100%;height:34px;border-radius:6px;margin-top:6px";
        for (const [value, label] of [["", "Default"], ["s", "Small"], ["m", "Medium"], ["l", "Large"]]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          sizeSelect.appendChild(option);
        }
        sizeSelect.value = task.gantt_label_size || "";
        sizeLabel.appendChild(sizeSelect);

        const styleWrap = document.createElement("div");
        const styleButtons = document.createElement("div");
        styleButtons.style.cssText = "display:flex;gap:8px";
        styleButtons.append(boldBtn, italicBtn);
        styleWrap.append(rowLabel("Style"), styleButtons);

        styleGrid.append(colorLabel, fontLabel, sizeLabel, styleWrap);
        sync();

        const result = () => ({
          text: input.value,
          position,
          align,
          size: sizeSelect.value,
          bold: boldFlag,
          italic: italic ? "1" : "",
          color: hadColor || colorTouched ? colorInput.value : "",
          font: fontSelect.value
        });

        content.append(summary, textLabel, rowLabel("Position"), positionWrap, rowLabel("Alignment"), alignWrap, styleGrid);
```

- [ ] **Step 4: Use `result()` when saving**

In the same function, find:

```js
        save.addEventListener("click", () => close({ text: input.value, position, color: colorInput.value, font: fontSelect.value }));
```

Replace with:

```js
        save.addEventListener("click", () => close(result()));
```

Find:

```js
            close({ text: input.value, position, color: colorInput.value, font: fontSelect.value });
```

Replace with:

```js
            close(result());
```

Find:

```js
        const focusables = () => [...box.querySelectorAll("input,button")];
```

Replace with:

```js
        const focusables = () => [...box.querySelectorAll("input,select,button:not(:disabled)")];
```

- [ ] **Step 5: Persist the new fields**

Replace the body of `editTimelineText(task)` with:

```js
      async editTimelineText(task) {
        const result = await showGanttTimelineTextDialog(task);
        if (!result) return;
        const cleared = result.clear || !result.text.trim();
        await state.storage.updateTask(task.id, cleared
          ? {
              gantt_label: "",
              gantt_label_position: "",
              gantt_label_color: "",
              gantt_label_font: "",
              gantt_label_align: "",
              gantt_label_size: "",
              gantt_label_bold: "",
              gantt_label_italic: ""
            }
          : {
              gantt_label: result.text.trim().slice(0, 120),
              gantt_label_position: result.position,
              gantt_label_color: result.color,
              gantt_label_font: result.font,
              gantt_label_align: result.align,
              gantt_label_size: result.size,
              gantt_label_bold: result.bold,
              gantt_label_italic: result.italic
            });
        await AppShell.refresh();
        GanttChart.scrollToTask(task.id);
      },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx playwright test tests/gantt-label-alignment.spec.js`
Expected: all PASS.

Run: `npx playwright test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/gantt-label-alignment.spec.js
git add -p NovaPlan.html
git commit -m "feat: align, beside-bar positions and text style in timeline text dialog"
```

---

### Task 4: Global defaults — alignment, size, overflow mode

**Files:**
- Modify: `tests/gantt-label-alignment.spec.js`
- Modify: `NovaPlan.html` (`showFormDialog`, `editGanttLabelSettings`)

- [ ] **Step 1: Write the failing tests**

Add this helper after `dragHold`:

```js
// Changes Tools -> Gantt Label Settings. Keys: source, position, align, size, overflow.
async function setLabelSettings(page, values) {
  await page.click("#tools-menu-btn");
  await page.click('[data-tool="gantt-labels"]');
  const box = page.locator(".modal-box");
  await expect(box).toContainText("Gantt Label Settings");
  for (const [name, value] of Object.entries(values)) {
    await box.locator(`select[name="${name}"]`).selectOption(value);
  }
  await box.locator(".modal-foot button.primary").click();
  await expect(page.locator(".modal-box")).toHaveCount(0);
}
```

Append:

```js
test.describe("Gantt label: global settings", () => {
  test("truncate mode keeps a long title inside the bar", async ({ page }) => {
    await addTask(page, LONG_TITLE, "2026-11-02", "2026-11-04");
    await expect(await ganttLabel(page, LONG_TITLE)).toHaveAttribute("data-position", "after");

    await setLabelSettings(page, { overflow: "truncate" });

    const label = await ganttLabel(page, LONG_TITLE);
    await expect(label).toHaveAttribute("data-position", "inside");
    await expect(label).toHaveText(/^L.*\.\.\.$/);
    expect((await label.textContent()).length).toBeLessThan(LONG_TITLE.length);
  });

  test("default alignment and size apply to tasks without custom text", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");

    await setLabelSettings(page, { position: "above", align: "right", size: "l" });

    const label = await ganttLabel(page, "Alpha");
    await expect(label).toHaveAttribute("data-position", "above");
    await expect(label).toHaveAttribute("text-anchor", "end");
    await expect(label).toHaveAttribute("font-size", "13");
    const { x, w } = await barBox(page, "Alpha");
    expect(await labelX(page, "Alpha")).toBeCloseTo(x + w, 1);
  });

  test("before and after are available as the default position", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");

    await setLabelSettings(page, { position: "before" });

    const label = await ganttLabel(page, "Alpha");
    await expect(label).toHaveAttribute("data-position", "before");
    await expect(label).toHaveAttribute("text-anchor", "end");
  });

  test("global label settings survive a reload", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
    await setLabelSettings(page, { position: "below", align: "center", size: "s", overflow: "truncate" });
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("data-position", "below");

    await page.reload();
    await waitForAppReady(page);

    const label = await ganttLabel(page, "Alpha");
    await expect(label).toHaveAttribute("data-position", "below");
    await expect(label).toHaveAttribute("text-anchor", "middle");
    await expect(label).toHaveAttribute("font-size", "9");
    await page.click("#tools-menu-btn");
    await page.click('[data-tool="gantt-labels"]');
    await expect(page.locator('.modal-box select[name="overflow"]')).toHaveValue("truncate");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/gantt-label-alignment.spec.js -g "global settings"`
Expected: 4 FAIL, timing out on `select[name="overflow"]` / `select[name="position"]`.

- [ ] **Step 3: Name the selects built by `showFormDialog`**

In `showFormDialog`, find:

```js
            const select = document.createElement("select");
            select.style.cssText = "width:100%;height:34px;border-radius:6px;padding:0 8px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border)";
```

Replace with:

```js
            const select = document.createElement("select");
            select.name = field.name;
            select.style.cssText = "width:100%;height:34px;border-radius:6px;padding:0 8px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border)";
```

- [ ] **Step 4: Extend the settings form**

Replace the whole of `editGanttLabelSettings()` with:

```js
      async editGanttLabelSettings() {
        const current = { ...DEFAULT_GANTT_LABELS, ...(state.settings.ganttLabels || {}) };
        const res = await showFormDialog({
          title: "Gantt Label Settings",
          fields: [
            { name: "source", label: "Gantt label source", type: "select", value: current.source, options: [
                { value: "task", label: "Task (shows task details)" },
                { value: "custom", label: "Custom (shows custom text)" }
            ]},
            { name: "position", label: "Gantt label position", type: "select", value: current.position, options: [
                { value: "inside", label: "Inside" },
                { value: "middle", label: "Middle" },
                { value: "above", label: "Above" },
                { value: "below", label: "Below" },
                { value: "before", label: "Before (left of bar)" },
                { value: "after", label: "After (right of bar)" }
            ]},
            { name: "align", label: "Default alignment", type: "select", value: current.align, options: [
                { value: "", label: "Automatic" },
                { value: "left", label: "Left" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" }
            ]},
            { name: "size", label: "Default text size", type: "select", value: current.size, options: [
                { value: "s", label: "Small" },
                { value: "m", label: "Medium" },
                { value: "l", label: "Large" }
            ]},
            { name: "overflow", label: "Text too long for bar", type: "select", value: current.overflow, options: [
                { value: "outside", label: "Move outside" },
                { value: "truncate", label: "Truncate" }
            ]}
          ],
          onSubmit: (res) => {
            if (!["task", "custom"].includes(res.source)) {
              return "Gantt label source must be task or custom";
            }
            if (!GANTT_LABEL_POSITIONS.includes(res.position)) {
              return "Gantt label position must be inside, middle, above, below, before, or after";
            }
            if (!["", ...GANTT_LABEL_ALIGNS].includes(res.align)) {
              return "Default alignment must be automatic, left, center, or right";
            }
            if (!Object.hasOwn(GANTT_LABEL_SIZES, res.size)) {
              return "Default text size must be small, medium, or large";
            }
            if (!GANTT_LABEL_OVERFLOWS.includes(res.overflow)) {
              return "Overflow must be move outside or truncate";
            }
          }
        });
        if (res == null) return;
        await state.storage.saveSetting("ganttLabels", {
          source: res.source,
          position: res.position,
          align: res.align,
          size: res.size,
          overflow: res.overflow
        });
        await this.refresh();
        showToast("Gantt label settings saved", "success");
      },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx playwright test tests/gantt-label-alignment.spec.js`
Expected: all PASS.

Run: `npx playwright test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/gantt-label-alignment.spec.js
git add -p NovaPlan.html
git commit -m "feat: global default alignment, size and overflow mode for Gantt labels"
```

---

### Task 5: Auto-contrast text colour

**Files:**
- Modify: `tests/gantt-label-alignment.spec.js`
- Modify: `NovaPlan.html` (`contrastTextColor`, `ganttLabelNode`)

- [ ] **Step 1: Write the failing tests**

Add this helper after `setLabelSettings`:

```js
// Sets a custom bar colour through the grid's Color column.
async function setBarColor(page, title, hex) {
  await cell(page, title, "color").locator("input.color-input").fill(hex);
  await expect(await ganttBar(page, title)).toHaveAttribute("fill", hex);
}
```

Append:

```js
test.describe("Gantt label: automatic text colour", () => {
  test("inside text is white on the default bar and dark on a light bar", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("fill", "#ffffff");

    await setBarColor(page, "Alpha", "#ffd89a");

    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("data-position", "inside");
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("fill", "#111111");
  });

  test("custom text in the middle of a light bar is dark unless a colour is picked", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
    await setBarColor(page, "Alpha", "#ffd89a");

    await setLabel(page, "Alpha", { text: "Go", position: "middle" });
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("data-position", "middle");
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("fill", "#111111");

    await setLabel(page, "Alpha", { color: "#ff0000" });
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("fill", "#ff0000");
  });

  test("text outside a light bar keeps the theme colour", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
    await setBarColor(page, "Alpha", "#ffd89a");

    await setLabel(page, "Alpha", { text: "Go", position: "above" });

    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("data-position", "above");
    await expect(await ganttLabel(page, "Alpha")).not.toHaveAttribute("fill", "#111111");
  });
});
```

If `setBarColor` times out because the Color column is hidden in the fresh plan, show it first with `Tools` → `Choose Columns` inside the helper; the column key is `color`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/gantt-label-alignment.spec.js -g "automatic text colour"`
Expected: the first two FAIL with fill `#ffffff` where `#111111` is expected; the third PASSES already.

- [ ] **Step 3: Add `contrastTextColor`**

Directly below the `cssVar` function, add:

```js
    // Text colour for a label drawn on a bar: dark only on clearly light bars, so
    // white stays the default and remains readable over the darker progress fill.
    function contrastTextColor(hex) {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex || "")) return "#ffffff";
      const channel = offset => {
        const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
      return luminance > 0.35 ? "#111111" : "#ffffff";
    }
```

- [ ] **Step 4: Use it in `ganttLabelNode`**

Find:

```js
        const fill = label.color || (layout.inside ? "#ffffff" : (cssVar("--text-primary") || "#e6edf3"));
```

Replace with:

```js
        const fill = label.color || (layout.inside ? contrastTextColor(barColor) : (cssVar("--text-primary") || "#e6edf3"));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx playwright test tests/gantt-label-alignment.spec.js`
Expected: all PASS.

Run: `npx playwright test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/gantt-label-alignment.spec.js
git add -p NovaPlan.html
git commit -m "feat: automatic contrast colour for text inside Gantt bars"
```

---

### Task 6: Excel import / export

There is no automated Excel test in this repo (SheetJS loads from a CDN), so this task is verified by hand.

**Files:**
- Modify: `NovaPlan.html` (Excel import, `taskRows`)

- [ ] **Step 1: Export the new fields**

In `taskRows`, find:

```js
            "Gantt Text Font": GANTT_LABEL_FONTS.find(font => font.value === t.gantt_label_font)?.label || "",
```

Add directly below it:

```js
            "Gantt Text Align": t.gantt_label_align || "",
            "Gantt Text Size": t.gantt_label_size || "",
            "Gantt Text Bold": t.gantt_label_bold === "1" ? "Yes" : t.gantt_label_bold === "0" ? "No" : "",
            "Gantt Text Italic": t.gantt_label_italic === "1" ? "Yes" : "",
```

- [ ] **Step 2: Import the new fields**

In the Excel import, find:

```js
            const ganttLabelPosition = ["above", "below", "middle"].includes(rawGanttLabelPosition) ? rawGanttLabelPosition : "";
```

Replace with:

```js
            const ganttLabelPosition = GANTT_TASK_LABEL_POSITIONS.includes(rawGanttLabelPosition) ? rawGanttLabelPosition : "";
            const rawGanttLabelAlign = String(pick(row, ["Gantt Text Align", "Gantt Label Align", "gantt_label_align"], "")).trim().toLowerCase();
            const ganttLabelAlign = GANTT_LABEL_ALIGNS.includes(rawGanttLabelAlign) ? rawGanttLabelAlign : "";
            const rawGanttLabelSize = String(pick(row, ["Gantt Text Size", "Gantt Label Size", "gantt_label_size"], "")).trim().toLowerCase();
            const ganttLabelSize = Object.hasOwn(GANTT_LABEL_SIZES, rawGanttLabelSize) ? rawGanttLabelSize : "";
            const labelFlag = names => {
              const value = String(pick(row, names, "")).trim().toLowerCase();
              return ["yes", "true", "1"].includes(value) ? "1" : ["no", "false", "0"].includes(value) ? "0" : "";
            };
            const ganttLabelBold = labelFlag(["Gantt Text Bold", "Gantt Label Bold", "gantt_label_bold"]);
            const ganttLabelItalic = labelFlag(["Gantt Text Italic", "Gantt Label Italic", "gantt_label_italic"]) === "1" ? "1" : "";
```

Then replace the `this.db.run(` call that follows (the `INSERT INTO tasks (wbs_code, task_type, title, ...` statement and its values array) with:

```js
            this.db.run(
              "INSERT INTO tasks (wbs_code, task_type, title, start_date, end_date, actual_start_date, actual_end_date, duration_hours, actual_hours, remaining_hours, progress, predecessor_ids, resource, comments, tags, jira_url, color, gantt_label, gantt_label_position, gantt_label_color, gantt_label_font, gantt_label_align, gantt_label_size, gantt_label_bold, gantt_label_italic, is_milestone, is_highlighted, parent_id, status, priority, sprint_id, manually_scheduled, constraint_type, constraint_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,0,NULL,NULL)",
              [wbs, DEFAULT_TYPE, title, start, end, null, null, duration, actual, remaining, progress, "", pick(row, ["Resource", "Assignee", "resource"]), pick(row, ["Comments", "Description", "comments"]), pick(row, ["Tags", "Labels", "tags"]), jira, color, ganttLabel, ganttLabelPosition, ganttLabelColor, ganttLabelFont, ganttLabelAlign, ganttLabelSize, ganttLabelBold, ganttLabelItalic, /^yes|true|1$/i.test(pick(row, ["Milestone", "is_milestone"])), 0, null, status, priority]
            );
```

That is 30 `?` placeholders and 30 values; the only change from the old statement is the four `gantt_label_align / size / bold / italic` columns and values after `gantt_label_font`.

- [ ] **Step 3: Verify by hand**

1. Open `NovaPlan.html` in a browser (needs internet for SheetJS).
2. Add a task, click its bar, set text `Go`, position Below, alignment Right, size Large, Bold on, Italic on. Save.
3. Export to Excel. Open the file: the row has `Gantt Text Position = below`, `Gantt Text Align = right`, `Gantt Text Size = l`, `Gantt Text Bold = Yes`, `Gantt Text Italic = Yes`.
4. Reset the plan (`Tools` → `Reset Data`), import the same file.
Expected: the label is below the bar, right-aligned, large, bold and italic, and no error toast appears.

Run: `npx playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add -p NovaPlan.html
git commit -m "feat: import and export Gantt label alignment and style"
```

---

### Task 7: Help text and README

**Files:**
- Modify: `NovaPlan.html` (help, ~line 1379)
- Modify: `README.md`

- [ ] **Step 1: Add a help section**

In the Gantt help section, find:

```html
        <h4>Zooming</h4>
```

Insert directly above it:

```html
        <h4>Timeline text</h4>
        <p>Click any bar to give it its own text. <code>Tools → Gantt Label Settings</code> sets the defaults for every other bar.</p>
        <table>
          <tr><th>Option</th><th>What it does</th></tr>
          <tr><td>Position</td><td><code>Above</code>, <code>Middle</code> or <code>Below</code> the bar, or <code>Before</code> / <code>After</code> to place the text beside it.</td></tr>
          <tr><td>Alignment</td><td><code>Left</code>, <code>Center</code> or <code>Right</code> lines the text up with the bar's start, middle or end. Click the pressed button again to go back to automatic. Not used for Before / After.</td></tr>
          <tr><td>Size and Style</td><td>Small, Medium or Large text, with optional Bold and Italic.</td></tr>
          <tr><td>Text color</td><td>Leave it alone for automatic: text on a bar turns dark on light bars and white on dark ones.</td></tr>
        </table>
        <ul class="help-steps" style="margin-top:6px">
          <li>Text that is too long to fit inside its bar moves to the right of the bar. To cut it short instead, set <code>Text too long for bar</code> to <code>Truncate</code> in Gantt Label Settings.</li>
          <li>Milestone text always sits beside or above/below the diamond, never on it.</li>
          <li>Alignment, size, bold and italic are included in Excel export and import.</li>
        </ul>
```

- [ ] **Step 2: Update the README**

In `README.md`, find the section that describes the Gantt chart (search for `Gantt`; it is the feature section that mentions dragging bars or bar colours). Add this bullet list at the end of that section:

```markdown
**Timeline text**

- Click a bar to set its own text, then choose a position (above, middle, below, before, after) and an alignment (left, center, right).
- Pick a size (small, medium, large) and bold or italic.
- Text too long for its bar moves to the right of the bar; switch to truncation in `Tools → Gantt Label Settings`.
- Text on a bar picks dark or white automatically for contrast unless you choose a colour.
- `Tools → Gantt Label Settings` sets the default position, alignment, size and overflow behaviour for all bars.
```

- [ ] **Step 3: Run the full suite**

Run: `npx playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add -p NovaPlan.html README.md
git commit -m "docs: describe Gantt timeline text alignment and style"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| 1. Data model | 1 |
| 2. Placement, shared layout, drag preview | 2 (helper, drag), 3 (alignment via dialog) |
| 3. Auto-fit overflow | 2 (measure, move outside), 4 (truncate toggle) |
| 4. Auto-contrast, automatic dialog colour | 5 (colour), 3 (dialog stores empty colour) |
| 5. Size, bold (tri-state), italic | 2 (render), 3 (dialog) |
| 6. UI: dialog and settings form | 3, 4 |
| 7. Import / export | 6 |
| 8. Docs | 7 |
| Testing | 2, 3, 4, 5 |
