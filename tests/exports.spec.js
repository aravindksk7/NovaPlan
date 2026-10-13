const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const APP_URL = "file:///" + path.resolve(__dirname, "../NovaPlan.html").replace(/\\/g, "/");
const TRICKY_TITLE = 'Build, "core" & <ui>';

// Spans ~3 months so the Gantt is wider than the viewport and the animated sweep has room to pan.
const SEED_CSV = [
  "Task Name,Planned Start Date,Planned End Date,Resource,Comments,Milestone",
  "Design,2026-11-02,2026-11-06,Ana,First phase,No",
  `"Build, ""core"" & <ui>",2026-11-09,2026-12-18,Ben,"Line one\nLine two",No`,
  "Launch,2027-02-01,2027-02-01,Cy,,Yes"
].join("\n");

function rowByTitle(page, title) {
  return page.locator("tr[data-task-id]").filter({
    has: page.locator('td[data-key="title"]', { hasText: title })
  });
}

function cell(page, title, key) {
  return rowByTitle(page, title).locator(`td[data-key="${key}"]`);
}

async function importFile(page, name, buffer) {
  await page.setInputFiles("#import-file", { name, mimeType: "application/octet-stream", buffer });
  await page.locator(".modal-foot button", { hasText: "Import" }).click();
  await expect(page.locator(".toast.success", { hasText: "Import successful" })).toBeVisible();
}

// Design (summary) > Wireframes, Build (depends on Design), Launch (milestone).
async function seedPlan(page) {
  await importFile(page, "seed.csv", Buffer.from(SEED_CSV));
  await rowByTitle(page, "Design").locator(".add-child").click();
  await expect(page.locator('td[data-key="title"] input')).toBeFocused();
  await page.keyboard.type("Wireframes");
  await page.keyboard.press("Enter");
  await expect(rowByTitle(page, "Wireframes")).toHaveCount(1);

  await cell(page, "Build", "predecessors_display").click();
  const input = cell(page, "Build", "predecessors_display").locator("input");
  await input.fill("1");
  await input.press("Enter");
  await expect(cell(page, "Build", "predecessors_display")).toHaveText(/^1/);
}

// Picks an entry from the Export menu and returns the downloaded file.
async function exportAs(page, kind, gifMode) {
  await page.click("#export-menu-btn");
  const downloadPromise = page.waitForEvent("download", { timeout: 45000 });
  await page.click(`[data-export="${kind}"]`);
  if (gifMode) await page.locator(".modal-foot button", { hasText: gifMode }).click();
  const download = await downloadPromise;
  return { name: download.suggestedFilename(), buffer: fs.readFileSync(await download.path()) };
}

function parseCsvText(textValue) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < textValue.length; i++) {
    const ch = textValue[i];
    if (quoted && ch === '"' && textValue[i + 1] === '"') { value += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ",") { row.push(value); value = ""; }
    else if (!quoted && ch === "\n") { row.push(value); rows.push(row); row = []; value = ""; }
    else value += ch;
  }
  row.push(value);
  rows.push(row);
  const headers = rows.shift();
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}

// Walks the GIF block structure and returns its logical size and frame count.
function inspectGif(buffer) {
  const signature = buffer.subarray(0, 6).toString("latin1");
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const colorTableBytes = packed => (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
  let offset = 13 + colorTableBytes(buffer[10]);
  const skipSubBlocks = () => {
    while (buffer[offset] !== 0) offset += buffer[offset] + 1;
    offset++;
  };
  let frames = 0;
  let terminated = false;
  while (offset < buffer.length) {
    const marker = buffer[offset++];
    if (marker === 0x3b) { terminated = true; break; }
    if (marker === 0x21) { offset++; skipSubBlocks(); }
    else if (marker === 0x2c) {
      frames++;
      offset += 8;
      offset += 1 + colorTableBytes(buffer[offset]);
      offset++;
      skipSubBlocks();
    } else throw new Error(`Unexpected GIF block 0x${marker.toString(16)} at ${offset - 1}`);
  }
  return { signature, width, height, frames, terminated };
}

// Decodes the image in the browser and counts distinct colours, so a blank frame is caught.
async function distinctColors(page, buffer, mimeType) {
  return page.evaluate(async ({ base64, mimeType }) => {
    const img = new Image();
    img.src = `data:${mimeType};base64,${base64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return colors.size;
  }, { base64: buffer.toString("base64"), mimeType });
}

// Reads a workbook with the SheetJS copy the app has already loaded.
async function readWorkbook(page, buffer) {
  return page.evaluate(base64 => {
    const wb = XLSX.read(base64, { type: "base64" });
    return {
      sheetNames: wb.SheetNames,
      sheets: Object.fromEntries(wb.SheetNames.map(name => [name, XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" })]))
    };
  }, buffer.toString("base64"));
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await page.waitForSelector("#loading-overlay", { state: "hidden" });
  await page.waitForFunction(() => !document.getElementById("new-task-btn").disabled);
  await seedPlan(page);
});

test.describe("Text exports", () => {
  test("SQL export dumps every table with the task rows", async ({ page }) => {
    const { name, buffer } = await exportAs(page, "sql");
    const sql = buffer.toString("utf8");

    expect(name).toBe("novaplan_export.sql");
    for (const table of ["tasks", "dependencies", "project_settings", "sprints", "raid_items", "change_logs"]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql.match(/^INSERT INTO tasks /gm)).toHaveLength(4);
    expect(sql.match(/^INSERT INTO dependencies /gm)).toHaveLength(1);
    expect(sql).toContain(`'Build, "core" & <ui>'`);
    await expect(page.locator(".toast.success", { hasText: "SQL export created" })).toBeVisible();
  });

  test("SQL export restores the plan when imported back", async ({ page }) => {
    const { buffer } = await exportAs(page, "sql");

    await rowByTitle(page, "Launch").locator('td[data-key="title"]').click();
    await page.keyboard.press("Escape");
    await importFile(page, "novaplan_export.sql", buffer);

    await expect(page.locator("tr[data-task-id]")).toHaveCount(4);
    await expect(cell(page, "Build", "predecessors_display")).toHaveText(/^1/);
    await expect(cell(page, "Wireframes", "wbs_code")).toHaveText("1.1");
  });

  test("CSV export has one quoted row per task", async ({ page }) => {
    const { name, buffer } = await exportAs(page, "csv");
    const rows = parseCsvText(buffer.toString("utf8"));

    expect(name).toBe("novaplan_tasks.csv");
    expect(rows.map(row => row["Task Name"])).toEqual(["Design", "Wireframes", TRICKY_TITLE, "Launch"]);
    const build = rows.find(row => row["Task Name"] === TRICKY_TITLE);
    expect(build["Planned End Date"]).toBe("2026-12-18");
    expect(build.Resource).toBe("Ben");
    expect(build.Comments).toBe("Line one\nLine two");
    expect(build.Predecessors).toMatch(/^1/);
    expect(rows.find(row => row["Task Name"] === "Wireframes")["Parent WBS"]).toBe("1");
    expect(rows.find(row => row["Task Name"] === "Launch").Milestone).toBe("Yes");
    expect(rows.find(row => row["Task Name"] === "Design").Summary).toBe("Yes");
  });

  test("Jira CSV export skips summary tasks", async ({ page }) => {
    const { name, buffer } = await exportAs(page, "jira-csv");
    const rows = parseCsvText(buffer.toString("utf8"));

    expect(name).toBe("novaplan_jira.csv");
    expect(rows.map(row => row.Summary)).toEqual(["Wireframes", TRICKY_TITLE, "Launch"]);
    const build = rows.find(row => row.Summary === TRICKY_TITLE);
    expect(build.Assignee).toBe("Ben");
    expect(build["Due Date"]).toBe("2026-12-18");
    expect(build["Original Estimate"]).toMatch(/^\d+(\.\d+)?h$/);
  });

  test("Project XML export is well formed and escapes task names", async ({ page }) => {
    const { name, buffer } = await exportAs(page, "project-xml");

    expect(name).toBe("novaplan_project.xml");
    const parsed = await page.evaluate(xml => {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      return {
        error: doc.querySelector("parsererror")?.textContent || "",
        tasks: [...doc.querySelectorAll("Project > Tasks > Task")].map(task => ({
          name: task.querySelector("Name").textContent,
          wbs: task.querySelector("WBS").textContent,
          finish: task.querySelector("Finish").textContent,
          milestone: task.querySelector("Milestone").textContent
        }))
      };
    }, buffer.toString("utf8"));

    expect(parsed.error).toBe("");
    expect(parsed.tasks.map(task => [task.wbs, task.name])).toEqual([
      ["1", "Design"], ["1.1", "Wireframes"], ["2", TRICKY_TITLE], ["3", "Launch"]
    ]);
    expect(parsed.tasks[3].milestone).toBe("1");
  });
});

test.describe("Excel export", () => {
  test("workbook has the seven documented sheets with task and dependency rows", async ({ page }) => {
    const { name, buffer } = await exportAs(page, "excel");
    const wb = await readWorkbook(page, buffer);

    expect(name).toBe("novaplan_export.xlsx");
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(wb.sheetNames).toEqual(["Tasks", "Dependencies", "Summary", "Workload", "RAID", "Change Log", "Scenarios"]);
    expect(wb.sheets.Tasks.map(row => row["Task Name"])).toEqual(["Design", "Wireframes", TRICKY_TITLE, "Launch"]);
    expect(wb.sheets.Tasks[1]["Parent WBS"]).toBe("1");
    expect(wb.sheets.Dependencies).toHaveLength(1);
    expect(wb.sheets.Dependencies[0]).toMatchObject({
      "Successor Task": TRICKY_TITLE,
      "Predecessor WBS": "1",
      "Predecessor Task": "Design",
      Type: "FS"
    });
    expect(wb.sheets.Summary.find(row => row.Metric === "Total tasks").Value).toBe(4);
    await expect(page.locator(".toast.success", { hasText: "Excel export created" })).toBeVisible();
  });
});

test.describe("Gantt GIF export", () => {
  for (const [mode, minFrames] of [["Current viewport", 1], ["Full timeline", 1], ["Animated sweep", 8]]) {
    test(`${mode} produces a non-blank GIF`, async ({ page }) => {
      const { name, buffer } = await exportAs(page, "gif", mode);
      const gif = inspectGif(buffer);

      expect(name).toBe("novaplan_gantt.gif");
      expect(gif.signature).toBe("GIF89a");
      expect(gif.terminated).toBe(true);
      expect(gif.width).toBeGreaterThan(200);
      expect(gif.height).toBeGreaterThanOrEqual(220);
      if (minFrames === 1) expect(gif.frames).toBe(1);
      else expect(gif.frames).toBeGreaterThanOrEqual(minFrames);
      expect(await distinctColors(page, buffer, "image/gif")).toBeGreaterThan(4);
      await expect(page.locator(".toast.success", { hasText: "Gantt GIF export created" })).toBeVisible();
      await expect(page.locator(".toast.error")).toHaveCount(0);
      await expect(page.locator("#export-menu-btn")).toBeEnabled();
    });
  }

  test("cancelling the mode dialog exports nothing", async ({ page }) => {
    await page.click("#export-menu-btn");
    await page.click('[data-export="gif"]');
    await page.locator(".modal-foot button", { hasText: "Cancel" }).click();

    await expect(page.locator(".toast")).toHaveCount(0);
    await expect(page.locator("#export-menu-btn")).toBeEnabled();
  });
});
