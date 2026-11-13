/**
 * Quotations & Estimates view
 */
import { api } from "../api.js";
import { state } from "../state.js";
import {
  escapeHtml,
  money,
  dateFormat,
  statusPill,
  notify,
  heading,
  emptyState,
  setPageTitle,
} from "../utils.js";
import { openModal } from "../components/modal.js";
import { documentBrand, whatsappShareUrl } from "../components/brand.js";

export function quoteTable(rows) {
  if (!rows || !rows.length) {
    return emptyState("No quotes yet", "Prepare a clear estimate before initiating a new project.");
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Quote</th>
            <th>Customer</th>
            <th>Created</th>
            <th>Valid until</th>
            <th>Amount</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (quote) => `
            <tr>
              <td><strong>${escapeHtml(quote.quote_number)}</strong></td>
              <td>${escapeHtml(quote.customer_name)}</td>
              <td>${dateFormat(quote.issue_date)}</td>
              <td>${dateFormat(quote.valid_until)}</td>
              <td><strong>${money(quote.total_paise)}</strong></td>
              <td>${statusPill(quote.status)}</td>
              <td>
                <button class="table-action" data-quote="${quote.id}"><span>👁</span> Open / Print</button>
                ${
                  state.access.invoices && quote.status !== "declined"
                    ? ` <button class="table-action" data-convert-quote="${quote.id}"><span>⚡</span> Convert</button>`
                    : ""
                }
                ${
                  state.authenticatedUser?.role === "admin"
                    ? ` <button class="table-action danger" data-delete-quote="${quote.id}" data-document-number="${escapeHtml(quote.quote_number)}"><span>✕</span> Delete</button>`
                    : ""
                }
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

export async function renderQuotes() {
  setPageTitle("Quotes");
  const content = document.querySelector("#page-content");
  if (!content) return;

  state.quoteCache = await api("/api/quotes");

  const button =
    state.access.quotes && state.access.customers_view
      ? `<button class="button primary" data-action="new-quote">＋ Create quote</button>`
      : "";

  content.innerHTML = `
    ${heading(
      "BEFORE THE PROJECT BEGINS",
      "Quotes",
      "Prepare estimates and convert approved proposals into invoices with one click.",
      button
    )}
    <div class="demo-alert-strip">
      <span class="demo-strip-badge">DEMO APPLICATION</span>
      <span>All generated quotes carry the <strong>"Demo Quotation/Invoices"</strong> watermark. Shared documents are for demonstration only and are not valid.</span>
    </div>
    <section class="content-card">
      <div class="toolbar">
        <input class="search" id="quote-search" type="search" placeholder="Search quote or customer…" />
        <span class="stat-caption">${state.quoteCache.length} total</span>
      </div>
      <div id="quote-table">${quoteTable(state.quoteCache)}</div>
    </section>
  `;

  document.querySelector("#quote-search")?.addEventListener("input", () => {
    const query = (document.querySelector("#quote-search")?.value || "").toLowerCase();
    const filtered = state.quoteCache.filter((quote) =>
      `${quote.quote_number} ${quote.customer_name}`.toLowerCase().includes(query)
    );
    const tableEl = document.querySelector("#quote-table");
    if (tableEl) tableEl.innerHTML = quoteTable(filtered);
  });
}

export async function openQuote(id) {
  try {
    const [quote, currentSettings] = await Promise.all([
      api(`/api/quotes/${id}`),
      api("/api/settings"),
    ]);

    const rows = (quote.items || [])
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.description)}</td>
            <td>${item.quantity}</td>
            <td>${money(item.unit_price_paise)}</td>
            <td>${item.tax_rate}%</td>
            <td>${money(item.line_total_paise)}</td>
          </tr>`
      )
      .join("");

    const body = `
      <div id="print-document" class="watermark-container">
        ${documentBrand(currentSettings, "QUOTATION", quote.quote_number, quote.status)}
        <div class="detail-meta">
          <span>Prepared for</span><strong>${escapeHtml(quote.customer.name)}</strong>
          <span>Quote date</span><strong>${dateFormat(quote.issue_date)}</strong>
          <span>Email</span><strong>${escapeHtml(quote.customer.email || "—")}</strong>
          <span>Valid until</span><strong>${dateFormat(quote.valid_until)}</strong>
          ${quote.customer.address ? `<span>Address</span><strong>${escapeHtml(quote.customer.address)}</strong>` : ""}
          ${quote.customer.gstin ? `<span>GSTIN</span><strong>${escapeHtml(quote.customer.gstin)}</strong>` : ""}
        </div>
        <div class="table-wrap" style="margin-top:20px">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Tax</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="totals">
          <div class="total-row"><span>Subtotal</span><strong>${money(quote.subtotal_paise)}</strong></div>
          <div class="total-row"><span>Tax</span><strong>${money(quote.tax_paise)}</strong></div>
          <div class="total-row grand"><span>Quote total</span><strong>${money(quote.total_paise)}</strong></div>
        </div>
        ${quote.notes ? `<p class="muted-note" style="margin-top:20px">${escapeHtml(quote.notes)}</p>` : ""}
        <div class="demo-footer-disclaimer">
          <strong>⚠️ DEMO NOTICE:</strong> This is a Demo application, so shared invoices and quotations are not Valid.
          <span class="watermark-pill-inline">Demo Quotation/Invoices</span>
        </div>
        <p class="print-only muted-note" style="margin-top:20px">Thank you for considering our services.</p>
      </div>
    `;

    const shareUrl = whatsappShareUrl({
      settings: currentSettings,
      type: "quote",
      number: quote.quote_number,
      customer: quote.customer,
      issueDate: quote.issue_date,
      validUntil: quote.valid_until,
      items: quote.items,
      subtotalPaise: quote.subtotal_paise,
      taxPaise: quote.tax_paise,
      totalPaise: quote.total_paise,
      notes: quote.notes,
    });

    openModal(
      `Quotation ${escapeHtml(quote.quote_number)}`,
      `${escapeHtml(quote.customer.name)} · ${money(quote.total_paise)}`,
      body,
      `<button class="button" type="button" data-close>Close</button>
       ${
         state.authenticatedUser?.role === "admin"
           ? `<button class="button danger" type="button" data-delete-quote="${quote.id}" data-document-number="${escapeHtml(quote.quote_number)}">Delete quote</button>`
           : ""
       }
       <a class="button" href="/api/quotes/${quote.id}/pdf" download="${quote.quote_number}.pdf">Download PDF</a>
       <button class="button" type="button" data-print>Print</button>
       <a class="button whatsapp-button" href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener noreferrer">Share to WhatsApp</a>`
    );
  } catch (error) {
    notify(error.message, true);
  }
}
