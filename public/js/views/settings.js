/**
 * Business settings, RBAC team permissions, and demo controls
 */
import { api } from "../api.js";
import { state } from "../state.js";
import {
  escapeHtml,
  dateFormat,
  heading,
  emptyState,
  setPageTitle,
  notify,
  field,
} from "../utils.js";
import { openModal, closeModal } from "../components/modal.js";

export async function renderSettings(selectedUserId = null, onNavigate = null) {
  setPageTitle("Business settings");
  const content = document.querySelector("#page-content");
  if (!content) return;

  const users = await api("/api/users");
  const staff = users.filter((u) => u.role !== "admin");
  const selectedUser =
    staff.find((u) => u.id === Number(selectedUserId)) ||
    staff.find((u) => u.username === "sales") ||
    staff[0];

  const targetPermissions = selectedUser
    ? (await api(`/api/access?user_id=${selectedUser.id}`)).permissions
    : {};

  state.salesAccess = targetPermissions;

  const userRows = users
    .map(
      (user) => `
      <tr class="${selectedUser?.id === user.id ? "selected-user" : ""}">
        <td><strong>${escapeHtml(user.display_name)}</strong></td>
        <td>${escapeHtml(user.username)}</td>
        <td>${user.role === "admin" ? "Administrator" : "Staff"}</td>
        <td>${dateFormat(user.created_at?.slice(0, 10))}</td>
        <td>
          ${
            user.role === "admin"
              ? "Full access"
              : `<button class="table-action" type="button" data-manage-user="${user.id}"><span>🛡</span> ${
                  selectedUser?.id === user.id ? "Selected" : "Manage access"
                }</button>
                 <button class="table-action" type="button" data-reset-user="${user.id}" data-user-name="${escapeHtml(
                  user.display_name
                )}"><span>🔑</span> Reset password</button>
                 <button class="table-action danger" type="button" data-delete-user="${user.id}" data-user-name="${escapeHtml(
                  user.display_name
                )}"><span>✕</span> Delete</button>`
          }
        </td>
      </tr>`
    )
    .join("");

  content.innerHTML = `
    ${heading(
      "CONFIGURATION & WORKSPACE",
      "Business settings",
      "Manage company identity, team permissions, and demo workspace tools.",
      `<button class="button primary" type="button" data-action="new-user">＋ Add user</button>`
    )}
    <div class="settings-layout">
      <div class="settings-stack">
        <!-- Business Details -->
        <form id="settings-form" class="content-card settings-card">
          <h2>Business details</h2>
          <p>These contact details appear on all invoices, estimates, and client PDFs.</p>
          <div class="form-grid">
            ${field("Business name", "business_name", state.settings.business_name, "text", true)}
            ${field("Email", "business_email", state.settings.business_email, "email")}
            ${field("Phone", "business_phone", state.settings.business_phone)}
            ${field("GSTIN / Tax ID", "business_gstin", state.settings.business_gstin)}
            ${field("Invoice prefix", "invoice_prefix", state.settings.invoice_prefix)}
            ${field("Default payment terms", "payment_terms", state.settings.payment_terms)}
            ${field("Business address", "business_address", state.settings.business_address, "textarea", false, true)}
          </div>
          <p class="muted-note">Tax rates are configured per service and can be adjusted per invoice line.</p>
          <button class="button primary" type="submit" style="margin-top:16px">Save settings</button>
        </form>

        <!-- User Accounts -->
        <section class="content-card settings-card">
          <h2>Team accounts</h2>
          <p>Staff and admin accounts that can access this billing workspace.</p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Added</th>
                  <th>Access</th>
                </tr>
              </thead>
              <tbody>${userRows}</tbody>
            </table>
          </div>
        </section>

        <!-- Permissions Matrix -->
        ${
          selectedUser
            ? `<form id="access-form" class="content-card settings-card" data-user-id="${selectedUser.id}">
                 <h2>Permissions for ${escapeHtml(selectedUser.display_name)} (${escapeHtml(selectedUser.username)})</h2>
                 <p>Grant or restrict role privileges for this staff account. Admin accounts always have full access.</p>
                 <div class="access-list">
                   ${accessToggle("customers_view", "View customers", "Allow user to see customer directory and select clients for invoices.", false, targetPermissions)}
                   ${accessToggle("customers_manage", "Add and edit customers", "Allow user to create customers or update contact details.", false, targetPermissions)}
                   ${accessToggle("services_view", "View services", "Allow user to view service catalogue and base pricing.", false, targetPermissions)}
                   ${accessToggle("services_manage", "Add and edit services", "Allow user to modify services and change default rates.", false, targetPermissions)}
                   ${accessToggle("quotes", "Quotes / Estimates", "Allow user to prepare, send, and convert quotes to invoices.", false, targetPermissions)}
                   ${accessToggle("invoices", "Invoices", "Allow user to create, edit, and view invoices.", false, targetPermissions)}
                   ${accessToggle("invoices_send", "Send invoices & PDFs", "Allow user to share documents via WhatsApp or download PDFs.", false, targetPermissions)}
                   ${accessToggle("payments", "Record payments", "Allow user to record full or partial customer payments.", false, targetPermissions)}
                 </div>
                 <p class="muted-note">Creating quotes and invoices requires customer access. Sending documents and recording payments require invoice access.</p>
                 <button class="button primary" type="submit" style="margin-top:16px">Save permissions</button>
               </form>`
            : `<section class="content-card settings-card">${emptyState("No staff accounts", "Add a user to grant granular permissions.")}</section>`
        }
      </div>

      <aside class="settings-stack">
        <!-- Demo Controls Card -->
        <div class="content-card settings-card demo-card">
          <h2>✦ Client Demo Controls</h2>
          <p>Showcasing this software to prospective clients? You can quickly reset the database to pristine demo data at any time.</p>
          <div class="demo-card-actions">
            <button class="button primary" id="btn-reset-demo" type="button" style="width:100%;margin-bottom:8px">
              ↺ Reset to Demo Data
            </button>
            <small class="muted-note">Restores sample clients (Acme Global, Stellar Media, etc.), services, quotes, and sample invoices (Paid, Partial, Overdue).</small>
          </div>
        </div>

        <!-- Compliance & Security -->
        <div class="content-card settings-card">
          <h2>Tax & Security</h2>
          <p>Tax is configurable per item and stored as a percentage on each line item.</p>
          <div class="notice">
            All invoice amounts and calculations are verified on the server. Data is stored safely in local SQLite.
          </div>
          <p class="muted-note">
            Remember to back up the <code>data/</code> directory before moving between demonstration and production workloads.
          </p>
        </div>
      </aside>
    </div>
  `;

  // Attach event handlers
  document.querySelector("#settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      state.settings = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify(values),
      });
      notify("Business settings saved successfully.");
    } catch (err) {
      notify(err.message, true);
    }
  });

  const accessForm = document.querySelector("#access-form");
  if (accessForm) {
    accessForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(
        [...form.querySelectorAll('input[type="checkbox"]')].map((input) => [
          input.name,
          input.checked,
        ])
      );
      values.user_id = Number(form.dataset.userId);
      try {
        await api("/api/access", { method: "PUT", body: JSON.stringify(values) });
        notify("User permissions saved.");
        await renderSettings(values.user_id, onNavigate);
      } catch (err) {
        notify(err.message, true);
      }
    });

    const syncDependencies = () => {
      const customersView = accessForm.elements.customers_view;
      const servicesView = accessForm.elements.services_view;
      const invoices = accessForm.elements.invoices;

      for (const name of ["customers_manage", "quotes", "invoices"]) {
        if (accessForm.elements[name]) {
          accessForm.elements[name].disabled = !customersView.checked;
          if (!customersView.checked) accessForm.elements[name].checked = false;
        }
      }
      if (accessForm.elements.services_manage) {
        accessForm.elements.services_manage.disabled = !servicesView.checked;
        if (!servicesView.checked) accessForm.elements.services_manage.checked = false;
      }
      for (const name of ["invoices_send", "payments"]) {
        if (accessForm.elements[name]) {
          accessForm.elements[name].disabled = !invoices.checked;
          if (!invoices.checked) accessForm.elements[name].checked = false;
        }
      }
    };
    accessForm.addEventListener("change", syncDependencies);
    syncDependencies();
  }

  // Demo Reset Handler
  document.querySelector("#btn-reset-demo")?.addEventListener("click", async () => {
    if (
      !window.confirm(
        "Are you sure you want to reset all data back to the clean demo state? Any unsaved edits will be replaced with fresh demo samples."
      )
    ) {
      return;
    }
    try {
      const result = await api("/api/demo/reset", { method: "POST", body: "{}" });
      notify(result.message || "Demo data restored.");
      if (typeof onNavigate === "function") {
        onNavigate("dashboard");
      }
    } catch (err) {
      notify(err.message, true);
    }
  });
}

function accessToggle(name, title, description, disabled = false, permissions = {}) {
  return `
    <label class="access-row">
      <span>
        <strong>${title}</strong>
        <small>${description}</small>
      </span>
      <input type="checkbox" name="${name}" ${permissions[name] ? "checked" : ""} ${disabled ? "disabled" : ""} />
    </label>
  `;
}

export function openPasswordResetForm(user) {
  const body = `
    <form id="password-reset-form" class="form-grid">
      <div class="field">
        <label for="reset-password">New password</label>
        <input id="reset-password" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
        <small class="muted-note">Minimum 8 characters.</small>
      </div>
      <div class="field">
        <label for="reset-password-confirm">Confirm new password</label>
        <input id="reset-password-confirm" name="confirm_password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
      </div>
    </form>
  `;

  openModal(
    `Reset password for ${escapeHtml(user.display_name)}`,
    "Active sessions for this user will be revoked.",
    body,
    `<button class="button" type="button" data-close>Cancel</button>
     <button class="button primary" type="submit" form="password-reset-form">Save new password</button>`
  );

  document.querySelector("#password-reset-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (values.password !== values.confirm_password) {
      notify("The passwords do not match.", true);
      return;
    }
    try {
      await api(`/api/users/${user.id}/password`, {
        method: "PUT",
        body: JSON.stringify({ password: values.password }),
      });
      closeModal();
      notify("Password updated successfully.");
    } catch (err) {
      notify(err.message, true);
    }
  });
}

export function openUserForm(onUserCreated = null) {
  const body = `
    <form id="user-form" class="form-grid">
      ${field("Full name", "display_name", "", "text", true)}
      ${field("Username", "username", "", "text", true)}
      <small class="muted-note full">3–32 alphanumeric characters, dots, underscores, or hyphens.</small>
      <div class="field">
        <label for="user-password">Initial password</label>
        <input id="user-password" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
        <small class="muted-note">Minimum 8 characters.</small>
      </div>
    </form>
  `;

  openModal(
    "Add a team user",
    "Create a new staff login, then configure their role permissions.",
    body,
    `<button class="button" type="button" data-close>Cancel</button>
     <button class="button primary" type="submit" form="user-form">Create user</button>`
  );

  document.querySelector("#user-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const user = await api("/api/users", { method: "POST", body: JSON.stringify(values) });
      closeModal();
      notify("User created successfully.");
      if (typeof onUserCreated === "function") {
        onUserCreated(user.id);
      }
    } catch (err) {
      notify(err.message, true);
    }
  });
}
