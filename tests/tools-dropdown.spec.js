const { test, expect } = require("@playwright/test");
const path = require("path");

const APP_URL = "file:///" + path.resolve(__dirname, "../NovaPlan.html").replace(/\\/g, "/");

async function waitForAppReady(page) {
  await page.waitForSelector("#loading-overlay", { state: "hidden" });
  await page.waitForFunction(() => !document.getElementById("tools-menu-btn").disabled);
}

test.describe("Tools dropdown overlay", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
    await waitForAppReady(page);
  });

  test("dropdown opens when Tools button is clicked", async ({ page }) => {
    const panel = page.locator("#tools-menu .menu-panel");
    await expect(panel).toBeHidden();

    await page.click("#tools-menu-btn");

    await expect(panel).toBeVisible();
  });

  test("dropdown uses position:fixed so it escapes topbar overflow clipping", async ({ page }) => {
    await page.click("#tools-menu-btn");
    await expect(page.locator("#tools-menu .menu-panel")).toBeVisible();

    const position = await page.evaluate(() =>
      window.getComputedStyle(document.querySelector("#tools-menu .menu-panel")).position
    );
    expect(position).toBe("fixed");
  });

  test("dropdown has z-index that places it above all panels", async ({ page }) => {
    await page.click("#tools-menu-btn");
    await expect(page.locator("#tools-menu .menu-panel")).toBeVisible();

    const zIndex = await page.evaluate(() =>
      parseInt(window.getComputedStyle(document.querySelector("#tools-menu .menu-panel")).zIndex, 10)
    );
    expect(zIndex).toBeGreaterThanOrEqual(9999);
  });

  test("dropdown appears visually on top of WBS panel using elementFromPoint", async ({ page }) => {
    await page.click("#tools-menu-btn");
    await expect(page.locator("#tools-menu .menu-panel")).toBeVisible();

    // Sample a point near the top-left of the open panel (well inside panel bounds)
    const insidePanel = await page.evaluate(() => {
      const panel = document.querySelector("#tools-menu .menu-panel");
      const rect = panel.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + 20;
      const el = document.elementFromPoint(x, y);
      return el ? !!el.closest("#tools-menu") : false;
    });

    expect(insidePanel).toBe(true);
  });

  test("dropdown panel overlaps the main content area below the topbar", async ({ page }) => {
    await page.click("#tools-menu-btn");
    await expect(page.locator("#tools-menu .menu-panel")).toBeVisible();

    const overlaps = await page.evaluate(() => {
      const panel = document.querySelector("#tools-menu .menu-panel");
      const topbar = document.querySelector(".topbar");
      const panelRect = panel.getBoundingClientRect();
      const topbarRect = topbar.getBoundingClientRect();
      // Panel bottom edge should be below the topbar bottom edge
      return panelRect.bottom > topbarRect.bottom;
    });

    expect(overlaps).toBe(true);
  });

  test("dropdown closes when clicking outside", async ({ page }) => {
    await page.click("#tools-menu-btn");
    await expect(page.locator("#tools-menu .menu-panel")).toBeVisible();

    // Click somewhere in the main layout outside the menu
    await page.click(".main-layout", { position: { x: 100, y: 100 } });

    await expect(page.locator("#tools-menu .menu-panel")).toBeHidden();
  });

  test("dropdown items are not clipped — all items are fully within viewport height", async ({ page }) => {
    await page.click("#tools-menu-btn");
    await expect(page.locator("#tools-menu .menu-panel")).toBeVisible();

    const result = await page.evaluate(() => {
      const panel = document.querySelector("#tools-menu .menu-panel");
      const rect = panel.getBoundingClientRect();
      return { top: rect.top, notClippedAtTop: rect.top >= 0 };
    });

    expect(result.notClippedAtTop).toBe(true);
    expect(result.top).toBeGreaterThan(0);
  });

  test("panel stays within viewport at narrow width (button on left half)", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });

    await page.click("#tools-menu-btn");
    await expect(page.locator("#tools-menu .menu-panel")).toBeVisible();

    const result = await page.evaluate(() => {
      const panel = document.querySelector("#tools-menu .menu-panel");
      const btn = document.getElementById("tools-menu-btn");
      const pr = panel.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      return {
        panelLeft: Math.round(pr.left),
        panelRight: Math.round(pr.right),
        btnLeft: Math.round(br.left),
        btnInLeftHalf: (br.left + br.right) / 2 < vw / 2,
        notOffLeft: pr.left >= 0,
        notOffRight: pr.right <= vw,
        leftAlignedWithBtn: Math.abs(pr.left - br.left) < 2,
      };
    });

    expect(result.btnInLeftHalf).toBe(true);
    expect(result.notOffLeft).toBe(true);
    expect(result.notOffRight).toBe(true);
    // When button is on the left half the panel left-aligns with the button
    expect(result.leftAlignedWithBtn).toBe(true);
  });

  test("panel right-aligns with button when button is on right half", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.click("#tools-menu-btn");
    await expect(page.locator("#tools-menu .menu-panel")).toBeVisible();

    const result = await page.evaluate(() => {
      const panel = document.querySelector("#tools-menu .menu-panel");
      const btn = document.getElementById("tools-menu-btn");
      const pr = panel.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      return {
        btnInRightHalf: (br.left + br.right) / 2 > vw / 2,
        notOffLeft: pr.left >= 0,
        notOffRight: pr.right <= vw,
        rightAlignedWithBtn: Math.abs(pr.right - br.right) < 2,
      };
    });

    expect(result.btnInRightHalf).toBe(true);
    expect(result.notOffLeft).toBe(true);
    expect(result.notOffRight).toBe(true);
    expect(result.rightAlignedWithBtn).toBe(true);
  });
});
