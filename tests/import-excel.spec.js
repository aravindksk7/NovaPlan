const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const APP_URL = "file:///" + path.resolve(__dirname, "../NovaPlan.html").replace(/\\/g, "/");
const XLSX_URL = "https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js";

function rowByTitle(page, title) {
  return page.locator("tr[data-task-id]").filter({
    has: page.locator('td[data-key="title"]', { hasText: title })
  });
}

function cell(page, title, key) {
  return rowByTitle(page, title).locator(`td[data-key="${key}"]`);
}

async function addRoot(page, title) {
  await page.click("#new-task-btn");
  await expect(page.locator('td[data-key="title"] input')).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(rowByTitle(page, title)).toHaveCount(1);
}

async function addChild(page, parentTitle, title) {
  await rowByTitle(page, parentTitle).locator(".add-child").click();
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
}

// [[wbs, title, predecessors], ...] in display order
async function outline(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("tr[data-task-id]")].map(row => [
      row.querySelector('td[data-key="wbs_code"]').textContent.trim(),
      row.querySelector('td[data-key="title"]').textContent.replace(/[▸▾◆]/g, "").trim(),
      row.querySelector('td[data-key="predecessors_display"]').textContent.trim()
    ])
  );
}

// Builds an .xlsx in a separate page so the app itself has not loaded SheetJS yet.
// sheets: { name: rows[] }; a cell value of { date: "yyyy-mm-dd" } becomes a real Excel date cell.
async function buildWorkbook(context, sheets) {
  const builder = await context.newPage();
  await builder.addScriptTag({ url: XLSX_URL });
  const base64 = await builder.evaluate(sheets => {
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) {
      const revived = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key, value && typeof value === "object" ? new Date(`${value.date}T00:00:00Z`) : value])));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(revived, { cellDates: true, UTC: true }), name);
    }
    return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  }, sheets);
  await builder.close();
  return Buffer.from(base64, "base64");
}

async function chooseImportFile(page, name, buffer) {
  await page.setInputFiles("#import-file", { name, mimeType: "application/octet-stream", buffer });
}

async function importWorkbook(page, buffer, name = "plan.xlsx") {
  await chooseImportFile(page, name, buffer);
  await expect(page.locator("#modal-title")).toHaveText("Import Excel");
  await page.locator(".modal-foot button", { hasText: "Import" }).click();
}

async function exportExcel(page) {
  await page.click("#export-menu-btn");
  const downloadPromise = page.waitForEvent("download", { timeout: 45000 });
  await page.click('[data-export="excel"]');
  return fs.readFileSync(await (await downloadPromise).path());
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await page.waitForSelector("#loading-overlay", { state: "hidden" });
  await page.waitForFunction(() => !document.getElementById("new-task-btn").disabled);
});

test.describe("Excel import", () => {
  test("import control offers Excel files", async ({ page }) => {
    await expect(page.locator("#import-btn")).toHaveText("Import SQL/CSV/Excel");
    expect(await page.locator("#import-file").getAttribute("accept")).toBe(".sql,.csv,.xlsx");
  });

  test("an exported workbook is appended with its outline and dependencies", async ({ page }) => {
    await addRoot(page, "Design");
    await setCell(page, "Design", "start_date", "2026-11-02");
    await setCell(page, "Design", "end_date", "2026-11-06");
    await addChild(page, "Design", "Wireframes");
    await addChild(page, "Design", "Mockups");
    await addRoot(page, "Build");
    await setCell(page, "Build", "predecessors_display", "1FS+2d");
    await expect(cell(page, "Build", "predecessors_display")).toHaveText("1FS+2d");
    await setCell(page, "Build", "resource", "Ben");
    const before = await outline(page);
    const buildDates = [await cell(page, "Build", "start_date").textContent(), await cell(page, "Build", "end_date").textContent()];

    await importWorkbook(page, await exportExcel(page), "novaplan_export.xlsx");

    await expect(page.locator(".toast.success", { hasText: "Import successful" })).toBeVisible();
    expect(await outline(page)).toEqual([
      ...before,
      ["3", "Design", ""],
      ["3.1", "Wireframes", ""],
      ["3.2", "Mockups", ""],
      ["4", "Build", "3FS+2d"]
    ]);
    const copy = rowByTitle(page, "Build").nth(1);
    await expect(copy.locator('td[data-key="resource"]')).toHaveText("Ben");
    await expect(copy.locator('td[data-key="start_date"]')).toHaveText(buildDates[0]);
    await expect(copy.locator('td[data-key="end_date"]')).toHaveText(buildDates[1]);
  });

  test("task type and custom colour survive an export and re-import", async ({ page }) => {
    await addRoot(page, "Crash");
    await cell(page, "Crash", "task_type").click();
    await cell(page, "Crash", "task_type").locator("select").selectOption({ label: "🐛 Bug" });
    await page.keyboard.press("Enter");
    await expect(cell(page, "Crash", "task_type")).toHaveText("🐛 Bug");
    await cell(page, "Crash", "color").locator("input.color-input").fill("#12ab34");
    await expect(cell(page, "Crash", "color").locator(".color-clear")).toHaveCount(1);
    await addRoot(page, "Plain");
    await addRoot(page, "Saga");
    await cell(page, "Saga", "task_type").click();
    await cell(page, "Saga", "task_type").locator("select").selectOption({ label: "🎯 Epic" });
    await page.keyboard.press("Enter");
    await expect(cell(page, "Saga", "task_type")).toHaveText("🎯 Epic");
    const barFill = async row => page.locator(`#gantt-body .gantt-bar[data-task-id="${await row.getAttribute("data-task-id")}"]`).getAttribute("fill");
    const sagaFill = await barFill(rowByTitle(page, "Saga"));
    const plainFill = await barFill(rowByTitle(page, "Plain"));
    expect(sagaFill).not.toBe(plainFill);

    await importWorkbook(page, await exportExcel(page), "novaplan_export.xlsx");

    await expect(page.locator(".toast.success", { hasText: "Import successful" })).toBeVisible();
    // With no custom colour the Gantt bar takes its colour from the task type.
    expect(await barFill(rowByTitle(page, "Saga").nth(1))).toBe(sagaFill);
    expect(await barFill(rowByTitle(page, "Crash").nth(1))).toBe(await barFill(rowByTitle(page, "Crash").nth(0)));
    const copy = rowByTitle(page, "Crash").nth(1);
    await expect(copy.locator('td[data-key="task_type"]')).toHaveText("🐛 Bug");
    await expect(copy.locator('td[data-key="color"] input.color-input')).toHaveValue("#12ab34");
    await expect(copy.locator('td[data-key="color"] .color-clear')).toHaveCount(1);
    // A task without a custom colour stays on its type colour.
    const plainCopy = rowByTitle(page, "Plain").nth(1);
    await expect(plainCopy.locator('td[data-key="task_type"]')).toHaveText("✅ Task");
    await expect(plainCopy.locator('td[data-key="color"] .color-clear')).toHaveCount(0);
  });

  test("task type is recognised by icon, label or Jira-style column, else defaults to Task", async ({ page, context }) => {
    const dates = { "Planned Start Date": "2026-11-02", "Planned End Date": "2026-11-03" };
    const workbook = await buildWorkbook(context, {
      Tasks: [
        { "Task Name": "By label", Type: "story", "Issue Type": "", ...dates },
        { "Task Name": "By icon", Type: "🔬", "Issue Type": "", ...dates },
        { "Task Name": "By Jira column", Type: "", "Issue Type": "Bug", ...dates },
        { "Task Name": "Unknown", Type: "Wibble", "Issue Type": "", ...dates }
      ]
    });

    await importWorkbook(page, workbook);

    await expect(cell(page, "By label", "task_type")).toHaveText("📖 Story");
    await expect(cell(page, "By icon", "task_type")).toHaveText("🔬 Spike");
    await expect(cell(page, "By Jira column", "task_type")).toHaveText("🐛 Bug");
    await expect(cell(page, "Unknown", "task_type")).toHaveText("✅ Task");
  });

  test("a hand-made workbook with alias columns and Excel date cells imports", async ({ page, context }) => {
    const workbook = await buildWorkbook(context, {
      Plan: [
        { Title: "Survey", Start: { date: "2026-11-02" }, Finish: { date: "2026-11-06" }, Assignee: "Ana", Progress: 50 },
        { Title: "Report", Start: "2026-11-09", Finish: "2026-11-10", Assignee: "Ben", Progress: 0 },
        { Title: "", Start: "2026-11-11", Finish: "2026-11-12", Assignee: "Nobody", Progress: 0 }
      ]
    });
    expect(await page.evaluate(() => typeof window.XLSX)).toBe("undefined");

    await importWorkbook(page, workbook);

    await expect(page.locator(".toast.success", { hasText: "Import successful" })).toBeVisible();
    expect(await outline(page)).toEqual([["1", "Survey", ""], ["2", "Report", ""]]);
    await expect(cell(page, "Survey", "start_date")).toHaveText("2026-11-02");
    await expect(cell(page, "Survey", "end_date")).toHaveText("2026-11-06");
    await expect(cell(page, "Survey", "resource")).toHaveText("Ana");
    await expect(cell(page, "Survey", "progress")).toHaveText(/50/);
    await expect(cell(page, "Report", "end_date")).toHaveText("2026-11-10");
  });

  // Excel date cells carry no time zone; the day must not shift either side of UTC.
  for (const timezoneId of ["Asia/Kolkata", "America/Los_Angeles"]) {
    test.describe(`in ${timezoneId}`, () => {
      test.use({ timezoneId });

      test("Excel date cells keep their calendar day", async ({ page, context }) => {
        const workbook = await buildWorkbook(context, {
          Tasks: [{ "Task Name": "Dated", "Planned Start Date": { date: "2026-03-08" }, "Planned End Date": { date: "2026-11-01" } }]
        });

        await importWorkbook(page, workbook);

        await expect(cell(page, "Dated", "start_date")).toHaveText("2026-03-08");
        await expect(cell(page, "Dated", "end_date")).toHaveText("2026-11-01");
      });
    });
  }

  test("dependency type and lag come from the Dependencies sheet", async ({ page, context }) => {
    const workbook = await buildWorkbook(context, {
      Tasks: [
        { WBS: "1", "Task Name": "Alpha", "Planned Start Date": "2026-11-02", "Planned End Date": "2026-11-03" },
        { WBS: "2", "Task Name": "Bravo", "Planned Start Date": "2026-11-04", "Planned End Date": "2026-11-05" },
        { WBS: "3", "Task Name": "Charlie", "Planned Start Date": "2026-11-06", "Planned End Date": "2026-11-09" }
      ],
      Dependencies: [
        { "Successor WBS": "2", "Predecessor WBS": "1", Type: "SS", "Lag Hours": 16 },
        { "Successor WBS": "3", "Predecessor WBS": "1" },
        { "Successor WBS": "3", "Predecessor WBS": "2", Type: "ff", "Lag Hours": 0 }
      ]
    });

    await importWorkbook(page, workbook);

    await expect(page.locator(".toast.success", { hasText: "Import successful" })).toBeVisible();
    expect(await outline(page)).toEqual([["1", "Alpha", ""], ["2", "Bravo", "1SS+2d"], ["3", "Charlie", "1FS,2FF"]]);
    // Dates are imported as written, not rescheduled.
    await expect(cell(page, "Bravo", "start_date")).toHaveText("2026-11-04");
  });

  test("imported tasks are renumbered after the existing plan in workbook order", async ({ page, context }) => {
    await addRoot(page, "Existing");
    await addChild(page, "Existing", "Existing kid");
    const workbook = await buildWorkbook(context, {
      Tasks: [
        { WBS: "1", "Task Name": "Phase", "Parent WBS": "", "Planned Start Date": "2026-11-02", "Planned End Date": "2026-11-06" },
        { WBS: "1.1", "Task Name": "First", "Parent WBS": "1", "Planned Start Date": "2026-11-02", "Planned End Date": "2026-11-03" },
        { WBS: "1.2", "Task Name": "Second", "Parent WBS": "1", "Planned Start Date": "2026-11-04", "Planned End Date": "2026-11-05" },
        { WBS: "1.2.1", "Task Name": "Deep", "Parent WBS": "1.2", "Planned Start Date": "2026-11-04", "Planned End Date": "2026-11-05" },
        { WBS: "2", "Task Name": "Wrap up", "Parent WBS": "", "Planned Start Date": "2026-11-06", "Planned End Date": "2026-11-06" }
      ],
      Dependencies: [{ "Successor WBS": "2", "Predecessor WBS": "1.2.1", Type: "FS", "Lag Hours": 0 }]
    });

    await importWorkbook(page, workbook);

    await expect(page.locator(".toast.success", { hasText: "Import successful" })).toBeVisible();
    expect(await outline(page)).toEqual([
      ["1", "Existing", ""],
      ["1.1", "Existing kid", ""],
      ["2", "Phase", ""],
      ["2.1", "First", ""],
      ["2.2", "Second", ""],
      ["2.2.1", "Deep", ""],
      ["3", "Wrap up", "2.2.1FS"]
    ]);
  });

  test("references to tasks outside the workbook are skipped", async ({ page, context }) => {
    await addRoot(page, "Existing");
    const workbook = await buildWorkbook(context, {
      Tasks: [
        { WBS: "7", "Task Name": "Orphan", "Parent WBS": "1", "Planned Start Date": "2026-11-02", "Planned End Date": "2026-11-03" },
        { WBS: "8", "Task Name": "Loner", "Parent WBS": "", "Planned Start Date": "2026-11-04", "Planned End Date": "2026-11-05" }
      ],
      Dependencies: [
        { "Successor WBS": "8", "Predecessor WBS": "1", Type: "FS", "Lag Hours": 0 },
        { "Successor WBS": "99", "Predecessor WBS": "7", Type: "FS", "Lag Hours": 0 },
        { "Successor WBS": "8", "Predecessor WBS": "8", Type: "FS", "Lag Hours": 0 }
      ]
    });

    await importWorkbook(page, workbook);

    await expect(page.locator(".toast.success", { hasText: "Import successful" })).toBeVisible();
    expect(await outline(page)).toEqual([["1", "Existing", ""], ["2", "Orphan", ""], ["3", "Loner", ""]]);
  });

  test("an invalid row rolls the whole import back", async ({ page, context }) => {
    await addRoot(page, "Existing");
    const workbook = await buildWorkbook(context, {
      Tasks: [
        { "Task Name": "Good", "Planned Start Date": "2026-11-02", "Planned End Date": "2026-11-03" },
        { "Task Name": "Backwards", "Planned Start Date": "2026-11-10", "Planned End Date": "2026-11-01" }
      ]
    });

    await importWorkbook(page, workbook);

    await expect(page.locator(".toast.error", { hasText: "Import failed: Invalid date range" })).toBeVisible();
    expect(await outline(page)).toEqual([["1", "Existing", ""]]);
    await expect(page.locator("#import-btn")).toBeEnabled();
  });

  test("circular dependencies are rejected", async ({ page, context }) => {
    const workbook = await buildWorkbook(context, {
      Tasks: [
        { WBS: "1", "Task Name": "Chicken", "Planned Start Date": "2026-11-02", "Planned End Date": "2026-11-03" },
        { WBS: "2", "Task Name": "Egg", "Planned Start Date": "2026-11-04", "Planned End Date": "2026-11-05" }
      ],
      Dependencies: [
        { "Successor WBS": "2", "Predecessor WBS": "1", Type: "FS", "Lag Hours": 0 },
        { "Successor WBS": "1", "Predecessor WBS": "2", Type: "FS", "Lag Hours": 0 }
      ]
    });

    await importWorkbook(page, workbook);

    await expect(page.locator(".toast.error", { hasText: "Import failed: Circular dependency" })).toBeVisible();
    await expect(page.locator("tr[data-task-id]")).toHaveCount(0);
  });

  test("a parent loop is rejected", async ({ page, context }) => {
    const workbook = await buildWorkbook(context, {
      Tasks: [
        { WBS: "A", "Task Name": "Ouro", "Parent WBS": "B", "Planned Start Date": "2026-11-02", "Planned End Date": "2026-11-03" },
        { WBS: "B", "Task Name": "Boros", "Parent WBS": "A", "Planned Start Date": "2026-11-02", "Planned End Date": "2026-11-03" }
      ]
    });

    await importWorkbook(page, workbook);

    await expect(page.locator(".toast.error", { hasText: "Import failed: Circular parent reference" })).toBeVisible();
    await expect(page.locator("tr[data-task-id]")).toHaveCount(0);
  });

  test("a workbook without task rows is rejected", async ({ page, context }) => {
    const workbook = await buildWorkbook(context, { Notes: [{ Remark: "nothing to see" }] });

    await importWorkbook(page, workbook);

    await expect(page.locator(".toast.error", { hasText: "Import failed: Workbook has no task rows" })).toBeVisible();
    await expect(page.locator("tr[data-task-id]")).toHaveCount(0);
  });

  test("a file that is not a workbook is rejected", async ({ page }) => {
    await importWorkbook(page, Buffer.from("this is not a zip archive"), "broken.xlsx");

    await expect(page.locator(".toast.error", { hasText: "Import failed" })).toBeVisible();
    await expect(page.locator("tr[data-task-id]")).toHaveCount(0);
  });

  test("unsupported file types are refused", async ({ page }) => {
    await chooseImportFile(page, "plan.txt", Buffer.from("hello"));

    await expect(page.locator(".toast.error", { hasText: "Import file must be .sql, .csv or .xlsx" })).toBeVisible();
    await expect(page.locator(".modal-box")).toHaveCount(0);
  });
});
