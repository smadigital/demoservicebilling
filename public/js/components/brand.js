/**
 * Document branding and sharing helpers
 */
import { escapeHtml, dateFormat, money, statusPill } from "../utils.js";

export function documentBrand(settings, label, number, status) {
  const businessName = escapeHtml(settings?.business_name || "SMADemo Technologies");
  const businessAddress = escapeHtml(settings?.business_address || "");
  const businessPhone = escapeHtml(settings?.business_phone || "");
  const businessEmail = escapeHtml(settings?.business_email || "");
  const businessGstin = escapeHtml(settings?.business_gstin || "");

  return `
    <div class="demo-disclaimer-banner">
      <span class="demo-pill-warning">DEMO NOTICE</span>
      <span>This is a Demo application, so shared invoices and quotations are not Valid.</span>
    </div>
    <div class="detail-header">
      <div class="business-brand">
        <img class="document-logo" src="/logo.png" alt="${businessName} logo" />
        <div>
          <div class="detail-brand">${businessName}</div>
          <div class="business-contact">
            ${businessAddress ? `${businessAddress}<br>` : ""}
            ${businessPhone ? `Phone / WhatsApp: ${businessPhone}<br>` : ""}
            ${businessEmail ? `Email: ${businessEmail}` : ""}
            ${businessGstin ? `<br>GSTIN: ${businessGstin}` : ""}
          </div>
        </div>
      </div>
      <div class="document-title">
        <p class="eyebrow">${label}</p>
        <h2>${escapeHtml(number)}</h2>
        <div class="document-badge-row">
          ${statusPill(status)}
          <span class="watermark-tag">Demo Quotation/Invoices</span>
        </div>
      </div>
    </div>
  `;
}

export function whatsappShareUrl({
  settings = {},
  type,
  number,
  customer,
  issueDate,
  dueDate,
  validUntil,
  items,
  subtotalPaise,
  taxPaise,
  totalPaise,
  paidPaise = 0,
  notes,
}) {
  const businessName = settings?.business_name || "SMADemo Technologies";
  const label = type === "quote" ? "quotation" : "invoice";
  const itemLines = items.map(
    (item) => `• ${item.description} × ${item.quantity}: ${money(item.line_total_paise)}`
  );
  const dateLine =
    type === "quote"
      ? `Valid until: ${dateFormat(validUntil)}`
      : `Due date: ${dateFormat(dueDate)}`;

  const message = [
    `⚠️ [DEMO QUOTATION/INVOICES - NOT VALID] ⚠️`,
    `Notice: This is a Demo application, so shared invoices and quotations are not Valid.`,
    "",
    `Hello ${customer.name},`,
    "",
    `Please find the details of your ${label} ${number} from ${businessName}.`,
    `Date: ${dateFormat(issueDate)}`,
    dateLine,
    "",
    ...itemLines,
    "",
    `Subtotal: ${money(subtotalPaise)}`,
    `Tax: ${money(taxPaise)}`,
    `${type === "quote" ? "Quotation total" : "Invoice total"}: ${money(totalPaise)}`,
    ...(type === "invoice"
      ? [
          `Paid: ${money(paidPaise)}`,
          `Balance due: ${money(Math.max(0, totalPaise - paidPaise))}`,
        ]
      : []),
    ...(notes ? ["", `Notes: ${notes}`] : []),
    "",
    settings?.business_address ? settings.business_address : "",
    settings?.business_phone ? `Phone / WhatsApp: ${settings.business_phone}` : "",
    settings?.business_email ? `Email: ${settings.business_email}` : "",
    "",
    `⚠️ DISCLAIMER: This is a Demo application, so shared invoices and quotations are not Valid. (Demo Quotation/Invoices)`,
  ]
    .filter(Boolean)
    .join("\n");

  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
