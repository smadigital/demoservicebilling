/**
 * Services catalogue view
 */
import { api } from "../api.js";
import { state } from "../state.js";
import {
  escapeHtml,
  money,
  rupees,
  heading,
  emptyState,
  setPageTitle,
  notify,
  field,
} from "../utils.js";
import { openModal, closeModal } from "../components/modal.js";

export function serviceTable(rows) {
  if (!rows || !rows.length) {
    return emptyState(
      "Your service catalogue is ready",
      "Add your billable services and set default prices and tax rates."
    );
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Description</th>
            <th>Price</th>
            <th>Tax</th>
            ${state.access.services_manage ? "<th></th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (service) => `
            <tr>
              <td><strong>${escapeHtml(service.name)}</strong></td>
              <td>${escapeHtml(service.description || "—")}</td>
              <td><strong>${money(service.price_paise)}</strong></td>
              <td>${Number(service.tax_rate)}%</td>
              ${
                state.access.services_manage
                  ? `<td><button class="table-action" data-edit-service="${service.id}"><span>✎</span> Edit</button></td>`
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

export function renderServices() {
  setPageTitle("Services");
  const content = document.querySelector("#page-content");
  if (!content) return;

  const actionBtn = state.access.services_manage
    ? `<button class="button primary" data-action="new-service">＋ Add service</button>`
    : "";

  content.innerHTML = `
    ${heading(
      "YOUR WORK, YOUR WAY",
      "Services",
      "Configure your service catalogue with default pricing and tax percentages.",
      actionBtn
    )}
    <section class="content-card">
      <div class="toolbar">
        <input class="search" id="service-search" type="search" placeholder="Search services…" />
        <span class="stat-caption">${state.services.length} total</span>
      </div>
      <div id="service-table">${serviceTable(state.services)}</div>
    </section>
  `;

  document.querySelector("#service-search")?.addEventListener("input", () => {
    const query = (document.querySelector("#service-search")?.value || "").toLowerCase();
    const filtered = state.services.filter((s) =>
      `${s.name} ${s.description}`.toLowerCase().includes(query)
    );
    const tableEl = document.querySelector("#service-table");
    if (tableEl) tableEl.innerHTML = serviceTable(filtered);
  });
}

export function openServiceForm(service = null, onSaved = null) {
  const isEdit = !!service;
  const body = `
    <form id="service-form" class="form-grid">
      ${field("Service name", "name", service?.name || "", "text", true)}
      ${field("Price (₹)", "price", service ? rupees(service.price_paise) : "", "number", true)}
      <div class="field">
        <label for="tax_rate">Default tax (%)</label>
        <input id="tax_rate" name="tax_rate" type="number" min="0" max="100" step="0.01" value="${
          service?.tax_rate ?? 18
        }" />
      </div>
      <div class="field full">
        <label for="description">Description</label>
        <textarea id="description" name="description">${escapeHtml(service?.description || "")}</textarea>
      </div>
    </form>
  `;

  openModal(
    isEdit ? "Edit service" : "Add a service",
    "Set the service name, base pricing, and default tax rate.",
    body,
    `<button class="button" type="button" data-close>Cancel</button>
     <button class="button primary" type="submit" form="service-form">${isEdit ? "Save changes" : "Add service"}</button>`
  );

  document.querySelector("#service-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(isEdit ? `/api/services/${service.id}` : "/api/services", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(values),
      });
      closeModal();
      notify(isEdit ? "Service updated." : "Service added.");
      if (typeof onSaved === "function") {
        onSaved();
      }
    } catch (error) {
      notify(error.message, true);
    }
  });
}
