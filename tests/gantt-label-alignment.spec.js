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

// Sets a custom bar colour through the grid's Color column.
async function setBarColor(page, title, hex) {
  await cell(page, title, "color").locator("input.color-input").fill(hex);
  await expect(await ganttBar(page, title)).toHaveAttribute("fill", hex);
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

  test("a long title at the end of the timeline moves to the left of its bar", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2027-01-29");
    await addTask(page, LONG_TITLE, "2027-01-29", "2027-01-29");

    const label = await ganttLabel(page, LONG_TITLE);
    await expect(label).toHaveAttribute("data-position", "before");
    await expect(label).toHaveAttribute("text-anchor", "end");
    await expect(label).toHaveText(LONG_TITLE);
    const { x } = await barBox(page, LONG_TITLE);
    expect(await labelX(page, LONG_TITLE)).toBeCloseTo(x - PAD, 1);
  });

  test("a milestone label sits after the diamond", async ({ page }) => {
    await addTask(page, "Gate", "2026-11-02", "2026-11-02");
    // Zoom in so "Gate" fits a 1-day bar; only the milestone rule can then put it after the diamond.
    for (let i = 0; i < 12 && (await page.locator("#gantt-zoom-level").textContent()).trim() !== "400%"; i++) {
      await page.click("#gantt-zoom-in");
    }
    await expect(page.locator("#gantt-zoom-level")).toHaveText("400%");
    await rowByTitle(page, "Gate").locator(".milestone-toggle").check();

    // Wait for the re-render that draws the diamond; a too-long label is also "after" on a plain bar.
    await expect(await ganttBar(page, "Gate")).toHaveAttribute("data-cx", /.+/);
    const label = await ganttLabel(page, "Gate");
    await expect(label).toHaveAttribute("data-position", "after");
    await expect(label).toHaveAttribute("text-anchor", "start");
    const cx = Number(await (await ganttBar(page, "Gate")).getAttribute("data-cx"));
    expect(await labelX(page, "Gate")).toBeCloseTo(cx + 12 + PAD, 1);
  });

  test("milestone text above the diamond is centred on it", async ({ page }) => {
    await addTask(page, "Gate", "2026-11-02", "2026-11-02");
    await rowByTitle(page, "Gate").locator(".milestone-toggle").check();
    await expect(await ganttBar(page, "Gate")).toHaveAttribute("data-cx", /.+/);

    await setLabel(page, "Gate", { text: "Go", position: "above" });

    const label = await ganttLabel(page, "Gate");
    await expect(label).toHaveAttribute("data-position", "above");
    await expect(label).toHaveAttribute("text-anchor", "middle");
    const cx = Number(await (await ganttBar(page, "Gate")).getAttribute("data-cx"));
    expect(await labelX(page, "Gate")).toBeCloseTo(cx, 1);
  });

  test("a milestone at the end of the timeline puts its label to the left", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2027-01-29");
    await addTask(page, LONG_TITLE, "2027-01-29", "2027-01-29");
    await rowByTitle(page, LONG_TITLE).locator(".milestone-toggle").check();
    await expect(await ganttBar(page, LONG_TITLE)).toHaveAttribute("data-cx", /.+/);

    const label = await ganttLabel(page, LONG_TITLE);
    await expect(label).toHaveAttribute("data-position", "before");
    await expect(label).toHaveAttribute("text-anchor", "end");
    const cx = Number(await (await ganttBar(page, LONG_TITLE)).getAttribute("data-cx"));
    expect(await labelX(page, LONG_TITLE)).toBeCloseTo(cx - 12 - PAD, 1);
  });
});

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

  test("an explicitly chosen after position is kept at the end of the timeline", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2027-01-29");
    await addTask(page, "Omega", "2027-01-29", "2027-01-29");

    await setLabel(page, "Omega", { text: LONG_TITLE, position: "after" });

    const label = await ganttLabel(page, "Omega");
    await expect(label).toHaveText(LONG_TITLE);
    await expect(label).toHaveAttribute("data-position", "after");
    await expect(label).toHaveAttribute("text-anchor", "start");
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
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("data-position", "middle");
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

    const reopened = await openTextDialog(page, "Alpha");
    await expect(reopened.locator('button[data-align="right"]')).toHaveAttribute("aria-pressed", "false");
    await expect(reopened.locator('select[data-field="size"]')).toHaveValue("");
  });

  test("clearing the label in the grid also clears its style", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
    await setLabel(page, "Alpha", { text: "Go", position: "above", align: "right", size: "l" });
    await expect(await ganttLabel(page, "Alpha")).toHaveText("Go");

    for (const text of ["", "Hi"]) {
      await cell(page, "Alpha", "gantt_label").click();
      const input = cell(page, "Alpha", "gantt_label").locator("input");
      await input.fill(text);
      await input.press("Enter");
      // Wait for the save + re-render before the next edit.
      await expect(await ganttLabel(page, "Alpha")).toHaveText(text || "Alpha");
    }

    const label = await ganttLabel(page, "Alpha");
    await expect(label).toHaveAttribute("data-align", "");
    await expect(label).toHaveAttribute("font-size", "11");
  });
});

test.describe("Gantt label: dragging", () => {
  test("a right-aligned label follows the bar's right edge while it is moved", async ({ page }) => {
    await addTask(page, "Alpha", "2026-11-02", "2026-11-06");
    await setLabel(page, "Alpha", { text: "Go", position: "above", align: "right" });
    await expect(await ganttLabel(page, "Alpha")).toHaveAttribute("data-align", "right");

    const before = await barBox(page, "Alpha");

    const release = await dragHold(page, "Alpha", 36);
    const box = await barBox(page, "Alpha");
    expect(box.x).toBeGreaterThan(before.x);
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
