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
