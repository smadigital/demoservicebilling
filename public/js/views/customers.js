/**
 * Customers management view
 */
import { api } from "../api.js";
import { state } from "../state.js";
import {
  escapeHtml,
  heading,
  emptyState,
  setPageTitle,
  notify,
  field,
} from "../utils.js";
import { openModal, closeModal } from "../components/modal.js";

export function customerTable(rows) {
  if (!rows || !rows.length) {
    return emptyState("No customers yet", "Add a customer to create your first quote or invoice.");
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>GSTIN</th>
            ${state.access.customers_manage ? "<th></th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (customer) => `
            <tr>
              <td><strong>${escapeHtml(customer.name)}</strong></td>
              <td>${escapeHtml(customer.email || "—")}</td>
              <td>${escapeHtml(customer.phone || "—")}</td>
              <td>${escapeHtml(customer.gstin || "—")}</td>
              ${
                state.access.customers_manage
                  ? `<td><button class="table-action" data-edit-customer="${customer.id}"><span>✎</span> Edit</button></td>`
                  : ""
              }
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function renderCustomers() {
  setPageTitle("Customers");
  const content = document.querySelector("#page-content");
  if (!content) return;

  const actionBtn = state.access.customers_manage
    ? `<button class="button primary" data-action="new-customer">＋ Add customer</button>`
    : "";

  content.innerHTML = `
    ${heading(
      "PEOPLE YOU WORK WITH",
      "Customers",
      "Maintain centralized customer records and tax identifiers for billing.",
      actionBtn
    )}
    <section class="content-card">
      <div class="toolbar">
        <input class="search" id="customer-search" type="search" placeholder="Search customers…" />
        <span class="stat-caption">${state.customers.length} total</span>
      </div>
      <div id="customer-table">${customerTable(state.customers)}</div>
    </section>
  `;

  document.querySelector("#customer-search")?.addEventListener("input", () => {
    const query = (document.querySelector("#customer-search")?.value || "").toLowerCase();
    const filtered = state.customers.filter((c) =>
      `${c.name} ${c.email} ${c.phone} ${c.gstin}`.toLowerCase().includes(query)
    );
    const tableEl = document.querySelector("#customer-table");
    if (tableEl) tableEl.innerHTML = customerTable(filtered);
  });
}

export function openCustomerForm(customer = null, onSaved = null) {
  const isEdit = !!customer;
  const body = `
    <form id="customer-form" class="form-grid">
      ${field("Customer / business name", "name", customer?.name || "", "text", true)}
      ${field("Email", "email", customer?.email || "", "email")}
      ${field("Phone", "phone", customer?.phone || "")}
      ${field("GSTIN / Tax ID (optional)", "gstin", customer?.gstin || "")}
      ${field("Billing address", "address", customer?.address || "", "textarea", false, true)}
    </form>
  `;

  openModal(
    isEdit ? "Edit customer" : "Add a customer",
    "Keep client billing information centralized and organized.",
    body,
    `<button class="button" type="button" data-close>Cancel</button>
     <button class="button primary" type="submit" form="customer-form">${isEdit ? "Save changes" : "Add customer"}</button>`
  );

  document.querySelector("#customer-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(isEdit ? `/api/customers/${customer.id}` : "/api/customers", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(values),
      });
      closeModal();
      notify(isEdit ? "Customer updated." : "Customer added.");
      if (typeof onSaved === "function") {
        onSaved();
      }
    } catch (error) {
      notify(error.message, true);
    }
  });
}
