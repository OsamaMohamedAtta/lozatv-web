// Browser tests for the static dashboard. The backend API is mocked inside
// each test, so no real login, server or payment is involved.
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "node tests/static-server.js 4173",
    url: "http://127.0.0.1:4173/dashboard.html",
    reuseExistingServer: true
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ]
});
