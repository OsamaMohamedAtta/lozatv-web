const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let playlists = [];
let editingId = null;

document.addEventListener("DOMContentLoaded", async () => {
  if (!$("#loginView")) return;
  const token = localStorage.getItem("lozatv_token");
  if (token) {
    try { await loadDashboard(); } catch (_) { logout(false); }
  } else showLogin();

  $("#loginForm")?.addEventListener("submit", login);
  $("#playlistForm")?.addEventListener("submit", savePlaylist);
  $("#openAdd")?.addEventListener("click", () => openModal());
  $("#emptyAdd")?.addEventListener("click", () => openModal());
  $("#logoutBtn")?.addEventListener("click", () => logout(true));
  document.addEventListener("click", e => {
    const close = e.target.closest("[data-close='modal']");
    if (close) closeModal();
    const edit = e.target.closest("[data-edit]");
    if (edit) editPlaylist(edit.dataset.edit);
    const del = e.target.closest("[data-delete]");
    if (del) deletePlaylist(del.dataset.delete);
  });
});

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  $("#logoutBtn").classList.add("hidden");
}

async function login(e) {
  e.preventDefault();
  const error = $("#loginError");
  error.textContent = "";
  const button = e.submitter;
  button.disabled = true; button.innerHTML = "Connecting…";
  try {
    const data = await apiRequest("/user/login", {
      method: "POST",
      body: JSON.stringify({
        macAddress: $("#macAddress").value.trim().toLowerCase(),
        deviceKey: $("#deviceKey").value.trim()
      })
    });
    localStorage.setItem("lozatv_token", data.token);
    await loadDashboard();
  } catch (err) {
    error.textContent = err.message === "User not found" ? "Invalid MAC address or device key." : err.message;
  } finally {
    button.disabled = false; button.innerHTML = "Login to Dashboard <span>→</span>";
  }
}

async function loadDashboard() {
  const [info, list] = await Promise.all([
    apiRequest("/user/userInfo"),
    apiRequest("/playList/get")
  ]);
  playlists = list.allPlaylists || [];
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#logoutBtn").classList.remove("hidden");
  renderUser(info);
  renderPlaylists();
}

function renderUser(info) {
  const status = info.isSubscribed
    ? `<span class="status active">● Active</span>`
    : `<span class="status inactive">● Not subscribed</span>`;
  $("#userInfo").innerHTML = `
    <div><small>PLAYER MAC ADDRESS</small><strong>${escapeHtml(info.macAddress || "—")}</strong></div>
    <div><small>SUBSCRIPTION</small>${status}</div>
    ${info.isSubscribed ? `<div><small>VALID UNTIL</small><strong>Forever</strong></div>` : ""}
  `;
}

{/* <div><small>VALID UNTIL</small><strong>${formatDate(info.endDate)}</strong></div> */}

function renderPlaylists() {
  const grid = $("#playlistGrid");
  $("#emptyState").classList.toggle("hidden", playlists.length !== 0);
  grid.classList.toggle("hidden", playlists.length === 0);
  grid.innerHTML = playlists.map((p, i) => `
    <article class="playlist-card">
      <div class="playlist-head"><div class="playlist-number">${String(i + 1).padStart(2, "0")}</div><div class="playlist-actions">
        <button title="Edit" data-edit="${p._id}">✎</button><button title="Delete" data-delete="${p._id}">⌫</button>
      </div></div>
      <h3>${escapeHtml(p.name || "Untitled playlist")}</h3>
      <div class="playlist-url">${escapeHtml(p.url || "")}</div>
      <div class="playlist-meta"><span>${p.isProtected ? "🔒 Password protected" : "🔓 No password"}</span><span class="${p.isActive ? "active-text" : ""}">${p.isActive ? "● Active" : "○ Inactive"}</span></div>
    </article>
  `).join("");
}

function openModal(p = null) {
  editingId = p?._id || null;
  $("#modalEyebrow").textContent = p ? "EDIT PLAYLIST" : "NEW PLAYLIST";
  $("#modalTitle").textContent = p ? "Edit playlist" : "Add playlist";
  $("#playlistId").value = p?._id || "";
  $("#playlistName").value = p?.name || "";
  $("#playlistUrl").value = p?.url || "";
  $("#playlistPassword").value = "";
  $("#playlistMessage").textContent = "";
  $("#modal").classList.remove("hidden");
  setTimeout(() => $("#playlistName").focus(), 50);
}

function editPlaylist(id) {
  const p = playlists.find(x => x._id === id);
  if (p) openModal(p);
}

function closeModal() { $("#modal").classList.add("hidden"); }

async function savePlaylist(e) {
  e.preventDefault();
  const btn = $("#savePlaylist"), msg = $("#playlistMessage");
  btn.disabled = true; btn.textContent = "Saving…"; msg.textContent = "";
  const payload = {
    name: $("#playlistName").value.trim(),
    url: $("#playlistUrl").value.trim(),
    password: $("#playlistPassword").value
  };
  try {
    const data = await apiRequest(editingId ? `/playList/update/${editingId}` : "/playList/add", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    playlists = data.allPlaylists || [];
    renderPlaylists(); closeModal(); toast(editingId ? "Playlist updated." : "Playlist added.");
  } catch (err) {
    msg.textContent = err.message; msg.className = "form-message error";
  } finally { btn.disabled = false; btn.textContent = "Save Playlist"; }
}

async function deletePlaylist(id) {
  const p = playlists.find(x => x._id === id);
  if (!p || !confirm(`Delete "${p.name}"?`)) return;
  try {
    const data = await apiRequest(`/playList/delete/${id}`, { method: "DELETE" });
    playlists = data.allPlaylists || [];
    renderPlaylists(); toast("Playlist deleted.");
  } catch (err) { toast(err.message, true); }
}

function logout(show = true) {
  localStorage.removeItem("lozatv_token");
  playlists = [];
  if (show) { showLogin(); toast("Logged out."); }
}

function toast(message, error = false) {
  const t = $("#toast"); t.textContent = message; t.className = "toast show" + (error ? " error" : "");
  setTimeout(() => t.classList.remove("show"), 2600);
}
function formatDate(v) { if (!v) return "—"; const d = new Date(v); return isNaN(d) ? v : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
function escapeHtml(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])); }