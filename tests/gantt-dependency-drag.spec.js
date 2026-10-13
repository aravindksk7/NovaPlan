const { test, expect } = require("@playwright/test");
const path = require("path");

const APP_URL = "file:///" + path.resolve(__dirname, "../NovaPlan.html").replace(/\\/g, "/");
const BASE_PX_PER_DAY = 18;

function rowByTitle(page, title) {
  return page.locator("tr[data-task-id]").filter({
    has: page.locator('td[data-key="title"]', { hasText: title })
  });
}

function cell(page, title, key) {
  return rowByTitle(page, title).locator(`td[data-key="${key}"]`);
}

async function ganttBar(page, title) {
  const id = await rowByTitle(page, title).getAttribute("data-task-id");
  return page.locator(`#gantt-body .gantt-bar[data-task-id="${id}"]`);
}

async function waitForAppReady(page) {
  await page.waitForSelector("#loading-overlay", { state: "hidden" });
  await page.waitForFunction(() => !document.getElementById("new-task-btn").disabled);
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

async function editCell(page, title, key, value) {
  await cell(page, title, key).click();
  const input = cell(page, title, key).locator("input");
  await input.fill(value);
  await input.press("Enter");
  await expect(cell(page, title, key).locator("input")).toHaveCount(0);
}

async function setCell(page, title, key, value) {
  await editCell(page, title, key, value);
  await expect(cell(page, title, key)).toHaveText(value);
}

// Sets planned dates and, optionally, the Hours column so that both agree.
async function setSpan(page, title, start, end, hours) {
  await setCell(page, title, "start_date", start);
  await setCell(page, title, "end_date", end);
  if (hours != null) await setCell(page, title, "duration_hours", String(hours));
}

async function setPredecessors(page, title, value) {
  await editCell(page, title, "predecessors_display", value);
  await expect(cell(page, title, "predecessors_display")).not.toHaveText("");
}

async function expectSpan(page, title, start, end) {
  await expect(cell(page, title, "start_date")).toHaveText(start);
  await expect(cell(page, title, "end_date")).toHaveText(end);
}

async function expectHours(page, title, hours) {
  await expect(cell(page, title, "duration_hours")).toHaveText(String(hours));
}

async function pxPerDay(page) {
  const zoom = Number.parseInt(await page.locator("#gantt-zoom-level").textContent(), 10);
  return Math.round(BASE_PX_PER_DAY * zoom / 100);
}

// Drags a Gantt bar by whole days. grip: "middle" moves, "left"/"right" resize.
async function dragBar(page, title, days, grip = "middle") {
  const bar = await ganttBar(page, title);
  await bar.scrollIntoViewIfNeeded();
  const box = await bar.boundingBox();
  const dx = days * await pxPerDay(page);
  const x = grip === "left" ? box.x + 3 : grip === "right" ? box.x + box.width - 3 : box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
  // Let the async save + re-render settle before the caller reads the grid.
  await page.waitForTimeout(400);
}

// Alpha -> Bravo -> Charlie, each Mon-Fri (40h), chained finish-to-start.
async function buildChain(page) {
  await addRoot(page, "Alpha");
  await addRoot(page, "Bravo");
  await addRoot(page, "Charlie");
  await setSpan(page, "Alpha", "2026-11-02", "2026-11-06", 40);
  await setPredecessors(page, "Bravo", "1");
  await setSpan(page, "Bravo", "2026-11-09", "2026-11-13", 40);
  await setPredecessors(page, "Charlie", "2");
  await setSpan(page, "Charlie", "2026-11-16", "2026-11-20", 40);
  await expectSpan(page, "Alpha", "2026-11-02", "2026-11-06");
  await expectSpan(page, "Bravo", "2026-11-09", "2026-11-13");
  await expectSpan(page, "Charlie", "2026-11-16", "2026-11-20");
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

test.describe("Gantt drag: moving a dependent task", () => {
  test("moving a dependent task later keeps its working span and Hours", async ({ page }) => {
    await buildChain(page);

    await dragBar(page, "Bravo", 2);

    // Mon-Fri moved two days later is Wed-Tue: still 5 working days.
    await expectSpan(page, "Bravo", "2026-11-11", "2026-11-17");
    await expectHours(page, "Bravo", 40);
    await expectSpan(page, "Alpha", "2026-11-02", "2026-11-06");
    await expectHours(page, "Alpha", 40);
    await expect(cell(page, "Charlie", "predecessors_display")).toHaveText("2FS");
  });

  test("the gap left after a predecessor is recorded as lag and survives rescheduling", async ({ page }) => {
    await buildChain(page);

    await dragBar(page, "Bravo", 2);
    await expect(cell(page, "Bravo", "predecessors_display")).toHaveText("1FS+2d");

    await dragBar(page, "Alpha", 7);
    await expectSpan(page, "Alpha", "2026-11-09", "2026-11-13");
    await expectSpan(page, "Bravo", "2026-11-18", "2026-11-24");
    await expectSpan(page, "Charlie", "2026-11-25", "2026-12-01");
    await expect(cell(page, "Bravo", "predecessors_display")).toHaveText("1FS+2d");
  });

  test("moving a dependent task back toward its predecessor removes the lag", async ({ page }) => {
    await buildChain(page);
    await dragBar(page, "Bravo", 2);
    await expect(cell(page, "Bravo", "predecessors_display")).toHaveText("1FS+2d");

    await dragBar(page, "Bravo", -1);
    await expectSpan(page, "Bravo", "2026-11-10", "2026-11-16");
    await expect(cell(page, "Bravo", "predecessors_display")).toHaveText("1FS+1d");

    await dragBar(page, "Bravo", -7);
    await expectSpan(page, "Bravo", "2026-11-09", "2026-11-13");
    await expect(cell(page, "Bravo", "predecessors_display")).toHaveText("1FS");
  });

  test("a typed lead is kept when the task is held at its earliest date", async ({ page }) => {
    await addRoot(page, "Alpha");
    await addRoot(page, "Bravo");
    await setSpan(page, "Alpha", "2026-11-02", "2026-11-06", 40);
    await setPredecessors(page, "Bravo", "1FS-1d");
    await expectSpan(page, "Bravo", "2026-11-06", "2026-11-06");

    await dragBar(page, "Bravo", -3);

    await expectSpan(page, "Bravo", "2026-11-06", "2026-11-06");
    await expect(cell(page, "Bravo", "predecessors_display")).toHaveText("1FS-1d");
  });

  test("successors of the moved task follow and keep their own span and Hours", async ({ page }) => {
    await buildChain(page);

    await dragBar(page, "Bravo", 2);

    await expectSpan(page, "Charlie", "2026-11-18", "2026-11-24");
    await expectHours(page, "Charlie", 40);
  });

  test("a dependent task cannot be moved earlier than its predecessor allows", async ({ page }) => {
    await buildChain(page);

    await dragBar(page, "Bravo", -7);

    await expectSpan(page, "Bravo", "2026-11-09", "2026-11-13");
    await expectHours(page, "Bravo", 40);
    await expectSpan(page, "Charlie", "2026-11-16", "2026-11-20");
  });

  test("a move that lands on a weekend snaps to a working day in the drag direction", async ({ page }) => {
    await buildChain(page);

    // +5 days from Monday is Saturday -> next Monday.
    await dragBar(page, "Alpha", 5);
    await expectSpan(page, "Alpha", "2026-11-09", "2026-11-13");
    await expectHours(page, "Alpha", 40);

    // -9 days from Monday 11-09 is Saturday 10-31 -> previous Friday.
    await dragBar(page, "Alpha", -9);
    await expectSpan(page, "Alpha", "2026-10-30", "2026-11-05");
    await expectHours(page, "Alpha", 40);
  });

  test("moving the head of a chain shifts every dependent task", async ({ page }) => {
    await buildChain(page);

    await dragBar(page, "Alpha", 7);

    await expectSpan(page, "Alpha", "2026-11-09", "2026-11-13");
    await expectSpan(page, "Bravo", "2026-11-16", "2026-11-20");
    await expectSpan(page, "Charlie", "2026-11-23", "2026-11-27");
    for (const title of ["Alpha", "Bravo", "Charlie"]) await expectHours(page, title, 40);
  });

  test("moving the head of a chain earlier pulls dependents back", async ({ page }) => {
    await buildChain(page);

    await dragBar(page, "Alpha", -7);

    await expectSpan(page, "Alpha", "2026-10-26", "2026-10-30");
    await expectSpan(page, "Bravo", "2026-11-02", "2026-11-06");
    await expectSpan(page, "Charlie", "2026-11-09", "2026-11-13");
  });

  test("a successor sized only by its dates keeps its span and Hours", async ({ page }) => {
    await addRoot(page, "Alpha");
    await addRoot(page, "Bravo");
    await setSpan(page, "Alpha", "2026-11-02", "2026-11-06");
    await setPredecessors(page, "Bravo", "1");
    await setSpan(page, "Bravo", "2026-11-09", "2026-11-13");
    const hoursBefore = await cell(page, "Bravo", "duration_hours").textContent();

    await dragBar(page, "Alpha", 7);

    await expectSpan(page, "Bravo", "2026-11-16", "2026-11-20");
    await expectHours(page, "Bravo", hoursBefore);
  });

  test("the moved schedule survives a reload", async ({ page }) => {
    await buildChain(page);
    await dragBar(page, "Alpha", 7);
    await expectSpan(page, "Charlie", "2026-11-23", "2026-11-27");

    await page.reload();
    await waitForAppReady(page);

    await expectSpan(page, "Alpha", "2026-11-09", "2026-11-13");
    await expectSpan(page, "Bravo", "2026-11-16", "2026-11-20");
    await expectSpan(page, "Charlie", "2026-11-23", "2026-11-27");
  });

  test("drag distance is measured in days at other zoom levels", async ({ page }) => {
    await buildChain(page);
    await page.click("#gantt-zoom-in");
    await expect(page.locator("#gantt-zoom-level")).toHaveText("150%");

    await dragBar(page, "Alpha", 7);

    await expectSpan(page, "Alpha", "2026-11-09", "2026-11-13");
    await expectSpan(page, "Bravo", "2026-11-16", "2026-11-20");
  });
});

test.describe("Gantt drag: resizing", () => {
  test("extending a predecessor updates its Hours and pushes dependents", async ({ page }) => {
    await buildChain(page);

    // Friday + 3 days = Monday.
    await dragBar(page, "Alpha", 3, "right");

    await expectSpan(page, "Alpha", "2026-11-02", "2026-11-09");
    await expectHours(page, "Alpha", 48);
    await expectSpan(page, "Bravo", "2026-11-10", "2026-11-16");
    await expectHours(page, "Bravo", 40);
    await expectSpan(page, "Charlie", "2026-11-17", "2026-11-23");
  });

  test("an end dragged onto a weekend snaps to a working day", async ({ page }) => {
    await buildChain(page);

    // Friday + 1 day = Saturday -> Monday.
    await dragBar(page, "Alpha", 1, "right");

    await expectSpan(page, "Alpha", "2026-11-02", "2026-11-09");
    await expectHours(page, "Alpha", 48);
  });

  test("shortening a dependent task from the left changes only that task", async ({ page }) => {
    await buildChain(page);

    await dragBar(page, "Bravo", 1, "left");

    await expectSpan(page, "Bravo", "2026-11-10", "2026-11-13");
    await expectHours(page, "Bravo", 32);
    await expectSpan(page, "Charlie", "2026-11-16", "2026-11-20");
    await expectHours(page, "Charlie", 40);
  });

  test("a dependent task cannot be stretched to start before its predecessor allows", async ({ page }) => {
    await buildChain(page);

    await dragBar(page, "Bravo", -3, "left");

    await expectSpan(page, "Bravo", "2026-11-09", "2026-11-13");
    await expectHours(page, "Bravo", 40);
  });
});

test.describe("Gantt drag: finish-driven dependencies", () => {
  test("a finish-to-finish successor cannot be shortened to finish before its predecessor", async ({ page }) => {
    await addRoot(page, "Alpha");
    await addRoot(page, "Bravo");
    await setSpan(page, "Alpha", "2026-11-02", "2026-11-06", 40);
    await setSpan(page, "Bravo", "2026-11-04", "2026-11-06", 24);
    await setPredecessors(page, "Bravo", "1FF");
    await expectSpan(page, "Bravo", "2026-11-04", "2026-11-06");

    await dragBar(page, "Bravo", -1, "right");

    await expectSpan(page, "Bravo", "2026-11-04", "2026-11-06");
    await expect(cell(page, "Bravo", "predecessors_display")).toHaveText("1FF");
  });

  test("extending a finish-to-finish successor records the overrun as lag", async ({ page }) => {
    await addRoot(page, "Alpha");
    await addRoot(page, "Bravo");
    await setSpan(page, "Alpha", "2026-11-02", "2026-11-06", 40);
    await setSpan(page, "Bravo", "2026-11-04", "2026-11-06", 24);
    await setPredecessors(page, "Bravo", "1FF");

    await dragBar(page, "Bravo", 3, "right");

    await expectSpan(page, "Bravo", "2026-11-04", "2026-11-09");
    await expectHours(page, "Bravo", 32);
    await expect(cell(page, "Bravo", "predecessors_display")).toHaveText("1FF+1d");
  });
});

test.describe("Gantt drag: dependency types", () => {
  test("SS, FF and SF successors with lag follow the moved predecessor", async ({ page }) => {
    for (const title of ["Alpha", "StartStart", "FinishFinish", "StartFinish"]) await addRoot(page, title);
    await setSpan(page, "Alpha", "2026-11-02", "2026-11-06", 40);
    await setPredecessors(page, "StartStart", "1SS+1d");
    await setPredecessors(page, "FinishFinish", "1FF");
    await setPredecessors(page, "StartFinish", "1SF+2d");
    await expectSpan(page, "StartStart", "2026-11-03", "2026-11-03");
    await expectSpan(page, "FinishFinish", "2026-11-06", "2026-11-06");
    await expectSpan(page, "StartFinish", "2026-11-04", "2026-11-04");

    await dragBar(page, "Alpha", 7);

    await expectSpan(page, "StartStart", "2026-11-10", "2026-11-10");
    await expectSpan(page, "FinishFinish", "2026-11-13", "2026-11-13");
    await expectSpan(page, "StartFinish", "2026-11-11", "2026-11-11");
    await expect(cell(page, "StartStart", "predecessors_display")).toHaveText("1SS+1d");
    await expect(cell(page, "StartFinish", "predecessors_display")).toHaveText("1SF+2d");
  });

  test("a task with two predecessors follows the later one", async ({ page }) => {
    for (const title of ["Alpha", "Bravo", "Merge"]) await addRoot(page, title);
    await setSpan(page, "Alpha", "2026-11-02", "2026-11-06", 40);
    await setSpan(page, "Bravo", "2026-11-02", "2026-11-03", 16);
    await setPredecessors(page, "Merge", "1,2");
    await expectSpan(page, "Merge", "2026-11-09", "2026-11-09");

    // Bravo still finishes before Alpha: Merge stays put.
    await dragBar(page, "Bravo", 1);
    await expectSpan(page, "Bravo", "2026-11-03", "2026-11-04");
    await expectSpan(page, "Merge", "2026-11-09", "2026-11-09");

    // Bravo now finishes after Alpha: Merge follows Bravo.
    await dragBar(page, "Bravo", 7);
    await expectSpan(page, "Bravo", "2026-11-10", "2026-11-11");
    await expectSpan(page, "Merge", "2026-11-12", "2026-11-12");
  });

  test("a milestone successor follows and stays a single-day milestone", async ({ page }) => {
    await addRoot(page, "Alpha");
    await addRoot(page, "Gate");
    await setSpan(page, "Alpha", "2026-11-02", "2026-11-06", 40);
    await rowByTitle(page, "Gate").locator(".milestone-toggle").check();
    await setPredecessors(page, "Gate", "1");
    await expectSpan(page, "Gate", "2026-11-09", "2026-11-09");
    const hoursBefore = await cell(page, "Gate", "duration_hours").textContent();

    await dragBar(page, "Alpha", 7);

    await expectSpan(page, "Gate", "2026-11-16", "2026-11-16");
    await expectHours(page, "Gate", hoursBefore);
    await expect(rowByTitle(page, "Gate").locator(".milestone-toggle")).toBeChecked();
  });

  test("moving a milestone shifts its successor", async ({ page }) => {
    await addRoot(page, "Gate");
    await addRoot(page, "After");
    await setSpan(page, "Gate", "2026-11-02", "2026-11-02");
    await rowByTitle(page, "Gate").locator(".milestone-toggle").check();
    await setPredecessors(page, "After", "1");
    await expectSpan(page, "After", "2026-11-03", "2026-11-03");

    await dragBar(page, "Gate", 2);

    await expectSpan(page, "Gate", "2026-11-04", "2026-11-04");
    await expectSpan(page, "After", "2026-11-05", "2026-11-05");
  });
});

test.describe("Gantt drag: summary tasks", () => {
  async function buildPhase(page) {
    await addRoot(page, "Phase");
    await addChild(page, "Phase", "Design");
    await addChild(page, "Phase", "Build");
    await addRoot(page, "Launch");
    await setSpan(page, "Design", "2026-11-02", "2026-11-03", 16);
    await setSpan(page, "Build", "2026-11-04", "2026-11-06", 24);
    await setPredecessors(page, "Launch", "1");
    await expectSpan(page, "Phase", "2026-11-02", "2026-11-06");
    await expectSpan(page, "Launch", "2026-11-09", "2026-11-09");
  }

  test("moving a child updates the parent rollup and the parent's successor", async ({ page }) => {
    await buildPhase(page);

    await dragBar(page, "Build", 7);

    await expectSpan(page, "Build", "2026-11-11", "2026-11-13");
    await expectHours(page, "Build", 24);
    await expectSpan(page, "Phase", "2026-11-02", "2026-11-13");
    await expectSpan(page, "Launch", "2026-11-16", "2026-11-16");
  });

  test("a summary bar is not draggable", async ({ page }) => {
    await buildPhase(page);

    await dragBar(page, "Phase", 3);

    await expectSpan(page, "Phase", "2026-11-02", "2026-11-06");
    await expectSpan(page, "Design", "2026-11-02", "2026-11-03");
    await expectSpan(page, "Build", "2026-11-04", "2026-11-06");
  });

  test("a summary that depends on the moved task shifts with its children", async ({ page }) => {
    await addRoot(page, "Alpha");
    await addRoot(page, "Phase");
    await addChild(page, "Phase", "Design");
    await addChild(page, "Phase", "Build");
    await setSpan(page, "Alpha", "2026-11-02", "2026-11-06", 40);
    await setSpan(page, "Design", "2026-11-09", "2026-11-10", 16);
    await setSpan(page, "Build", "2026-11-11", "2026-11-13", 24);
    await setPredecessors(page, "Phase", "1");
    await expectSpan(page, "Phase", "2026-11-09", "2026-11-13");

    await dragBar(page, "Alpha", 7);

    await expectSpan(page, "Alpha", "2026-11-09", "2026-11-13");
    await expectSpan(page, "Phase", "2026-11-16", "2026-11-20");
    await expectSpan(page, "Design", "2026-11-16", "2026-11-17");
    await expectSpan(page, "Build", "2026-11-18", "2026-11-20");
    await expectHours(page, "Design", 16);
    await expectHours(page, "Build", 24);
  });
});

test.describe("Gantt drag: Tasks grid state", () => {
  test("row selection and collapsed groups survive a drag", async ({ page }) => {
    await buildChain(page);
    await addRoot(page, "Phase");
    await addChild(page, "Phase", "Design");
    await rowByTitle(page, "Bravo").locator(".row-select").check();
    await rowByTitle(page, "Phase").locator(".collapse-toggle").click();
    await expect(rowByTitle(page, "Design")).toHaveCount(0);

    await dragBar(page, "Alpha", 7);

    await expectSpan(page, "Bravo", "2026-11-16", "2026-11-20");
    await expect(rowByTitle(page, "Bravo").locator(".row-select")).toBeChecked();
    await expect(rowByTitle(page, "Design")).toHaveCount(0);
  });

  test("Gantt bars line up with the grid dates after a drag", async ({ page }) => {
    await buildChain(page);

    await dragBar(page, "Alpha", 7);
    await expectSpan(page, "Charlie", "2026-11-23", "2026-11-27");

    const ppd = await pxPerDay(page);
    const x = async title => Number(await (await ganttBar(page, title)).getAttribute("x"));
    // Alpha 11-09, Bravo 11-16, Charlie 11-23: one week apart each.
    expect(await x("Bravo") - await x("Alpha")).toBe(7 * ppd);
    expect(await x("Charlie") - await x("Bravo")).toBe(7 * ppd);
    for (const title of ["Alpha", "Bravo", "Charlie"]) {
      expect(Number(await (await ganttBar(page, title)).getAttribute("width"))).toBe(5 * ppd);
    }
  });

  test("a bar that crosses a weekend reaches its End date", async ({ page }) => {
    await addRoot(page, "Alpha");
    await addRoot(page, "Bravo");
    await setSpan(page, "Alpha", "2026-11-02", "2026-11-04", 24);
    await setPredecessors(page, "Bravo", "1");
    await setSpan(page, "Bravo", "2026-11-05", "2026-11-11", 40);

    const ppd = await pxPerDay(page);
    const attr = async (title, name) => Number(await (await ganttBar(page, title)).getAttribute(name));
    // Thu 11-05 to Wed 11-11 is 7 calendar days.
    expect(await attr("Bravo", "width")).toBe(7 * ppd);
    expect(await attr("Bravo", "x")).toBe(await attr("Alpha", "x") + 3 * ppd);

    await dragBar(page, "Bravo", 1);
    // Fri 11-06 to Thu 11-12.
    await expectSpan(page, "Bravo", "2026-11-06", "2026-11-12");
    expect(await attr("Bravo", "width")).toBe(7 * ppd);
  });

  test("a half-day task is drawn half a day wide", async ({ page }) => {
    await addRoot(page, "Alpha");
    await setSpan(page, "Alpha", "2026-11-02", "2026-11-02", 4);

    const ppd = await pxPerDay(page);
    expect(Number(await (await ganttBar(page, "Alpha")).getAttribute("width"))).toBe(ppd / 2);
  });

  test("a click after a drag does not open the timeline text dialog", async ({ page }) => {
    await buildChain(page);

    await dragBar(page, "Alpha", 7);

    await expect(page.locator(".modal-box")).toHaveCount(0);
  });

  test("releasing a drag outside the Gantt does not swallow the next bar click", async ({ page }) => {
    await buildChain(page);
    const bar = await ganttBar(page, "Charlie");
    const box = await bar.boundingBox();
    const gridBox = await cell(page, "Alpha", "title").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(gridBox.x + 5, gridBox.y + 5, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    await (await ganttBar(page, "Alpha")).click();

    await expect(page.locator(".modal-box")).toContainText("Gantt Timeline Text");
  });

  test("a tiny mouse wobble on a bar changes nothing", async ({ page }) => {
    await buildChain(page);
    const bar = await ganttBar(page, "Bravo");
    const box = await bar.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");

    await expectSpan(page, "Bravo", "2026-11-09", "2026-11-13");
    await expectHours(page, "Bravo", 40);
  });
});

test.describe("Tasks UI edits reschedule dependents like the Gantt does", () => {
  test("editing a predecessor's end date in the grid moves its successors", async ({ page }) => {
    await buildChain(page);

    await setCell(page, "Alpha", "end_date", "2026-11-10");

    await expectSpan(page, "Bravo", "2026-11-11", "2026-11-17");
    await expectSpan(page, "Charlie", "2026-11-18", "2026-11-24");
    await expectHours(page, "Bravo", 40);
  });

  test("editing a predecessor's start date in the grid moves its successors", async ({ page }) => {
    await buildChain(page);

    await setCell(page, "Alpha", "start_date", "2026-11-09");

    await expectSpan(page, "Alpha", "2026-11-09", "2026-11-13");
    await expectSpan(page, "Bravo", "2026-11-16", "2026-11-20");
    await expectSpan(page, "Charlie", "2026-11-23", "2026-11-27");
  });

  test("editing End in the grid updates Hours", async ({ page }) => {
    await addRoot(page, "Alpha");
    await setCell(page, "Alpha", "start_date", "2026-11-02");

    await setCell(page, "Alpha", "end_date", "2026-11-10");

    await expectHours(page, "Alpha", 56);
  });

  test("editing Hours in the grid updates End and moves successors", async ({ page }) => {
    await buildChain(page);

    await setCell(page, "Alpha", "duration_hours", "56");

    await expectSpan(page, "Alpha", "2026-11-02", "2026-11-10");
    await expectSpan(page, "Bravo", "2026-11-11", "2026-11-17");
    await expectSpan(page, "Charlie", "2026-11-18", "2026-11-24");
  });

  test("the grid rejects a start date earlier than the predecessors allow", async ({ page }) => {
    await buildChain(page);

    await editCell(page, "Bravo", "start_date", "2026-11-04");

    await expect(page.getByText("Predecessors allow a start no earlier than 2026-11-09")).toBeVisible();
    await expectSpan(page, "Bravo", "2026-11-09", "2026-11-13");
    await expectSpan(page, "Charlie", "2026-11-16", "2026-11-20");
  });

  test("a later start typed in the grid is kept as lag", async ({ page }) => {
    await buildChain(page);

    await setCell(page, "Bravo", "start_date", "2026-11-11");

    await expectSpan(page, "Bravo", "2026-11-11", "2026-11-17");
    await expect(cell(page, "Bravo", "predecessors_display")).toHaveText("1FS+2d");
    await expectSpan(page, "Charlie", "2026-11-18", "2026-11-24");
  });

  test("the details drawer accepts the same predecessor syntax as the grid", async ({ page }) => {
    await buildChain(page);
    await rowByTitle(page, "Bravo").locator(".view-details").click();
    const predecessors = page.locator("#details-body-content .details-group", { hasText: "Predecessors" }).locator("input");
    await expect(predecessors).toHaveValue("1FS");

    await predecessors.fill("1FS+1d");
    await predecessors.dispatchEvent("change");

    await expect(cell(page, "Bravo", "predecessors_display")).toHaveText("1FS+1d");
    await expectSpan(page, "Bravo", "2026-11-10", "2026-11-16");
    await expectSpan(page, "Charlie", "2026-11-17", "2026-11-23");
  });

  test("the details drawer rejects a start date earlier than the predecessors allow", async ({ page }) => {
    await buildChain(page);
    await rowByTitle(page, "Bravo").locator(".view-details").click();
    const planStart = page.locator("#details-body-content .details-group", { hasText: "Plan Start" }).locator("input");

    await planStart.fill("2026-11-04");
    await planStart.dispatchEvent("change");

    await expect(page.getByText("Predecessors allow a start no earlier than 2026-11-09")).toBeVisible();
    await expect(page.locator("#details-body-content .details-group", { hasText: "Plan Start" }).locator("input")).toHaveValue("2026-11-09");
    await expectSpan(page, "Bravo", "2026-11-09", "2026-11-13");
  });

  test("changing a date in the details drawer reschedules the whole chain", async ({ page }) => {
    await buildChain(page);
    await rowByTitle(page, "Alpha").locator(".view-details").click();
    const planEnd = page.locator("#details-body-content .details-group", { hasText: "Plan End" }).locator("input");
    await expect(planEnd).toHaveValue("2026-11-06");

    await planEnd.fill("2026-11-10");
    await planEnd.dispatchEvent("change");

    await expectSpan(page, "Alpha", "2026-11-02", "2026-11-10");
    await expectSpan(page, "Bravo", "2026-11-11", "2026-11-17");
    await expectSpan(page, "Charlie", "2026-11-18", "2026-11-24");
  });
});
