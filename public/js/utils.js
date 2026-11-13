/**
 * Utility functions and formatting helpers
 */

const toastElement = document.querySelector("#toast");
let toastTimer;

export const today = new Date().toISOString().slice(0, 10);

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}

export function money(paise) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format((Number(paise) || 0) / 100);
}

export function rupees(paise) {
  return ((Number(paise) || 0) / 100).toFixed(2);
}

export function dateFormat(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

export function statusLabel(record, type = "invoice") {
  if (type === "quote") return record.status;
  const paid = Number(record.paid_paise) || 0;
  if (paid >= record.total_paise) return "paid";
  if (paid > 0) return "partial";
  if (record.due_date && record.due_date < today) return "overdue";
  return "sent";
}

export function statusPill(status) {
  const normalized = escapeHtml(status || "sent");
  return `<span class="status ${normalized}">${normalized.charAt(0).toUpperCase() + normalized.slice(1)}</span>`;
}

export function notify(message, isError = false) {
  if (!toastElement) return;
  toastElement.textContent = message;
  toastElement.classList.toggle("error", isError);
  toastElement.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove("show"), 3500);
}

export function heading(eyebrow, title, subtitle, action = "") {
  return `<div class="page-heading">
    <div>
      <p class="eyebrow">${eyebrow}</p>
      <h1>${title}</h1>
      <p class="subtitle">${subtitle}</p>
    </div>
    ${action}
  </div>`;
}

export function emptyState(title, text) {
  return `<div class="empty-state"><strong>${title}</strong>${text}</div>`;
}

export function pageError(error) {
  const content = document.querySelector("#page-content");
  if (content) {
    content.innerHTML = `<div class="content-card">${emptyState(
      "Couldn't load this page",
      escapeHtml(error.message)
    )}</div>`;
  }
}

export function setPageTitle(title) {
  const titleEl = document.querySelector("#page-title");
  if (titleEl) titleEl.textContent = title;
}

export function field(label, name, value = "", type = "text", required = false, full = false) {
  if (type === "textarea") {
    return `<div class="field ${full ? "full" : ""}">
      <label for="${name}">${label}</label>
      <textarea id="${name}" name="${name}">${escapeHtml(value)}</textarea>
    </div>`;
  }
  return `<div class="field ${full ? "full" : ""}">
    <label for="${name}">${label}</label>
    <input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${
      required ? "required" : ""
    } />
  </div>`;
}
