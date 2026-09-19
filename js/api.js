// ===============================
// LozaTV API CONFIGURATION
// ===============================
// Replace this URL with your deployed Node/Express API.
// Example: https://api.lozatv.com
const API_BASE_URL = "https://lozatv-back-app.onrender.com";

async function apiRequest(path, options = {}) {
  const token = localStorage.getItem("lozatv_token");
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });

  let data = {};
  try { data = await response.json(); } catch (_) {}

  if (!response.ok) {
    const error = new Error(data.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}