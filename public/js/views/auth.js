/**
 * Authentication & onboarding views
 */
import { api } from "../api.js";
import { escapeHtml } from "../utils.js";

const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector(".app-shell");

export function showAuthScreen(setupRequired, message = "", onLoginSuccess = null) {
  if (appShell) appShell.hidden = true;
  if (!authScreen) return;
  authScreen.hidden = false;

  const alert = message
    ? `<div class="auth-error" role="alert">${escapeHtml(message)}</div>`
    : "";

  if (setupRequired) {
    authScreen.innerHTML = `
      <section class="auth-card">
        <div class="auth-brand">
          <img class="brand-logo auth-logo" src="/logo.svg" onerror="this.onerror=null;this.src='/logo.png';" alt="ApexFlow logo" />
          <span>
            <strong>ApexFlow Billing</strong>
            <small>Workspace setup</small>
          </span>
        </div>
        <p class="eyebrow">FIRST-TIME SETUP</p>
        <h1>Create your accounts</h1>
        <p class="auth-description">
          Set up administrative and sales credentials for your workspace.
        </p>
        ${alert}
        <form id="setup-form" class="auth-form">
          <div class="auth-role-card">
            <strong>Admin account</strong>
            <span>Full management & business configuration</span>
          </div>
          <div class="field">
            <label for="admin-password">Admin password</label>
            <input id="admin-password" name="admin_password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
            <small class="muted-note">Minimum 8 characters.</small>
          </div>
          <div class="field">
            <label for="admin-confirm">Confirm admin password</label>
            <input id="admin-confirm" name="admin_confirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
          </div>
          <div class="auth-role-card">
            <strong>Sales account</strong>
            <span>Quotations, invoices and payments</span>
          </div>
          <div class="field">
            <label for="sales-password">Sales password</label>
            <input id="sales-password" name="sales_password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
            <small class="muted-note">Use a distinct password from admin.</small>
          </div>
          <div class="field">
            <label for="sales-confirm">Confirm sales password</label>
            <input id="sales-confirm" name="sales_confirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
          </div>
          <button class="button primary" type="submit">Complete Setup</button>
        </form>
      </section>
    `;

    document.querySelector("#setup-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const adminPass = form.get("admin_password");
      const adminConf = form.get("admin_confirm");
      const salesPass = form.get("sales_password");
      const salesConf = form.get("sales_confirm");

      if (adminPass !== adminConf) {
        showAuthScreen(true, "The admin passwords do not match.", onLoginSuccess);
        return;
      }
      if (salesPass !== salesConf) {
        showAuthScreen(true, "The sales passwords do not match.", onLoginSuccess);
        return;
      }
      if (adminPass === salesPass) {
        showAuthScreen(true, "Use different passwords for admin and sales.", onLoginSuccess);
        return;
      }

      try {
        const result = await api("/api/auth/setup", {
          method: "POST",
          body: JSON.stringify({
            admin_password: adminPass,
            sales_password: salesPass,
          }),
        });
        if (typeof onLoginSuccess === "function") {
          onLoginSuccess(result.user);
        }
      } catch (error) {
        showAuthScreen(true, error.message, onLoginSuccess);
      }
    });
    return;
  }

  // Sign In Screen
  authScreen.innerHTML = `
    <section class="auth-card">
      <div class="auth-brand">
        <img class="brand-logo auth-logo" src="/logo.svg" onerror="this.onerror=null;this.src='/logo.png';" alt="ApexFlow logo" />
        <span>
          <strong>ApexFlow Billing</strong>
          <small>Modern billing & invoicing workspace</small>
        </span>
      </div>

      <div class="auth-demo-banner">
        <div class="auth-demo-badge"><span>✦</span> <strong>DEMO ACCESS</strong></div>
        <p class="auth-demo-text">
          For demo please connect to <strong>SMA Digital Hub</strong> <a href="tel:+919342312115" class="auth-demo-link">+91 93423 12115</a> or visit us <a href="https://www.smadigital.in" target="_blank" rel="noopener noreferrer" class="auth-demo-link">www.smadigital.in</a>
        </p>
      </div>

      <p class="eyebrow">WORKSPACE SIGN IN</p>
      <h1>Welcome back</h1>
      <p class="auth-description">Sign in to your account to manage invoices, quotes, and billing.</p>
      ${alert}
      <form id="login-form" class="auth-form">
        <div class="field">
          <label for="username">User name</label>
          <select id="username" name="username" autocomplete="username" required disabled>
            <option value="">Loading accounts…</option>
          </select>
          <small id="login-users-error" class="muted-note" hidden></small>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <button class="button primary" type="submit">Sign In to Workspace</button>
      </form>
    </section>
  `;

  const usernameSelect = document.querySelector("#username");
  const passwordInput = document.querySelector("#password");

  api("/api/auth/users")
    .then((users) => {
      usernameSelect.innerHTML = `<option value="">Select a user</option>${users
        .map(
          (user) =>
            `<option value="${escapeHtml(user.username)}">${escapeHtml(user.display_name)} · ${escapeHtml(
              user.username
            )}${user.role === "admin" ? " (Admin)" : ""}</option>`
        )
        .join("")}`;
      usernameSelect.disabled = users.length === 0;

    })
    .catch((error) => {
      const errorMessage = document.querySelector("#login-users-error");
      if (errorMessage) {
        errorMessage.textContent = `Couldn't load user accounts: ${error.message}`;
        errorMessage.hidden = false;
      }
      usernameSelect.innerHTML = '<option value="">Accounts unavailable</option>';
      usernameSelect.disabled = true;
    });

  document.querySelector("#login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      if (typeof onLoginSuccess === "function") {
        onLoginSuccess(result.user);
      }
    } catch (error) {
      showAuthScreen(false, error.message, onLoginSuccess);
    }
  });
}
