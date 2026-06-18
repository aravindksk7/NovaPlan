const path = require("path");
const { pathToFileURL } = require("url");
const { test, expect } = require("@playwright/test");

const appUrl = pathToFileURL(path.join(__dirname, "..", "NovaPlan.html")).href;

// On file:// URLs, OPFS / IndexedDB / localStorage are NOT isolated per Playwright
// context, so data bleeds between tests. Clear all three before the app boots so
// every test starts from an empty database.
async function clearStorage(page) {
  await page.evaluate(async () => {
    try { localStorage.clear(); } catch {}
    try {
      await new Promise(res => { const r = indexedDB.deleteDatabase("novaplan_idb"); r.onsuccess = r.onerror = r.onblocked = res; });
    } catch {}
    try {
      if (navigator.storage?.getDirectory) {
        const root = await navigator.storage.getDirectory();
        for await (const name of root.keys()) {
          try { await root.removeEntry(name, { recursive: true }); } catch {}
        }
      }
    } catch {}
  });
}

async function openApp(page) {
  // First load to obtain a document context; let it settle so its initial OPFS
  // write completes, then wipe storage and reload into a clean database.
  await page.goto(appUrl);
  await expect(page.locator("#loading-overlay")).toBeHidden({ timeout: 60000 });
  await clearStorage(page);
  await page.goto(appUrl);
  await expect(page.locator("#loading-overlay")).toBeHidden({ timeout: 60000 });
  await expect(page.getByRole("button", { name: "New Task" })).toBeEnabled({ timeout: 15000 });
}

function rowByTitle(page, title) {
  return page.locator("tbody tr").filter({ hasText: title }).first();
}

async function addTask(page, title) {
  await page.getByRole("button", { name: "New Task" }).click();
  const input = page.locator('td[data-key="title"] input').first();
  await expect(input).toBeVisible();
  await input.fill(title);
  await input.press("Enter");
  await expect(rowByTitle(page, title)).toBeVisible();
}

async function editCell(page, title, key, value) {
  const row = rowByTitle(page, title);
  const cell = row.locator(`td[data-key="${key}"]`);
  await cell.click();
  const control = cell.locator("input, textarea, select").first();
  await expect(control).toBeVisible();
  const tag = await control.evaluate(node => node.tagName.toLowerCase());
  if (tag === "select") {
    await control.selectOption(String(value));
    await control.evaluate(node => node.blur());
  } else {
    await control.fill(String(value));
    if (tag === "textarea") await control.evaluate(node => node.blur());
    else await control.press("Enter");
  }
  await expect(rowByTitle(page, title)).toBeVisible();
}

async function runTool(page, name) {
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("menuitem", { name }).click();
}

async function runExport(page, name) {
  // Use exact:true to avoid substring-matching toast messages that contain "export"
  await page.locator("#export-menu-btn").click();
  await page.getByRole("menuitem", { name }).click();
}

async function answerPrompts(page, answers, action) {
  const queue = [...answers];
  const handler = async dialog => {
    const answer = queue.shift();
    await dialog.accept(answer ?? "");
  };
  page.on("dialog", handler);
  try {
    await action();
    await expect.poll(() => queue.length, { timeout: 5000 }).toBe(0);
  } finally {
    page.off("dialog", handler);
  }
}

function isoDateFromToday(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. App shell
// ─────────────────────────────────────────────────────────────────────────────
test("app shell exposes embedded help and creator link", async ({ page }) => {
  await openApp(page);

  await expect(page).toHaveTitle("NovaPlan");
  await expect(page.locator(".brand")).toHaveText("NovaPlan");
  await expect(page.getByRole("link", { name: "Created by AK" })).toHaveAttribute("href", "https://github.com/aravindksk7");

  // Help dialog – check current section headings from the uplifted help content
  await page.getByRole("button", { name: "Help" }).click();
  await expect(page.getByRole("dialog")).toContainText("NovaPlan Help");
  await expect(page.getByRole("dialog")).toContainText("Getting Started in 5 Steps");
  await expect(page.getByRole("dialog")).toContainText("Grid Column Reference");
  await expect(page.getByRole("dialog")).toContainText("Progress and Status");
  await expect(page.getByRole("dialog")).toContainText("Task Dependencies");
  await expect(page.getByRole("dialog")).toContainText("The Gantt Timeline");
  await expect(page.getByRole("dialog")).toContainText("Task Hierarchy: Parents and Subtasks");
  await expect(page.getByRole("dialog")).toContainText("Row Colour Coding");
  await page.getByRole("button", { name: "Close" }).click();
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Task grid – editing, slippage, milestones, status, priority, dependencies
// ─────────────────────────────────────────────────────────────────────────────
test("task grid covers editing, slippage, milestones, status, priority, and dependency syntax", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Design foundation");
  await addTask(page, "Build feature");

  await editCell(page, "Design foundation", "start_date", "2026-06-01");
  await editCell(page, "Design foundation", "end_date", "2026-06-02");
  await editCell(page, "Design foundation", "duration_hours", "4");
  await editCell(page, "Design foundation", "progress", "25");
  await expect(rowByTitle(page, "Design foundation").locator('td[data-key="status"]')).toHaveText("In Progress");
  await editCell(page, "Design foundation", "progress", "100");
  await expect(rowByTitle(page, "Design foundation").locator('td[data-key="status"]')).toHaveText("Done");
  await editCell(page, "Design foundation", "priority", "High");
  await editCell(page, "Design foundation", "actual_start_date", "2026-06-02");
  await editCell(page, "Design foundation", "actual_end_date", "2026-06-03");
  await editCell(page, "Design foundation", "resource", "AK");
  await editCell(page, "Design foundation", "tags", "planning,foundation");
  await editCell(page, "Design foundation", "jira_url", "https://example.atlassian.net/browse/NP-1");
  await editCell(page, "Design foundation", "comments", "Free text comment from Playwright");

  let row = rowByTitle(page, "Design foundation");
  await row.locator(".milestone-toggle").check();
  await expect(rowByTitle(page, "Design foundation").locator('td[data-key="slippage_status"]')).toHaveText("Slipped");
  await expect(rowByTitle(page, "Design foundation").locator('td[data-key="duration"]')).toContainText("4h");
  await expect(rowByTitle(page, "Design foundation").locator('td[data-key="status"]')).toHaveText("Done");
  await expect(rowByTitle(page, "Design foundation").locator('td[data-key="priority"]')).toHaveText("High");
  await expect(rowByTitle(page, "Design foundation").getByRole("link", { name: "Open Jira" })).toHaveAttribute("href", "https://example.atlassian.net/browse/NP-1");

  // Dependency syntax – "Build feature" depends on "Design foundation" (WBS 1) with SS+4h
  await editCell(page, "Build feature", "predecessors_display", "1SS+4h");
  await expect(rowByTitle(page, "Build feature").locator('td[data-key="predecessors_display"]')).toHaveText("1SS+4h");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Industry-standard task types
// ─────────────────────────────────────────────────────────────────────────────
test("all 13 industry-standard task types are selectable and render correctly", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Typed task");

  const expectedTypes = [
    ["🎯", "Epic"],
    ["📖", "Story"],
    ["✅", "Task"],
    ["⚡", "Feature"],
    ["🐛", "Bug"],
    ["🔬", "Spike"],
    ["🧪", "Test"],
    ["📚", "Docs"],
    ["🏗️", "Infra"],
    ["👁️", "Review"],
    ["🚀", "Deploy"],
    ["🔧", "Maint"],
    ["📋", "Planning"]
  ];

  for (const [emoji, label] of expectedTypes) {
    await editCell(page, "Typed task", "task_type", emoji);
    const typeCell = rowByTitle(page, "Typed task").locator('td[data-key="task_type"]');
    await expect(typeCell).toContainText(emoji);
    await expect(typeCell).toContainText(label);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3b. Custom Gantt bar colors
// ─────────────────────────────────────────────────────────────────────────────
test("custom task color applies to the gantt bar and can be reset", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Colored task");
  await editCell(page, "Colored task", "start_date", "2026-06-01");
  await editCell(page, "Colored task", "end_date", "2026-06-05");

  const row = rowByTitle(page, "Colored task");
  const taskId = await row.getAttribute("data-task-id");
  const colorInput = row.locator('td[data-key="color"] input.color-input');
  await expect(colorInput).toBeVisible();

  // Default swatch reflects the task-type color (no custom color, no clear button yet)
  await expect(row.locator('td[data-key="color"] .color-clear')).toHaveCount(0);

  // Set a custom color via the native color input
  await colorInput.evaluate(node => {
    node.value = "#ff00aa";
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // Wait for the grid to re-render with the persisted color: the ✕ reset button
  // only appears once the custom color is saved and the row is rebuilt.
  await expect(rowByTitle(page, "Colored task").locator('td[data-key="color"] .color-clear'))
    .toHaveCount(1, { timeout: 10000 });

  // The Gantt bar fill should now use the custom color
  const bar = page.locator(`#gantt-body .gantt-bar[data-task-id="${taskId}"]`).first();
  await expect(bar).toHaveAttribute("fill", "#ff00aa");

  // Reset reverts to the task-type color and removes the clear button
  await rowByTitle(page, "Colored task").locator('td[data-key="color"] .color-clear').click();
  await expect(rowByTitle(page, "Colored task").locator('td[data-key="color"] .color-clear')).toHaveCount(0);
  const barAfter = page.locator(`#gantt-body .gantt-bar[data-task-id="${taskId}"]`).first();
  await expect(barAfter).not.toHaveAttribute("fill", "#ff00aa");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3c. Show / hide grid columns
// ─────────────────────────────────────────────────────────────────────────────
test("choose columns dialog hides and restores grid columns and persists", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Column task");

  // The Resource column starts visible
  await expect(page.locator('thead th', { hasText: "Resource" })).toBeVisible();
  await expect(page.locator('tbody tr td[data-key="resource"]').first()).toHaveCount(1);

  // Open Tools → Choose Columns…
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("menuitem", { name: "Choose Columns" }).click();
  await expect(page.getByRole("dialog")).toContainText("Choose Columns");

  // Untick "Resource" and "Tags", then Apply
  await page.locator('input[data-col-key="resource"]').uncheck();
  await page.locator('input[data-col-key="tags"]').uncheck();
  await page.getByRole("button", { name: "Apply" }).click();

  // Those columns disappear from header and body
  await expect(page.locator('tbody tr td[data-key="resource"]')).toHaveCount(0);
  await expect(page.locator('tbody tr td[data-key="tags"]')).toHaveCount(0);
  // Always-visible columns remain
  await expect(page.locator('tbody tr td[data-key="title"]').first()).toHaveCount(1);
  await expect(page.locator('tbody tr td[data-key="actions"]').first()).toHaveCount(1);

  // Choice persists across reload
  await page.reload();
  await expect(page.locator("#loading-overlay")).toBeHidden({ timeout: 30000 });
  await expect(page.locator('tbody tr td[data-key="resource"]')).toHaveCount(0);

  // Re-open and Show All restores everything
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("menuitem", { name: "Choose Columns" }).click();
  await page.getByRole("button", { name: "Show All" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator('tbody tr td[data-key="resource"]').first()).toHaveCount(1);
  await expect(page.locator('tbody tr td[data-key="tags"]').first()).toHaveCount(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Gantt zoom controls
// ─────────────────────────────────────────────────────────────────────────────
test("editing planned start date shifts planned end date by the same working span", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Shifted schedule");

  await editCell(page, "Shifted schedule", "start_date", "2026-06-01");
  await editCell(page, "Shifted schedule", "end_date", "2026-06-05");
  await editCell(page, "Shifted schedule", "start_date", "2026-06-08");

  await expect(rowByTitle(page, "Shifted schedule").locator('td[data-key="start_date"]')).toHaveText("2026-06-08");
  await expect(rowByTitle(page, "Shifted schedule").locator('td[data-key="end_date"]')).toHaveText("2026-06-12");
});

test("gantt can show custom task text above bars", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Named Gantt task");

  await editCell(page, "Named Gantt task", "start_date", "2026-06-01");
  await editCell(page, "Named Gantt task", "end_date", "2026-06-05");
  await editCell(page, "Named Gantt task", "duration_hours", "40");
  await editCell(page, "Named Gantt task", "gantt_label", "Launch marker");

  await answerPrompts(page, ["custom", "above"], () => runTool(page, "Gantt Label Settings"));

  const label = page.locator("#gantt-body .gantt-label", { hasText: "Launch marker" });
  await expect(label).toHaveCount(1);
  const positions = await page.locator("#gantt-body").evaluate(body => {
    const labelNode = body.querySelector(".gantt-label");
    const bar = body.querySelector(".gantt-bar");
    return {
      labelY: Number(labelNode?.getAttribute("y")),
      barY: Number(bar?.getAttribute("y"))
    };
  });
  expect(positions.labelY).toBeLessThan(positions.barY);
});

test("clicking a gantt bar edits custom timeline text and position", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Clickable Gantt task");

  await editCell(page, "Clickable Gantt task", "start_date", "2026-06-01");
  await editCell(page, "Clickable Gantt task", "end_date", "2026-06-05");
  await editCell(page, "Clickable Gantt task", "duration_hours", "40");

  await page.locator("#gantt-body .gantt-bar").first().click();
  await expect(page.getByRole("dialog")).toContainText("Gantt Timeline Text");
  await page.getByPlaceholder("Custom text shown on this Gantt bar").fill("Checkpoint");
  await page.getByRole("button", { name: "Below" }).click();
  await page.getByLabel("Text color").evaluate(node => {
    node.value = "#ff00aa";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByLabel("Font").selectOption({ label: "Georgia" });
  await page.getByRole("button", { name: "Save" }).click();

  let label = page.locator("#gantt-body .gantt-label", { hasText: "Checkpoint" });
  await expect(label).toHaveCount(1);
  let positions = await page.locator("#gantt-body").evaluate(body => {
    const labelNode = body.querySelector(".gantt-label");
    const bar = body.querySelector(".gantt-bar");
    return {
      labelY: Number(labelNode?.getAttribute("y")),
      barY: Number(bar?.getAttribute("y")),
      barHeight: Number(bar?.getAttribute("height"))
    };
  });
  expect(positions.labelY).toBeGreaterThan(positions.barY + positions.barHeight);
  await expect(label).toHaveAttribute("fill", "#ff00aa");
  await expect(label).toHaveAttribute("font-family", "Georgia, serif");

  await page.locator("#gantt-body .gantt-bar").first().click();
  await page.getByPlaceholder("Custom text shown on this Gantt bar").fill("Review gate");
  await page.getByRole("button", { name: "Above" }).click();
  await page.getByLabel("Text color").evaluate(node => {
    node.value = "#00ffaa";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByLabel("Font").selectOption({ label: "Courier" });
  await page.getByRole("button", { name: "Save" }).click();
  label = page.locator("#gantt-body .gantt-label", { hasText: "Review gate" });
  await expect(label).toHaveCount(1);
  positions = await page.locator("#gantt-body").evaluate(body => {
    const labelNode = body.querySelector(".gantt-label");
    const bar = body.querySelector(".gantt-bar");
    return {
      labelY: Number(labelNode?.getAttribute("y")),
      barY: Number(bar?.getAttribute("y"))
    };
  });
  expect(positions.labelY).toBeLessThan(positions.barY);
  await expect(label).toHaveAttribute("fill", "#00ffaa");
  await expect(label).toHaveAttribute("font-family", "'Courier New', monospace");

  await page.locator("#gantt-body .gantt-bar").first().click();
  await page.getByPlaceholder("Custom text shown on this Gantt bar").fill("Middle note");
  await page.getByRole("button", { name: "Middle" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  label = page.locator("#gantt-body .gantt-label", { hasText: "Middle note" });
  await expect(label).toHaveCount(1);
  positions = await page.locator("#gantt-body").evaluate(body => {
    const labelNode = body.querySelector(".gantt-label");
    const bar = body.querySelector(".gantt-bar");
    return {
      labelY: Number(labelNode?.getAttribute("y")),
      labelX: Number(labelNode?.getAttribute("x")),
      barY: Number(bar?.getAttribute("y")),
      barX: Number(bar?.getAttribute("x")),
      barWidth: Number(bar?.getAttribute("width")),
      barHeight: Number(bar?.getAttribute("height")),
      anchor: labelNode?.getAttribute("text-anchor")
    };
  });
  expect(positions.labelY).toBeGreaterThan(positions.barY);
  expect(positions.labelY).toBeLessThan(positions.barY + positions.barHeight);
  expect(positions.labelX).toBeCloseTo(positions.barX + positions.barWidth / 2, 1);
  expect(positions.anchor).toBe("middle");
});

test("gantt renders current date and custom date or task aligned lines", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Line marker task");

  await editCell(page, "Line marker task", "start_date", isoDateFromToday(-2));
  await editCell(page, "Line marker task", "end_date", isoDateFromToday(3));
  await editCell(page, "Line marker task", "duration_hours", "40");

  await expect(page.locator('#gantt-body [data-role="current-date-line"]')).toHaveCount(1);

  await runTool(page, "Gantt Lines");
  await expect(page.getByRole("dialog")).toContainText("Gantt Lines");
  await page.getByRole("textbox", { name: "Date" }).fill(isoDateFromToday(1));
  await page.getByLabel("Line color").evaluate(node => {
    node.value = "#ff00aa";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByLabel("Line thickness").fill("4");
  await page.getByRole("button", { name: "Add Line" }).click();

  await page.getByLabel("Line alignment").selectOption("task");
  await page.getByLabel("Line color").evaluate(node => {
    node.value = "#00ffaa";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByLabel("Line thickness").fill("3");
  await page.getByRole("button", { name: "Add Line" }).click();
  await page.getByRole("button", { name: "Apply" }).click();

  const dateLine = page.locator('#gantt-body [data-role="custom-gantt-line"][data-line-type="date"]');
  await expect(dateLine).toHaveCount(1);
  await expect(dateLine).toHaveAttribute("stroke", "#ff00aa");
  await expect(dateLine).toHaveAttribute("stroke-width", "4");

  const taskLine = page.locator('#gantt-body [data-role="custom-gantt-line"][data-line-type="task"]');
  await expect(taskLine).toHaveCount(1);
  await expect(taskLine).toHaveAttribute("stroke", "#00ffaa");
  await expect(taskLine).toHaveAttribute("stroke-width", "3");
  const geometry = await page.locator("#gantt-body").evaluate(body => {
    const line = body.querySelector('[data-role="custom-gantt-line"][data-line-type="task"]');
    return { y1: Number(line?.getAttribute("y1")), y2: Number(line?.getAttribute("y2")) };
  });
  expect(geometry.y1).toBe(19);
  expect(geometry.y2).toBe(19);
});

test("task grid columns can be reordered by mouse dragging headers and persist", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Reorder columns task");

  const source = await page.locator('thead th[data-col-key="color"]').boundingBox();
  const target = await page.locator('thead th[data-col-key="title"]').boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width - 5, target.y + target.height / 2, { steps: 20 });
  await page.mouse.up();

  const headerOrder = () => page.locator("thead th").evaluateAll(ths => ths.map(th => th.dataset.colKey).join("|"));
  await expect.poll(headerOrder, { timeout: 5000 }).toMatch(/title\|color\|gantt_label/);

  const row = rowByTitle(page, "Reorder columns task");
  await expect.poll(() => row.locator("td").evaluateAll(tds => tds.map(td => td.dataset.key).join("|")), { timeout: 5000 })
    .toMatch(/title\|color\|gantt_label/);

  await page.reload();
  await expect(page.locator("#loading-overlay")).toBeHidden({ timeout: 30000 });
  await expect.poll(headerOrder, { timeout: 5000 }).toMatch(/title\|color\|gantt_label/);
});

test("task grid auto-scrolls horizontally while dragging columns", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Reorder far columns task");

  const grid = page.locator("#grid-container");
  await grid.evaluate(node => { node.scrollLeft = node.scrollWidth; });
  await expect.poll(() => grid.evaluate(node => node.scrollLeft), { timeout: 5000 }).toBeGreaterThan(0);

  const source = await page.locator('thead th[data-col-key="comments"]').boundingBox();
  const gridBox = await grid.boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(gridBox.x + 8, source.y + source.height / 2, { steps: 30 });
  await expect.poll(() => grid.evaluate(node => node.scrollLeft), { timeout: 8000 }).toBe(0);

  const target = await page.locator('thead th[data-col-key="title"]').boundingBox();
  await page.mouse.move(target.x + 5, target.y + target.height / 2);
  await page.mouse.up();

  const headerOrder = () => page.locator("thead th").evaluateAll(ths => ths.map(th => th.dataset.colKey).join("|"));
  await expect.poll(headerOrder, { timeout: 5000 }).toMatch(/comments\|title/);
});

test("gantt zoom in and out buttons step through zoom levels", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Zoom task");
  await editCell(page, "Zoom task", "start_date", "2026-06-01");
  await editCell(page, "Zoom task", "end_date", "2026-06-10");

  const zoomLevel = page.locator("#gantt-zoom-level");
  const zoomIn = page.locator("#gantt-zoom-in");
  const zoomOut = page.locator("#gantt-zoom-out");

  // Default is 100%
  await expect(zoomLevel).toHaveText("100%");
  await expect(zoomOut).toBeEnabled();

  // Zoom in
  await zoomIn.click();
  await expect(zoomLevel).toHaveText("150%");
  await zoomIn.click();
  await expect(zoomLevel).toHaveText("200%");

  // Zoom back out
  await zoomOut.click();
  await expect(zoomLevel).toHaveText("150%");
  await zoomOut.click();
  await expect(zoomLevel).toHaveText("100%");

  // Zoom to minimum (25%) – button disables at the limit
  for (let i = 0; i < 3; i++) await zoomOut.click();
  await expect(zoomLevel).toHaveText("25%");
  await expect(zoomOut).toBeDisabled();

  // Zoom to maximum (400%) – button disables at the limit
  for (let i = 0; i < 7; i++) await zoomIn.click();
  await expect(zoomLevel).toHaveText("400%");
  await expect(zoomIn).toBeDisabled();
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Subtask folding – collapse all / expand all
// ─────────────────────────────────────────────────────────────────────────────
test("gantt scrolls edited task into view after schedule date changes", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Timeline anchor");
  await addTask(page, "Scroll target");

  await editCell(page, "Timeline anchor", "start_date", "2026-01-01");
  await editCell(page, "Timeline anchor", "end_date", "2026-01-02");
  await editCell(page, "Scroll target", "end_date", "2027-12-05");

  const ganttBody = page.locator("#gantt-body");
  await ganttBody.evaluate(node => { node.scrollLeft = 0; });
  await editCell(page, "Scroll target", "start_date", "2027-12-01");

  await expect.poll(() => ganttBody.evaluate(node => node.scrollLeft), { timeout: 5000 }).toBeGreaterThan(0);
});

test("subtask collapse toggle and collapse-all/expand-all buttons work", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Parent task");

  // Add two subtasks
  await rowByTitle(page, "Parent task").locator(".add-child").click();
  await page.locator('td[data-key="title"] input').fill("Child one");
  await page.locator('td[data-key="title"] input').press("Enter");
  await expect(rowByTitle(page, "Child one")).toBeVisible();

  await rowByTitle(page, "Parent task").locator(".add-child").click();
  await page.locator('td[data-key="title"] input').fill("Child two");
  await page.locator('td[data-key="title"] input').press("Enter");
  await expect(rowByTitle(page, "Child two")).toBeVisible();

  // Per-row collapse toggle (▾ = expanded, ▸ = collapsed)
  const toggle = rowByTitle(page, "Parent task").locator(".collapse-toggle");
  await expect(toggle).toHaveText("▾");
  await toggle.click();
  await expect(rowByTitle(page, "Child one")).toBeHidden();
  await expect(rowByTitle(page, "Child two")).toBeHidden();
  await expect(toggle).toHaveText("▸");

  await toggle.click();
  await expect(rowByTitle(page, "Child one")).toBeVisible();
  await expect(rowByTitle(page, "Child two")).toBeVisible();

  // Collapse all button
  await page.locator("#collapse-all-btn").click();
  await expect(rowByTitle(page, "Child one")).toBeHidden();
  await expect(rowByTitle(page, "Child two")).toBeHidden();

  // Expand all button
  await page.locator("#expand-all-btn").click();
  await expect(rowByTitle(page, "Child one")).toBeVisible();
  await expect(rowByTitle(page, "Child two")).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Dark / light theme toggle
// ─────────────────────────────────────────────────────────────────────────────
test("theme toggle switches between dark and light and persists", async ({ page }) => {
  await openApp(page);

  const btn = page.locator("#theme-toggle-btn");
  // Default is dark
  await expect(page.locator("body")).not.toHaveClass(/light/);
  await expect(btn).toHaveText("🌙");

  // Switch to light
  await btn.click();
  await expect(page.locator("body")).toHaveClass(/light/);
  await expect(btn).toHaveText("☀️");

  // Reload – preference should persist via localStorage
  await page.reload();
  await expect(page.locator("#loading-overlay")).toBeHidden({ timeout: 30000 });
  await expect(page.locator("body")).toHaveClass(/light/);
  await expect(page.locator("#theme-toggle-btn")).toHaveText("☀️");

  // Switch back to dark
  await page.locator("#theme-toggle-btn").click();
  await expect(page.locator("body")).not.toHaveClass(/light/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Predecessor auto-scheduling – dates shift on dependency save
// ─────────────────────────────────────────────────────────────────────────────
test("setting a predecessor auto-schedules task start and end dates", async ({ page }) => {
  await openApp(page);
  await addTask(page, "First task");
  await addTask(page, "Second task");

  // Give first task concrete dates
  await editCell(page, "First task", "start_date", "2026-06-01");
  await editCell(page, "First task", "end_date", "2026-06-05"); // Fri → FS would push Second to Mon 8th

  // Capture Second task's original start (today)
  const secondRow = rowByTitle(page, "Second task");
  const startBefore = await secondRow.locator('td[data-key="start_date"]').textContent();

  // Set FS dependency: Second depends on First
  await editCell(page, "Second task", "predecessors_display", "1");

  // Wait explicitly for the start_date to update (the async refresh takes a moment)
  const startCell = secondRow.locator('td[data-key="start_date"]');
  await expect(startCell).not.toHaveText(startBefore.trim(), { timeout: 5000 });

  const startAfter = (await startCell.textContent())?.trim() ?? "";
  expect(startAfter).not.toBe(startBefore.trim());
  // Monday after Friday June 5th
  expect(startAfter).toMatch(/^2026-06-08/);

  // End date must be on or after the new start
  const endAfter = (await secondRow.locator('td[data-key="end_date"]').textContent())?.trim() ?? "";
  expect(endAfter >= "2026-06-08").toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Calendar, baseline, sprint, board, filters, grouping, saved views
// ─────────────────────────────────────────────────────────────────────────────
test("calendar, baseline, sprint, board, filters, grouping, and saved views work together", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Sprint card");

  await answerPrompts(page, ["6", "1,2,3,4,5", "2026-12-25"], () => runTool(page, "Calendar Settings"));
  await answerPrompts(page, ["Sprint 1", "2020-01-01", "2035-12-31"], () => runTool(page, "Add Sprint"));
  await editCell(page, "Sprint card", "sprint_name", "1");
  await expect(rowByTitle(page, "Sprint card").locator('td[data-key="sprint_name"]')).toHaveText("Sprint 1");

  await answerPrompts(page, ["Baseline 1"], () => runTool(page, "Set Baseline"));
  await editCell(page, "Sprint card", "end_date", "2026-06-05");
  await page.locator("#filter-select").selectOption("baseline-variance");
  await expect(rowByTitle(page, "Sprint card")).toBeVisible();

  await runTool(page, "View Baseline");
  await expect(page.getByRole("dialog")).toContainText("Baseline 1");
  await page.getByRole("button", { name: "Close" }).click();

  await page.locator("#filter-select").selectOption("all");
  await page.locator("#view-select").selectOption("board");
  await page.locator("#group-select").selectOption("status");
  await expect(page.locator("#board-panel")).toBeVisible();
  await expect(page.locator(".board-card").filter({ hasText: "Sprint card" })).toBeVisible();

  const card = page.locator(".board-card").filter({ hasText: "Sprint card" }).first();
  const doneColumn = page.locator(".board-column").filter({ hasText: "Done" }).first();
  await card.dragTo(doneColumn);
  await expect(doneColumn.locator(".board-card").filter({ hasText: "Sprint card" })).toBeVisible();

  await page.locator("#view-select").selectOption("sprint");
  await page.locator("#filter-select").selectOption("current-sprint");
  await expect(page.locator("#board-title")).toHaveText("Sprint View");
  await expect(page.locator("#board-summary")).toContainText("h");

  await answerPrompts(page, ["Sprint planning view"], () => runTool(page, "Save View"));
  await expect(page.locator("#saved-view-select")).toContainText("Sprint planning view");
  await page.locator("#saved-view-select").selectOption({ label: "Baseline Variance" });
  await expect(page.locator("#filter-select")).toHaveValue("baseline-variance");

  await answerPrompts(page, ["Scenario A"], () => runTool(page, "Save Scenario"));
  await editCell(page, "Sprint card", "end_date", "2026-06-08");
  await answerPrompts(page, ["1"], () => runTool(page, "Compare Scenario"));
  await expect(page.getByRole("dialog")).toContainText("Scenario A");
  await page.getByRole("button", { name: "Close" }).click();

  await answerPrompts(page, ["Risk", "Capacity risk", "AK", "2026-06-10", "1", "Watch resource load"], () => runTool(page, "Add RAID Item"));
  await expect(page.locator("#board-title")).toHaveText("RAID And Change Log");
  await expect(page.locator("#board-container")).toContainText("Capacity risk");
  await answerPrompts(page, ["Scope", "Added analytics", "1", "Approved"], () => runTool(page, "Log Change"));
  await expect(page.locator("#board-container")).toContainText("Added analytics");

  await page.locator("#view-select").selectOption("dashboard");
  await expect(page.locator("#board-title")).toHaveText("Timeline Health");
  await expect(page.locator("#board-container")).toContainText("Critical Tasks");
  await page.locator("#view-select").selectOption("workload");
  await expect(page.locator("#board-title")).toHaveText("Resource Workload");
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Templates, child tasks, SQL/Excel/CSV/XML/GIF export
// ─────────────────────────────────────────────────────────────────────────────
test("templates, child tasks, SQL import/export, Excel export, and GIF export are available", async ({ page }, testInfo) => {
  test.setTimeout(150000);
  await openApp(page);

  // Agile template now has 9 tasks (added QA Test Planning as a parallel track)
  await page.locator("#template-select").selectOption("agile");
  await page.getByRole("button", { name: "Merge with existing tasks" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(9, { timeout: 15000 });

  // Child task – add, collapse, expand
  await page.locator("tbody tr").first().locator(".add-child").click();
  await page.locator('td[data-key="title"] input').fill("Child task");
  await page.locator('td[data-key="title"] input').press("Enter");
  await expect(rowByTitle(page, "Child task")).toBeVisible();
  await page.locator("tbody tr").first().locator(".collapse-toggle").click();
  await expect(rowByTitle(page, "Child task")).toBeHidden();
  await page.locator("tbody tr").first().locator(".collapse-toggle").click();
  await expect(rowByTitle(page, "Child task")).toBeVisible();

  // SQL export → import round-trip
  const [sqlDownload] = await Promise.all([
    page.waitForEvent("download"),
    runExport(page, "Export SQL")
  ]);
  expect(sqlDownload.suggestedFilename()).toBe("novaplan_export.sql");
  const sqlPath = testInfo.outputPath("novaplan_export.sql");
  await sqlDownload.saveAs(sqlPath);

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Import SQL" }).click()
  ]);
  await fileChooser.setFiles(sqlPath);
  // Use exact:true to avoid matching the "Import SQL/CSV" toolbar button
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(rowByTitle(page, "Child task")).toBeVisible();

  // Excel, CSV, Jira CSV, Project XML
  const [excelDownload] = await Promise.all([
    page.waitForEvent("download"),
    runExport(page, "Export Excel")
  ]);
  expect(excelDownload.suggestedFilename()).toBe("novaplan_export.xlsx");

  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    runExport(page, "Export CSV")
  ]);
  expect(csvDownload.suggestedFilename()).toBe("novaplan_tasks.csv");

  const [jiraDownload] = await Promise.all([
    page.waitForEvent("download"),
    runExport(page, "Export Jira CSV")
  ]);
  expect(jiraDownload.suggestedFilename()).toBe("novaplan_jira.csv");

  const [xmlDownload] = await Promise.all([
    page.waitForEvent("download"),
    runExport(page, "Export Project XML")
  ]);
  expect(xmlDownload.suggestedFilename()).toBe("novaplan_project.xml");

  // Gantt GIF – verify the export dialog and all mode options are present.
  // The actual GIF download relies on a dynamic ESM import from the gifenc CDN
  // which is not reliable in a headless file:// context, so we verify the UI
  // flow (menu → dialog → buttons) and cancel rather than await the download.
  await runExport(page, "Export Gantt GIF");
  await expect(page.getByRole("dialog")).toContainText("Export Gantt GIF");
  await expect(page.getByRole("button", { name: "Current viewport" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Full timeline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Animated sweep" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Reset database (Tools menu)
// ─────────────────────────────────────────────────────────────────────────────
test("reset database button wipes all tasks after two confirmations", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Task to be wiped");
  await expect(rowByTitle(page, "Task to be wiped")).toBeVisible();

  // Open Tools → Reset All Data…
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("menuitem", { name: "Reset All Data" }).click();

  // First confirmation dialog
  await expect(page.getByRole("dialog")).toContainText("Reset All Data");
  await page.getByRole("button", { name: "Delete Everything" }).click();

  // Second confirmation dialog
  await expect(page.getByRole("dialog")).toContainText("absolutely sure");
  await page.getByRole("button", { name: "Reset Now" }).click();

  // Grid should now be empty
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(page.locator("#task-count")).toHaveText("0 tasks");
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Critical path – no false Critical labels when no dependency network
// ─────────────────────────────────────────────────────────────────────────────
test("tasks with no dependencies and same duration do not show as Critical", async ({ page }) => {
  await openApp(page);
  await addTask(page, "Standalone A");
  await addTask(page, "Standalone B");

  // Both tasks created with today's date and identical duration → degenerate CPM
  // After our fix, the Crit column should be blank for both
  const critA = rowByTitle(page, "Standalone A").locator('td[data-key="is_critical"]');
  const critB = rowByTitle(page, "Standalone B").locator('td[data-key="is_critical"]');
  await expect(critA).toHaveText("");
  await expect(critB).toHaveText("");
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Template – all 4 templates load without error and have parallel tasks
// ─────────────────────────────────────────────────────────────────────────────
test("all four templates load successfully with expected task counts", async ({ page }) => {
  await openApp(page);

  const expectations = {
    agile:  9,  // Sprint Planning, Development, QA Test Planning, Code Review, Testing, Demo, Retro, Backlog Refinement, Daily Standups
    cicd:   7,  // Source Control, Build, Test Automation, Infrastructure Setup, Staging, Production, Monitoring
    launch: 6,  // Launch Scope, Landing Page, Beta Feedback, Release Candidate, Launch Comms, Post-launch Monitoring
    triage: 8   // Collect Bugs, Reproduce, Prioritize, Fix, Regression, Patch, Update Release Notes, Notify Stakeholders
  };

  for (const [name, count] of Object.entries(expectations)) {
    await page.locator("#template-select").selectOption(name);
    await page.getByRole("button", { name: "Replace existing tasks" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(count, { timeout: 15000 });
  }
});
