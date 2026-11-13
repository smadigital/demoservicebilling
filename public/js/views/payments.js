/**
 * Payment history ledger and reporting view (Admin only)
 */
import { api } from "../api.js";
import { state } from "../state.js";
import {
  escapeHtml,
  money,
  dateFormat,
  heading,
  emptyState,
  setPageTitle,
  notify,
} from "../utils.js";

export function paymentHistoryTable(payments) {
  if (!payments || !payments.length) {
    return emptyState(
      "No payments found",
      "Received payments matching your filters will appear here."
    );
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date received</th>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Method</th>
            <th>Reference</th>
            <th>Amount received</th>
          </tr>
        </thead>
        <tbody>
          ${payments
            .map(
              (payment) => `
            <tr>
              <td>${dateFormat(payment.payment_date)}</td>
              <td><button class="table-action" type="button" data-invoice="${payment.invoice_id}"><span>▤</span> ${escapeHtml(payment.invoice_number)}</button></td>
              <td>${escapeHtml(payment.customer_name)}</td>
              <td>${escapeHtml(payment.method)}</td>
              <td>${escapeHtml(payment.reference || "—")}</td>
              <td><strong>${money(payment.amount_paise)}</strong></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

export async function renderPaymentHistory(filters = {}) {
  if (state.authenticatedUser?.role !== "admin") {
    throw new Error("Payment history is available to Administrator accounts only.");
  }

  setPageTitle("Payment history");
  const content = document.querySelector("#page-content");
  if (!content) return;

  const query = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => Boolean(value))
  );

  const payments = await api(`/api/payments${query.size ? `?${query}` : ""}`);
  const receivedTotal = payments.reduce((total, p) => total + p.amount_paise, 0);

  content.innerHTML = `
    ${heading(
      "RECEIVED PAYMENTS",
      "Payment history",
      "Audit all incoming revenue and filter transactions by date, customer, or invoice.",
      ""
    )}
    <section class="content-card">
      <form id="payment-history-filters" class="toolbar payment-history-filters">
        <label class="history-filter">
          <span>Month</span>
          <input name="month" type="month" value="${escapeHtml(filters.month || "")}" />
        </label>
        <label class="history-filter">
          <span>From</span>
          <input name="from" type="date" value="${escapeHtml(filters.from || "")}" />
        </label>
        <label class="history-filter">
          <span>To</span>
          <input name="to" type="date" value="${escapeHtml(filters.to || "")}" />
        </label>
        <label class="history-filter invoice-filter">
          <span>Invoice number</span>
          <input name="invoice" type="search" placeholder="Search invoice…" value="${escapeHtml(filters.invoice || "")}" />
        </label>
        <div class="history-filter-actions">
          <button class="button primary" type="submit">Filter</button>
          <button class="button" type="button" data-clear-payment-filters>Clear</button>
        </div>
      </form>
      <div class="payment-history-exports">
        <span>Export this view:</span>
        <button class="button" type="button" data-payment-export="excel">Export to Excel (.csv)</button>
        <button class="button" type="button" data-payment-export="pdf">Export PDF</button>
      </div>
      <div class="toolbar payment-history-summary">
        <span>${payments.length} transaction${payments.length === 1 ? "" : "s"}</span>
        <strong>${money(receivedTotal)} total received</strong>
      </div>
      <div id="payment-history-table">${paymentHistoryTable(payments)}</div>
    </section>
  `;

  document.querySelector("#payment-history-filters")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formValues = Object.fromEntries(new FormData(event.currentTarget));
    renderPaymentHistory(formValues).catch((err) => notify(err.message, true));
  });
}

export async function exportPaymentHistory(format) {
  const form = document.querySelector("#payment-history-filters");
  const query = new URLSearchParams(form ? Object.fromEntries(new FormData(form)) : {});
  query.set("format", format);

  const response = await fetch(`/api/payments/export?${query}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Could not export payment history (${response.status}).`);
  }

  const blob = await response.blob();
  const extension = format === "excel" ? "csv" : "pdf";
  const url = URL.createObjectURL(blob);
  const download = document.createElement("a");
  download.href = url;
  download.download = `payment-history-${new Date().toISOString().slice(0, 10)}.${extension}`;
  document.body.append(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
