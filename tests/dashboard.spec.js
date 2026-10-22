// Dashboard tests with a mocked backend API and mocked PayTabs page.
const { test, expect } = require("@playwright/test");

const API = "https://lozatv-back-app.onrender.com";
const DAY = 86400000;
const ORDER_ID = "65f0c0ffee0000000000abcd";
const RESELLER_URL = "https://wa.me/971502600682?text=Hello%2C%20I%20would%20like%20to%20join%20the%20IPTV%20Reseller%20Program.%20Please%20provide%20me%20with%20the%20details.";

const PLANS = {
  available: true,
  plans: [
    { id: "yearly", name: "Annual Subscription", duration: "1 year", referencePriceUsd: 5, currency: "EGP", amount: "250.00", available: true },
    { id: "lifetime", name: "Lifetime Subscription", duration: "lifetime", referencePriceUsd: 10, currency: "EGP", amount: "500.00", available: true }
  ]
};

function inYears(n) { const d = new Date(); d.setFullYear(d.getFullYear() + n); return d.toISOString(); }

// Installs a mock backend. `state` can be changed by tests at any time.
async function mockApi(page, overrides = {}) {
  const state = {
    paymentsDeployed: true,
    user: { macAddress: "aa:bb:cc:dd:ee:ff", isSubscribed: false, isTrialActive: false },
    subscription: null,
    orders: [],
    orderSequence: [],
    checkoutResponse: { status: 201, body: { redirectUrl: "https://secure-egypt.paytabs.com/payment/page/TEST" } },
    checkoutDelay: 0,
    requests: [],
    ...overrides
  };
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    state.requests.push({ method: req.method(), path: url.pathname, body: req.postData(), auth: req.headers()["authorization"] });
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const p = url.pathname;
    if (p === "/user/login") {
      const body = JSON.parse(req.postData());
      return body.deviceKey === "good-key" ? json(200, { token: "token-123" }) : json(404, { message: "User not found" });
    }
    if (state.blocked && (p === "/user/userInfo" || p === "/playList/get")) return json(403, { message: "This user is not subscription" });
    if (p === "/user/userInfo") return json(200, state.user);
    if (p === "/playList/get") return json(200, { allPlaylists: [{ _id: "p1", name: "My List", url: "https://example.com/list.m3u", isActive: true }] });
    if (p.startsWith("/payment/") && !state.paymentsDeployed) return json(404, { message: "Not found" });
    if (p === "/payment/plans") return json(200, PLANS);
    if (p === "/payment/subscription") return state.subscription ? json(200, { subscription: state.subscription }) : json(404, {});
    if (p === "/payment/orders") return json(200, { payments: state.orders });
    if (p === `/payment/orders/${ORDER_ID}`) {
      const next = state.orderSequence.length > 1 ? state.orderSequence.shift() : state.orderSequence[0];
      return next ? json(200, { payment: next }) : json(404, { message: "Payment not found" });
    }
    if (p === "/payment/checkout") {
      if (state.checkoutDelay) await new Promise((r) => setTimeout(r, state.checkoutDelay));
      return json(state.checkoutResponse.status, state.checkoutResponse.body);
    }
    return json(404, { message: "Not found" });
  });
  await page.route("https://secure-egypt.paytabs.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>PayTabs mock page</h1>" }));
  return state;
}

async function loggedIn(page) {
  await page.addInitScript(() => localStorage.setItem("lozatv_token", "token-123"));
}

function order(status, extra = {}) {
  return { orderId: ORDER_ID, plan: "yearly", amount: "250.00", currency: "EGP", status, subscriptionActivated: false, createdAt: new Date().toISOString(), ...extra };
}

test("MAC address + device key login still works and loads playlists", async ({ page }) => {
  const state = await mockApi(page);
  await page.goto("/dashboard.html");
  await page.fill("#macAddress", "AABBCCDDEEFF");
  await expect(page.locator("#macAddress")).toHaveValue("AA:BB:CC:DD:EE:FF");
  await page.fill("#deviceKey", "bad-key");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#loginError")).toHaveText("Invalid MAC address or device key.");
  await page.fill("#deviceKey", "good-key");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#appView")).toBeVisible();
  await expect(page.locator(".playlist-card h3")).toHaveText("My List");
  const login = state.requests.find((r) => r.path === "/user/login" && r.body.includes("good-key"));
  expect(JSON.parse(login.body)).toEqual({ macAddress: "aa:bb:cc:dd:ee:ff", deviceKey: "good-key" });
  const info = state.requests.find((r) => r.path === "/user/userInfo");
  expect(info.auth).toBe("Bearer token-123");
});

test("reseller option opens WhatsApp with the prefilled message", async ({ page }) => {
  await mockApi(page);
  await loggedIn(page);
  await page.goto("/dashboard.html");
  const link = page.locator("#resellerLink");
  await expect(page.getByText("Become a Reseller — Free")).toBeVisible();
  await expect(link).toHaveAttribute("href", RESELLER_URL);
  await expect(link).toHaveAttribute("target", "_blank");
  expect(decodeURIComponent(new URL(RESELLER_URL).searchParams.get("text"))).toBe("Hello, I would like to join the IPTV Reseller Program. Please provide me with the details.");
});

test("dashboard keeps working when the payment API is not deployed yet", async ({ page }) => {
  await mockApi(page, { paymentsDeployed: false, user: { macAddress: "aa:bb", isSubscribed: true, endDate: new Date(Date.now() + 40 * DAY).toISOString(), startDate: new Date().toISOString() } });
  await loggedIn(page);
  await page.goto("/dashboard.html");
  await expect(page.locator(".playlist-card")).toHaveCount(1);
  await expect(page.locator("#plansSection")).toBeHidden();
  await expect(page.locator("#resellerLink")).toBeVisible();
  await expect(page.locator("#subscriptionDetails")).toContainText("Active");
  await expect(page.locator("#userInfo")).not.toContainText("Forever");
});

test("plans show the server EGP prices and checkout sends only the plan id", async ({ page }) => {
  const state = await mockApi(page, { checkoutDelay: 600 });
  await loggedIn(page);
  await page.goto("/dashboard.html");
  const cards = page.locator(".plan-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("250 EGP");
  await expect(cards.nth(1)).toContainText("500 EGP");
  await page.click("[data-plan=yearly]");
  await expect(page.locator("#payAmount")).toHaveText("250 EGP");
  await expect(page.locator("#payPlan")).toHaveText("Annual Subscription");
  await page.click("#payConfirm");
  await expect(page.locator("#payConfirm")).toBeDisabled();
  await page.locator("#payConfirm").click({ force: true }).catch(() => {});
  await page.waitForURL("https://secure-egypt.paytabs.com/**");
  const checkouts = state.requests.filter((r) => r.path === "/payment/checkout");
  expect(checkouts).toHaveLength(1);
  expect(JSON.parse(checkouts[0].body)).toEqual({ planId: "yearly" });
  expect(checkouts[0].auth).toBe("Bearer token-123");
});

test("refuses to redirect anywhere other than PayTabs", async ({ page }) => {
  await mockApi(page, { checkoutResponse: { status: 201, body: { redirectUrl: "https://evil.example.com/pay" } } });
  await loggedIn(page);
  await page.goto("/dashboard.html");
  await page.click("[data-plan=lifetime]");
  await page.click("#payConfirm");
  await expect(page.locator("#payMessage")).toHaveText("Could not start the payment. Please try again.");
  await expect(page).toHaveURL(/dashboard\.html/);
  await expect(page.locator("#payConfirm")).toBeEnabled();
});

test("returning from PayTabs: pending first, success only after backend confirmation", async ({ page }) => {
  const state = await mockApi(page, { orderSequence: [order("pending"), order("paid"), order("paid", { subscriptionActivated: true })] });
  await loggedIn(page);
  await page.goto(`/dashboard.html?payment=${ORDER_ID}`);
  const notice = page.locator("#paymentNotice");
  await expect(notice).toContainText(/Verifying|pending/);
  await expect(notice).not.toContainText("activated");
  state.user = { ...state.user, isSubscribed: true, startDate: new Date().toISOString(), endDate: inYears(1) };
  state.subscription = { active: true, isSubscribed: true, plan: "yearly", isLifetime: false, startDate: new Date().toISOString(), endDate: inYears(1) };
  await expect(notice).toContainText("Payment successful — subscription activated", { timeout: 15000 });
  await expect(page).toHaveURL(/dashboard\.html$/);
  await expect(page.locator("#subscriptionDetails")).toContainText("Annual");
  await expect(page.locator("#subscriptionDetails")).toContainText("TIME REMAINING");
});

for (const [status, text] of [["failed", "Payment failed"], ["cancelled", "Payment cancelled"], ["expired", "Payment session expired"]]) {
  test(`returning from PayTabs with a ${status} payment shows a clear message`, async ({ page }) => {
    await mockApi(page, { orderSequence: [order(status)] });
    await loggedIn(page);
    await page.goto(`/dashboard.html?payment=${ORDER_ID}`);
    await expect(page.locator("#paymentNotice")).toContainText(text);
    await expect(page.locator("#subscriptionDetails")).toContainText("No active subscription");
  });
}

test("lifetime subscription shows as never expiring and cannot be bought again", async ({ page }) => {
  await mockApi(page, {
    user: { macAddress: "aa", isSubscribed: true, startDate: new Date().toISOString(), endDate: inYears(100) },
    subscription: { active: true, isSubscribed: true, plan: "lifetime", isLifetime: true, startDate: new Date().toISOString(), endDate: null }
  });
  await loggedIn(page);
  await page.goto("/dashboard.html");
  await expect(page.locator("#subscriptionDetails")).toContainText("Lifetime — never expires");
  await expect(page.locator("#subscriptionDetails")).toContainText("Never");
  await expect(page.locator("#userInfo")).toContainText("Lifetime");
  await expect(page.locator("[data-plan=yearly]")).toBeDisabled();
  await expect(page.locator("[data-plan=lifetime]")).toHaveText("Already active");
});

test("annual subscription shows start, expiry, remaining time and payment history", async ({ page }) => {
  const end = new Date(Date.now() + 100 * DAY).toISOString();
  await mockApi(page, {
    user: { macAddress: "aa", isSubscribed: true, startDate: new Date().toISOString(), endDate: end },
    subscription: { active: true, isSubscribed: true, plan: "yearly", isLifetime: false, startDate: new Date(Date.now() - 265 * DAY).toISOString(), endDate: end },
    orders: [order("paid", { subscriptionActivated: true }), order("failed", { plan: "lifetime", amount: "500.00" })]
  });
  await loggedIn(page);
  await page.goto("/dashboard.html");
  const details = page.locator("#subscriptionDetails");
  await expect(details).toContainText("START DATE");
  await expect(details).toContainText("EXPIRES ON");
  await expect(details).toContainText("3 months (100 days)");
  await expect(page.locator("[data-plan=yearly]")).toHaveText("Renew for 1 year");
  await expect(page.locator("#paymentRows tr")).toHaveCount(2);
  await expect(page.locator("#paymentRows")).toContainText("Paid");
  await expect(page.locator("#paymentRows")).toContainText("Failed");
});

test("expired annual subscription is shown as expired", async ({ page }) => {
  await mockApi(page, { user: { macAddress: "aa", isSubscribed: true, startDate: new Date(Date.now() - 400 * DAY).toISOString(), endDate: new Date(Date.now() - 35 * DAY).toISOString() } });
  await loggedIn(page);
  await page.goto("/dashboard.html");
  await expect(page.locator("#subscriptionDetails")).toContainText("Expired");
  await expect(page.locator("#userInfo")).toContainText("Expired");
});

test("layout has no horizontal overflow", async ({ page }) => {
  await mockApi(page, { orders: [order("paid", { subscriptionActivated: true })] });
  await loggedIn(page);
  await page.goto("/dashboard.html");
  await expect(page.locator(".plan-card")).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("expired users (blocked by isUser) can still sign in, see their status and renew", async ({ page }) => {
  const state = await mockApi(page, {
    blocked: true,
    subscription: { macAddress: "aa:bb:cc:dd:ee:ff", active: false, isSubscribed: false, plan: null, isLifetime: false, isTrialActive: false, startDate: "2025-01-01", endDate: "2025-09-01", expired: true }
  });
  await page.goto("/dashboard.html");
  await page.fill("#macAddress", "aa:bb:cc:dd:ee:ff");
  await page.fill("#deviceKey", "good-key");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#appView")).toBeVisible();
  await expect(page.locator("#userInfo")).toContainText("aa:bb:cc:dd:ee:ff");
  await expect(page.locator("#userInfo")).toContainText("Expired");
  await expect(page.locator("#subscriptionDetails")).toContainText("Expired");
  await expect(page.locator("#playlistsLocked")).toBeVisible();
  await expect(page.locator("#openAdd")).toBeHidden();
  await expect(page.locator("#emptyState")).toBeHidden();
  await page.click("[data-plan=yearly]");
  await page.click("#payConfirm");
  await page.waitForURL("https://secure-egypt.paytabs.com/**");
  expect(state.requests.filter((r) => r.path === "/payment/checkout")).toHaveLength(1);
});
