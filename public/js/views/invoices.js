/**
 * Invoices view and document management
 */
import { api } from "../api.js";
import { state } from "../state.js";
import {
  escapeHtml,
  money,
  rupees,
  dateFormat,
  statusLabel,
  statusPill,
  notify,
  heading,
  emptyState,
  setPageTitle,
  today,
  field,
} from "../utils.js";
import { openModal, closeModal, getDialog } from "../components/modal.js";
import { documentBrand, whatsappShareUrl } from "../components/brand.js";

export function invoiceTable(rows, compact = false) {
  if (!rows || !rows.length) {
    return emptyState("No invoices yet", "Create your first invoice to start billing and tracking payments.");
  }

  const displayedRows = rows.slice(0, compact ? 5 : rows.length);

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Due date</th>
            <th>Amount</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${displayedRows
            .map((invoice) => {
              const status = statusLabel(invoice);
              const deleteAction =
                !compact && state.authenticatedUser?.role === "admin"
                  ? ` <button class="table-action danger" data-delete-invoice="${invoice.id}" data-document-number="${escapeHtml(invoice.invoice_number)}"><span>✕</span> Delete</button>`
                  : "";
              return `
                <tr>
                  <td><strong>${escapeHtml(invoice.invoice_number)}</strong></td>
                  <td>${escapeHtml(invoice.customer_name)}</td>
                  <td>${dateFormat(invoice.due_date)}</td>
                  <td><strong>${money(invoice.total_paise)}</strong></td>
                  <td>${statusPill(status)}</td>
                  <td>
                    <button class="table-action" data-invoice="${invoice.id}"><span>👁</span> Open</button>
                    ${deleteAction}
                  </td>
                </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

export async function renderInvoices() {
  setPageTitle("Invoices");
  const content = document.querySelector("#page-content");
  if (!content) return;

  state.invoiceCache = await api("/api/invoices");

  const button =
    state.access.invoices && state.access.customers_view
      ? `<button class="button primary" data-action="new-invoice">＋ Create invoice</button>`
      : "";

  content.innerHTML = `
    ${heading("PAYMENTS, MADE CLEAR", "Invoices", "Create, bill, and monitor project invoicing and balances.", button)}
    <div class="demo-alert-strip">
      <span class="demo-strip-badge">DEMO APPLICATION</span>
      <span>All generated invoices & quotations carry the <strong>"Demo Quotation/Invoices"</strong> watermark. Shared documents are for demonstration only and are not valid.</span>
    </div>
    <section class="content-card">
      <div class="toolbar">
        <input class="search" id="invoice-search" type="search" placeholder="Search invoice or customer…" />
        <select id="invoice-filter">
          <option value="all">All statuses</option>
          <option value="sent">Sent</option>
          <option value="partial">Partially paid</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
        </select>
      </div>
      <div id="invoice-table">${invoiceTable(state.invoiceCache)}</div>
    </section>
  `;

  document.querySelector("#invoice-search")?.addEventListener("input", filterInvoices);
  document.querySelector("#invoice-filter")?.addEventListener("change", filterInvoices);
}

export function filterInvoices() {
  const query = (document.querySelector("#invoice-search")?.value || "").toLowerCase();
  const status = document.querySelector("#invoice-filter")?.value || "all";
  const rows = state.invoiceCache.filter((invoice) => {
    const matchesText = `${invoice.invoice_number} ${invoice.customer_name}`.toLowerCase().includes(query);
    return matchesText && (status === "all" || statusLabel(invoice) === status);
  });
  const tableContainer = document.querySelector("#invoice-table");
  if (tableContainer) {
    tableContainer.innerHTML = invoiceTable(rows);
  }
}

export async function openInvoice(id, onStateChanged = null) {
  try {
    const [invoice, currentSettings] = await Promise.all([
      api(`/api/invoices/${id}`),
      api("/api/settings"),
    ]);

    const paid = Number(invoice.paid_paise) || 0;
    const balance = Math.max(0, invoice.total_paise - paid);
    const discountRow =
      invoice.discount_paise > 0
        ? `<div class="total-row"><span>Discount (${escapeHtml(invoice.discount_rate)}%)</span><strong>−${money(invoice.discount_paise)}</strong></div>`
        : "";

    const rows = (invoice.items || [])
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
        ${documentBrand(currentSettings, "INVOICE", invoice.invoice_number, statusLabel(invoice))}
        <div class="detail-meta">
          <span>Bill to</span><strong>${escapeHtml(invoice.customer.name)}</strong>
          <span>Issued</span><strong>${dateFormat(invoice.issue_date)}</strong>
          <span>Email</span><strong>${escapeHtml(invoice.customer.email || "—")}</strong>
          <span>Due date</span><strong>${dateFormat(invoice.due_date)}</strong>
          ${invoice.customer.address ? `<span>Address</span><strong>${escapeHtml(invoice.customer.address)}</strong>` : ""}
          ${invoice.customer.gstin ? `<span>GSTIN</span><strong>${escapeHtml(invoice.customer.gstin)}</strong>` : ""}
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
          <div class="total-row"><span>Subtotal</span><strong>${money(invoice.subtotal_paise)}</strong></div>
          <div class="total-row"><span>Tax</span><strong>${money(invoice.tax_paise)}</strong></div>
          ${discountRow}
          <div class="total-row grand"><span>Total</span><strong>${money(invoice.total_paise)}</strong></div>
          <div class="total-row"><span>Paid</span><strong>${money(paid)}</strong></div>
          <div class="total-row"><span>Balance due</span><strong>${money(balance)}</strong></div>
        </div>
        ${invoice.notes ? `<p class="muted-note" style="margin-top:20px">${escapeHtml(invoice.notes)}</p>` : ""}
        ${
          invoice.payments && invoice.payments.length
            ? `<h3 style="margin:22px 0 8px;font-size:11px">Payment history</h3>
               <div class="table-wrap">
                 <table>
                   <thead>
                     <tr>
                       <th>Date</th>
                       <th>Method</th>
                       <th>Reference</th>
                       <th>Amount</th>
                     </tr>
                   </thead>
                   <tbody>
                     ${invoice.payments
                       .map(
                         (payment) => `
                       <tr>
                         <td>${dateFormat(payment.payment_date)}</td>
                         <td>${escapeHtml(payment.method)}</td>
                         <td>${escapeHtml(payment.reference || "—")}</td>
                         <td><strong>${money(payment.amount_paise)}</strong></td>
                       </tr>`
                       )
                       .join("")}
                   </tbody>
                 </table>
               </div>`
            : ""
        }
        <div class="demo-footer-disclaimer">
          <strong>⚠️ DEMO NOTICE:</strong> This is a Demo application, so shared invoices and quotations are not Valid.
          <span class="watermark-pill-inline">Demo Quotation/Invoices</span>
        </div>
        <p class="print-only muted-note" style="margin-top:20px">Thank you for your business.</p>
      </div>
    `;

    const paymentButton =
      balance > 0 && state.access.payments
        ? `<button class="button primary" data-record-payment="${invoice.id}">＋ Record payment</button>`
        : "";

    const shareButton = state.access.invoices_send
      ? `<button class="button whatsapp-button" type="button" data-share-invoice="${invoice.id}" data-share-number="${escapeHtml(invoice.invoice_number)}" data-share-customer="${escapeHtml(invoice.customer.name)}">Share to WhatsApp</button>`
      : "";

    openModal(
      `Invoice ${escapeHtml(invoice.invoice_number)}`,
      `${escapeHtml(invoice.customer.name)} · Balance due ${money(balance)}`,
      body,
      `<button class="button" type="button" data-close>Close</button>
       ${state.authenticatedUser?.role === "admin" ? `<button class="button danger" type="button" data-delete-invoice="${invoice.id}" data-document-number="${escapeHtml(invoice.invoice_number)}">Delete invoice</button>` : ""}
       <a class="button" href="/api/invoices/${invoice.id}/pdf" download="${invoice.invoice_number}.pdf">Download PDF</a>
       <button class="button" type="button" data-print>Print</button>
       ${shareButton}
       ${paymentButton}`
    );
  } catch (error) {
    notify(error.message, true);
  }
}

export function openDocumentForm(type, onCreated = null) {
  if (!state.access.customers_view) {
    notify("Ask Admin to enable customer viewing before creating quotes or invoices.", true);
    return;
  }
  if (!state.customers.length) {
    notify("Please add at least one customer before creating a document.", true);
    return;
  }

  const isQuote = type === "quote";
  const title = isQuote ? "Create a quote" : "Create an invoice";
  const subtitle = isQuote
    ? "Outline the project scope and provide a formal price estimate."
    : "Bill for completed work, ongoing retainers, or agreed milestones.";

  const customerSelectOptions = state.customers
    .map(
      (c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`
    )
    .join("");

  const body = `
    <form id="document-form">
      <div class="demo-form-banner">
        <strong>✦ Demo Application Notice:</strong> This is a Demo application, so shared invoices and quotations are not Valid. All created records will carry the <em>"Demo Quotation/Invoices"</em> watermark.
      </div>
      <div class="form-grid">
        <div class="field full">
          <label for="customer_id">Customer</label>
          <select id="customer_id" name="customer_id" required>
            <option value="">Choose a customer…</option>
            ${customerSelectOptions}
          </select>
        </div>
        <div class="field">
          <label for="issue_date">Issue date</label>
          <input id="issue_date" name="issue_date" type="date" value="${today}" required />
        </div>
        <div class="field">
          <label for="${isQuote ? "valid_until" : "due_date"}">${isQuote ? "Valid until" : "Due date"}</label>
          <input id="${isQuote ? "valid_until" : "due_date"}" name="${isQuote ? "valid_until" : "due_date"}" type="date" ${
            isQuote ? "" : `value="${new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10)}"`
          } />
        </div>
      </div>

      <div class="line-items-wrap">
        <table class="line-items">
          <thead>
            <tr>
              <th>Service / description</th>
              <th>Qty</th>
              <th>Rate (₹)</th>
              <th>Tax %</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="line-rows"></tbody>
        </table>
      </div>

      <div class="line-controls">
        <button class="button small soft" type="button" data-add-line>＋ Add line item</button>
        <span class="stat-caption">Tax is computed per line item</span>
      </div>

      ${
        !isQuote
          ? `<div class="invoice-discount field">
               <label for="discount-rate">Discount (%)</label>
               <input id="discount-rate" name="discount_rate" type="number" min="0" max="100" step="0.01" value="0" />
               <small class="muted-note">Applied to subtotal after line taxes.</small>
             </div>`
          : ""
      }

      <div class="totals">
        <div class="total-row"><span>Subtotal</span><strong id="subtotal">₹0.00</strong></div>
        <div class="total-row"><span>Tax</span><strong id="tax-total">₹0.00</strong></div>
        ${!isQuote ? `<div class="total-row" id="discount-row" hidden><span id="discount-label">Discount</span><strong id="discount-total">−₹0.00</strong></div>` : ""}
        <div class="total-row grand"><span>Total</span><strong id="grand-total">₹0.00</strong></div>
      </div>

      <div class="field" style="margin-top:15px">
        <label for="notes">Notes / payment terms</label>
        <textarea id="notes" name="notes" placeholder="${escapeHtml(state.settings.payment_terms || "Add notes for your client")}">${
          isQuote ? "" : escapeHtml(state.settings.payment_terms || "")
        }</textarea>
      </div>
    </form>
  `;

  openModal(
    title,
    subtitle,
    body,
    `<button class="button" type="button" data-close>Cancel</button>
     <button class="button primary" type="submit" form="document-form">${isQuote ? "Save quote" : "Create invoice"}</button>`
  );

  const dialog = getDialog();
  addLine();

  dialog?.querySelector("[data-add-line]")?.addEventListener("click", () => addLine());
  document.querySelector("#line-rows")?.addEventListener("input", updateTotals);
  dialog?.querySelector("#discount-rate")?.addEventListener("input", updateTotals);

  document.querySelector("#line-rows")?.addEventListener("change", (event) => {
    if (event.target.matches(".item-select")) {
      const option = event.target.selectedOptions[0];
      const row = event.target.closest("tr");
      if (option?.dataset.service) {
        row.querySelector(".item-description").value = option.dataset.name;
        row.querySelector(".item-price").value = (Number(option.dataset.price) / 100).toFixed(2);
        row.querySelector(".item-tax").value = option.dataset.tax;
      }
      updateTotals();
    }
  });

  dialog?.querySelector("#line-rows")?.addEventListener("click", (event) => {
    if (event.target.matches(".remove-line")) {
      event.target.closest("tr").remove();
      if (!dialog.querySelector("#line-rows tr")) addLine();
      updateTotals();
    }
  });

  document.querySelector("#document-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rows = [...dialog.querySelectorAll("#line-rows tr")];
    const items = rows.map((row) => {
      const serviceSelect = row.querySelector(".item-select");
      return {
        service_id: serviceSelect.value || null,
        description: row.querySelector(".item-description").value,
        quantity: row.querySelector(".item-quantity").value,
        unit_price: row.querySelector(".item-price").value,
        tax_rate: row.querySelector(".item-tax").value,
      };
    });

    const payload = {
      customer_id: form.get("customer_id"),
      issue_date: form.get("issue_date"),
      [isQuote ? "valid_until" : "due_date"]: form.get(isQuote ? "valid_until" : "due_date"),
      notes: form.get("notes"),
      discount_rate: isQuote ? 0 : form.get("discount_rate"),
      items,
    };

    try {
      await api(isQuote ? "/api/quotes" : "/api/invoices", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      closeModal();
      notify(isQuote ? "Quote created." : "Invoice created.");
      if (typeof onCreated === "function") {
        onCreated(isQuote ? "quotes" : "invoices");
      }
    } catch (error) {
      notify(error.message, true);
    }
  });
}

export function addLine() {
  const dialog = getDialog();
  if (!dialog) return;

  const options = (state.services || [])
    .map(
      (service) =>
        `<option value="${service.id}" data-service="1" data-name="${escapeHtml(service.name)}" data-price="${service.price_paise}" data-tax="${service.tax_rate}">${escapeHtml(service.name)}</option>`
    )
    .join("");

  const row = document.createElement("tr");
  row.innerHTML = `
    <td data-label="Service / description">
      <div class="line-item-main">
        <select class="item-select"><option value="">Custom item…</option>${options}</select>
        <input class="item-description" aria-label="Item description" placeholder="Description" required />
      </div>
    </td>
    <td data-label="Qty">
      <input class="item-quantity" type="number" min="0.01" step="0.01" value="1" aria-label="Quantity" required />
    </td>
    <td data-label="Rate (₹)">
      <input class="item-price" type="number" min="0" step="0.01" value="0" aria-label="Rate in rupees" required />
    </td>
    <td data-label="Tax %">
      <input class="item-tax" type="number" min="0" max="100" step="0.01" value="0" aria-label="Tax percent" />
    </td>
    <td class="line-remove-cell">
      <button class="remove-line" type="button" aria-label="Remove line item" title="Remove line item">×</button>
    </td>
  `;

  dialog.querySelector("#line-rows")?.append(row);
  updateTotals();
}

export function updateTotals() {
  const dialog = getDialog();
  if (!dialog) return;

  let subtotal = 0;
  let tax = 0;

  for (const row of dialog.querySelectorAll("#line-rows tr")) {
    const qty = Number(row.querySelector(".item-quantity")?.value) || 0;
    const rate = Number(row.querySelector(".item-price")?.value) || 0;
    const line = Math.round(qty * rate * 100);
    const taxRate = Math.min(100, Math.max(0, Number(row.querySelector(".item-tax")?.value) || 0));

    subtotal += line;
    tax += Math.round((line * taxRate) / 100);
  }

  const discountRate = Number(dialog.querySelector("#discount-rate")?.value) || 0;
  const discountPaise = Math.round((subtotal * discountRate) / 100);

  const subtotalEl = dialog.querySelector("#subtotal");
  const taxTotalEl = dialog.querySelector("#tax-total");
  const grandTotalEl = dialog.querySelector("#grand-total");
  const discountRow = dialog.querySelector("#discount-row");

  if (subtotalEl) subtotalEl.textContent = money(subtotal);
  if (taxTotalEl) taxTotalEl.textContent = money(tax);

  if (discountRow) {
    discountRow.hidden = discountPaise === 0;
    const labelEl = dialog.querySelector("#discount-label");
    const totalEl = dialog.querySelector("#discount-total");
    if (labelEl) labelEl.textContent = `Discount (${discountRate}%)`;
    if (totalEl) totalEl.textContent = `−${money(discountPaise)}`;
  }

  if (grandTotalEl) {
    grandTotalEl.textContent = money(subtotal + tax - discountPaise);
  }
}

export function openPaymentForm(invoiceId, onPaymentSaved = null) {
  const body = `
    <form id="payment-form" class="form-grid">
      ${field("Amount received (₹)", "amount", "", "number", true)}
      <div class="field">
        <label for="payment_date">Payment date</label>
        <input id="payment_date" name="payment_date" type="date" value="${today}" required />
      </div>
      <div class="field">
        <label for="method">Payment method</label>
        <select id="method" name="method">
          <option>Bank transfer</option>
          <option>UPI</option>
          <option>Credit card</option>
          <option>Cash</option>
          <option>Cheque</option>
          <option>Other</option>
        </select>
      </div>
      ${field("Reference / Transaction ID", "reference")}
      <div class="field full">
        <label for="notes">Notes (optional)</label>
        <textarea id="notes" name="notes"></textarea>
      </div>
    </form>
  `;

  openModal(
    "Record a payment",
    "Record full or partial payment against this invoice.",
    body,
    `<button class="button" type="button" data-close>Cancel</button>
     <button class="button primary" type="submit" form="payment-form">Save payment</button>`
  );

  document.querySelector("#payment-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/api/invoices/${invoiceId}/payments`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      closeModal();
      notify("Payment recorded successfully.");
      if (typeof onPaymentSaved === "function") {
        onPaymentSaved(invoiceId);
      }
    } catch (error) {
      notify(error.message, true);
    }
  });
}

export async function shareInvoicePdf(button) {
  button.disabled = true;
  try {
    const response = await fetch(`/api/invoices/${encodeURIComponent(button.dataset.shareInvoice)}/pdf`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Could not generate PDF (${response.status}).`);
    }

    const blob = await response.blob();
    const filename = `${button.dataset.shareNumber.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
    const file = typeof File === "function" ? new File([blob], filename, { type: "application/pdf" }) : null;
    const businessName = state.settings.business_name || "SMADemo Technologies";
    const message = `⚠️ [DEMO QUOTATION/INVOICES - NOT VALID]\nHello ${button.dataset.shareCustomer}, please find demo invoice ${button.dataset.shareNumber} from ${businessName} attached.\n(Notice: This is a Demo application, so shared invoices and quotations are not Valid.)`;

    if (
      file &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share({ files: [file], title: `Invoice ${button.dataset.shareNumber}`, text: message });
      } catch (error) {
        if (error.name !== "AbortError") throw error;
      }
      return;
    }

    const downloadUrl = URL.createObjectURL(blob);
    const download = document.createElement("a");
    download.href = downloadUrl;
    download.download = filename;
    document.body.append(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    notify("The invoice PDF was downloaded. Attach it in WhatsApp to send.");
  } catch (error) {
    if (error.name !== "AbortError") notify(error.message, true);
  } finally {
    button.disabled = false;
  }
}

export async function deleteDocument(type, id, number, onDeleted = null) {
  if (state.authenticatedUser?.role !== "admin") {
    notify("Admin access is required to delete documents.", true);
    return;
  }
  const label = type === "quote" ? "quote" : "invoice";
  const paymentWarning =
    type === "invoice" ? " Invoices with recorded payments cannot be deleted." : "";

  if (
    !window.confirm(
      `Permanently delete ${label} ${number}? This action cannot be undone.${paymentWarning}`
    )
  ) {
    return;
  }

  try {
    await api(`/api/${type === "quote" ? "quotes" : "invoices"}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: "{}",
    });
    closeModal();
    notify(`${label.charAt(0).toUpperCase()}${label.slice(1)} ${number} deleted.`);
    if (typeof onDeleted === "function") {
      onDeleted();
    }
  } catch (error) {
    notify(error.message, true);
  }
}
