const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 90000,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    acceptDownloads: true,
    actionTimeout: 15000,
    navigationTimeout: 60000,
    trace: "on-first-retry",
    viewport: { width: 1440, height: 900 }
  }
});
