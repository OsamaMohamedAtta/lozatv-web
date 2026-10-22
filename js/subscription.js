// ===============================
// Subscription, PayTabs checkout & payment status
// ===============================
// Prices, currency and activation are decided by the backend only.
// This file never sends an amount — just the plan id.

let subscriptionPlans = [];
let currentSubscription = null;
let selectedPlanId = null;
let paymentPollTimer = null;

const PLAN_LABELS = { yearly: "Annual", lifetime: "Lifetime", trial: "Free trial" };
const PAYMENT_STATUS = {
  pending: { label: "Awaiting confirmation", tone: "pending" },
  paid: { label: "Paid", tone: "success" },
  failed: { label: "Failed", tone: "error" },
  cancelled: { label: "Cancelled", tone: "error" },
  expired: { label: "Expired", tone: "muted" }
};

document.addEventListener("click", e => {
  const buy = e.target.closest("[data-plan]");
  if (buy && !buy.disabled) openPayModal(buy.dataset.plan);
  if (e.target.closest("[data-close='pay']")) closePayModal();
});
document.addEventListener("DOMContentLoaded", () => {
  $("#payConfirm")?.addEventListener("click", startCheckout);
});

async function loadSubscription(info) {
  currentSubscription = subscriptionFromUserInfo(info);
  const [summary, plans, history] = await Promise.allSettled([
    apiRequest("/payment/subscription"),
    apiRequest("/payment/plans"),
    apiRequest("/payment/orders")
  ]);
  if (summary.status === "fulfilled" && summary.value.subscription) {
    currentSubscription = summary.value.subscription;
    renderUser(info, currentSubscription);
  }
  subscriptionPlans = plans.status === "fulfilled" && plans.value.available ? plans.value.plans || [] : [];
  renderSubscription();
  renderPlans();
  renderPaymentHistory(history.status === "fulfilled" ? history.value.payments || [] : []);
  resumePaymentFromUrl();
}

function renderSubscription() {
  const s = currentSubscription || {};
  const rows = [];
  let badge;
  if (s.active && s.isLifetime) badge = `<span class="sub-badge success">● Lifetime — never expires</span>`;
  else if (s.active) badge = `<span class="sub-badge success">● Active</span>`;
  else if (s.isTrialActive) badge = `<span class="sub-badge pending">● Free trial</span>`;
  else if (s.isSubscribed || s.expired) badge = `<span class="sub-badge error">● Expired</span>`;
  else badge = `<span class="sub-badge muted">● No active subscription</span>`;

  const plan = s.active ? PLAN_LABELS[s.plan] || "Active plan" : s.isTrialActive ? PLAN_LABELS.trial : "—";
  rows.push(["PLAN", plan]);
  if (s.startDate && (s.active || s.isSubscribed)) rows.push(["START DATE", formatDate(s.startDate)]);
  if (s.active && s.isLifetime) rows.push(["EXPIRES", "Never"]);
  else if (s.endDate) {
    rows.push([s.active ? "EXPIRES ON" : "EXPIRED ON", formatDate(s.endDate)]);
    if (s.active) rows.push(["TIME REMAINING", remainingTime(s.endDate)]);
  }
  $("#subscriptionDetails").innerHTML = `
    ${badge}
    <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join("")}</dl>
  `;
}

function remainingTime(end) {
  const ms = new Date(end) - new Date();
  if (!(ms > 0)) return "Expired";
  const days = Math.ceil(ms / 86400000);
  if (days >= 60) return `${Math.floor(days / 30)} months (${days} days)`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

function renderPlans() {
  const section = $("#plansSection");
  const lifetimeActive = currentSubscription?.active && currentSubscription?.isLifetime;
  if (!subscriptionPlans.length) { section.classList.add("hidden"); return; }
  section.classList.remove("hidden");
  $("#plansGrid").innerHTML = subscriptionPlans.map(p => {
    const isLifetime = p.id === "lifetime";
    let action = isLifetime ? "Get lifetime access" : currentSubscription?.active && currentSubscription.plan === "yearly" ? "Renew for 1 year" : "Subscribe for 1 year";
    if (lifetimeActive) action = "Already active";
    return `
      <article class="plan-card ${isLifetime ? "featured" : ""}">
        ${isLifetime ? `<span class="plan-tag">BEST VALUE</span>` : ""}
        <h4>${escapeHtml(p.name)}</h4>
        <div class="plan-price"><strong>${escapeHtml(formatMoney(p.amount, p.currency))}</strong><span>${isLifetime ? "one-time" : "/ year"}</span></div>
        <ul>
          ${isLifetime
            ? "<li>Lifetime access — never expires</li><li>Pay once, no renewals</li>"
            : "<li>Full access for 12 months</li><li>Starts as soon as payment is confirmed</li>"}
          <li>Secure card payment by PayTabs</li>
        </ul>
        <button class="btn ${isLifetime ? "btn-primary" : "btn-ghost"} full" data-plan="${escapeHtml(p.id)}" ${lifetimeActive ? "disabled" : ""}>${action}</button>
      </article>`;
  }).join("");
}

function formatMoney(amount, currency) {
  const n = Number(amount);
  if (!isFinite(n)) return "—";
  return `${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} ${currency || ""}`.trim();
}

function renderPaymentHistory(payments) {
  const box = $("#paymentHistory");
  box.classList.toggle("hidden", payments.length === 0);
  $("#paymentRows").innerHTML = payments.map(p => {
    const st = PAYMENT_STATUS[p.status] || { label: p.status, tone: "muted" };
    return `<tr>
      <td>${escapeHtml(formatDate(p.createdAt))}</td>
      <td>${escapeHtml(PLAN_LABELS[p.plan] || p.plan)}</td>
      <td>${escapeHtml(formatMoney(p.amount, p.currency))}</td>
      <td><span class="sub-badge ${st.tone}">${escapeHtml(st.label)}</span></td>
    </tr>`;
  }).join("");
}

function openPayModal(planId) {
  const plan = subscriptionPlans.find(p => p.id === planId);
  if (!plan) return;
  if (currentSubscription?.active && currentSubscription?.isLifetime) { toast("Your lifetime subscription is already active."); return; }
  selectedPlanId = plan.id;
  $("#payPlan").textContent = plan.name;
  $("#payDuration").textContent = plan.id === "lifetime" ? "Lifetime (never expires)" : "1 year from activation";
  $("#payAmount").textContent = formatMoney(plan.amount, plan.currency);
  $("#payMessage").textContent = "";
  $("#payMessage").className = "form-message";
  setPayButton(false);
  $("#payModal").classList.remove("hidden");
}

function closePayModal() {
  if ($("#payConfirm").disabled) return; // don't close mid-request
  $("#payModal").classList.add("hidden");
}

function setPayButton(busy) {
  const btn = $("#payConfirm");
  btn.disabled = busy;
  btn.textContent = busy ? "Redirecting to PayTabs…" : "Continue to secure payment";
}

// Only ever redirect to a PayTabs-hosted page.
function isPaytabsUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)paytabs\.(com|sa)$/i.test(u.hostname);
  } catch (_) { return false; }
}

async function startCheckout() {
  if (!selectedPlanId || $("#payConfirm").disabled) return;
  const msg = $("#payMessage");
  setPayButton(true);
  msg.textContent = ""; msg.className = "form-message";
  try {
    const data = await apiRequest("/payment/checkout", {
      method: "POST",
      body: JSON.stringify({ planId: selectedPlanId })
    });
    if (!isPaytabsUrl(data.redirectUrl)) throw new Error("Could not start the payment. Please try again.");
    msg.textContent = "Payment initiated. Redirecting…";
    window.location.assign(data.redirectUrl);
  } catch (err) {
    msg.textContent = err.status === 409 ? "Your lifetime subscription is already active." : err.message;
    msg.className = "form-message error";
    setPayButton(false);
  }
}

// After PayTabs, the backend redirects to dashboard.html?payment=<orderId>.
// The dashboard only shows success once the backend confirms it.
function resumePaymentFromUrl() {
  const orderId = new URLSearchParams(window.location.search).get("payment");
  if (!orderId || !/^[a-f0-9]{24}$/i.test(orderId)) return;
  clearTimeout(paymentPollTimer);
  showNotice("pending", "Verifying your payment with PayTabs…", "Please keep this page open. This usually takes a few seconds.");
  pollPayment(orderId, 0);
}

async function pollPayment(orderId, attempt) {
  let payment;
  try {
    payment = (await apiRequest(`/payment/orders/${encodeURIComponent(orderId)}`)).payment;
  } catch (err) {
    if (err.status === 404) { showNotice("error", "Payment not found", "This payment does not belong to this player."); clearPaymentParam(); return; }
    if (err.status === 401) return;
  }
  const status = payment?.status;
  if (status === "paid" && payment.subscriptionActivated) {
    showNotice("success", "Payment successful — subscription activated", `Your ${PLAN_LABELS[payment.plan] || ""} subscription is now active. Thank you!`);
    toast("Subscription activated.");
    clearPaymentParam();
    refreshAfterPayment();
    return;
  }
  if (status === "failed") return finishWith("error", "Payment failed", "Your card was not charged for this attempt. You can try again.");
  if (status === "cancelled") return finishWith("error", "Payment cancelled", "The payment was cancelled. No subscription was activated.");
  if (status === "expired") return finishWith("muted", "Payment session expired", "The payment was not completed. You can start a new payment at any time.");

  const pendingText = status === "paid"
    ? "Payment received — activating your subscription…"
    : "Payment pending — awaiting confirmation from PayTabs.";
  if (attempt >= 20) {
    showNotice("pending", pendingText, "This is taking longer than usual. Your subscription will be activated automatically once the payment is confirmed — refresh this page in a few minutes.");
    return;
  }
  showNotice("pending", pendingText, "Please keep this page open. This usually takes a few seconds.");
  paymentPollTimer = setTimeout(() => pollPayment(orderId, attempt + 1), attempt < 5 ? 3000 : 6000);
}

function finishWith(tone, title, text) {
  showNotice(tone, title, text);
  clearPaymentParam();
  refreshAfterPayment();
}

async function refreshAfterPayment() {
  try {
    const info = await apiRequest("/user/userInfo");
    renderUser(info);
    await loadSubscription(info);
  } catch (_) {}
}

function clearPaymentParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("payment");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

function showNotice(tone, title, text) {
  const box = $("#paymentNotice");
  box.className = `payment-notice ${tone}`;
  box.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span>`;
}
