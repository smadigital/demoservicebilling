/**
 * Application Entry Point & Router
 * Modular Billing Application
 */
import { api, setSessionExpiredHandler } from "./api.js";
import { state, refreshCommon, resetState } from "./state.js";
import { notify, pageError } from "./utils.js";
import { closeModal, getDialog } from "./components/modal.js";
import { showAuthScreen } from "./views/auth.js";
import { renderDashboard } from "./views/dashboard.js";
import {
  renderInvoices,
  openInvoice,
  openDocumentForm,
  openPaymentForm,
  shareInvoicePdf,
  deleteDocument,
} from "./views/invoices.js";
import { renderQuotes, openQuote } from "./views/quotes.js";
import { renderCustomers, openCustomerForm } from "./views/customers.js";
import { renderServices, openServiceForm } from "./views/services.js";
import { renderPaymentHistory, exportPaymentHistory } from "./views/payments.js";
import {
  renderSettings,
  openPasswordResetForm,
  openUserForm,
} from "./views/settings.js";

const appShell = document.querySelector(".app-shell");
const authScreen = document.querySelector("#auth-screen");
const content = document.querySelector("#page-content");
const dialog = getDialog();

export function enterApplication(user) {
  state.authenticatedUser = user;
  if (authScreen) authScreen.hidden = true;
  if (appShell) appShell.hidden = false;

  const profileName = document.querySelector("#profile-name");
  const profileRole = document.querySelector("#profile-role");
  const accountToggle = document.querySelector("#account-menu-toggle");

  if (profileName) profileName.textContent = user.display_name;
  if (profileRole) {
    profileRole.textContent = user.role === "admin" ? "Administrator" : "Sales Staff";
  }
  if (accountToggle) {
    accountToggle.textContent = user.display_name.charAt(0).toUpperCase();
    accountToggle.setAttribute("aria-label", `Account menu for ${user.display_name}`);
    accountToggle.setAttribute("aria-expanded", "false");
  }

  const accountMenu = document.querySelector("#account-menu");
  if (accountMenu) accountMenu.hidden = true;

  document.querySelectorAll(".admin-only").forEach((el) => {
    el.hidden = user.role !== "admin";
  });

  navigate("dashboard");
}

export async function navigate(page) {
  state.currentPage = page;
  try {
    await refreshCommon();

    if (state.authenticatedUser?.role !== "admin") {
      const requiredAccess = {
        invoices: "invoices",
        quotes: "quotes",
        customers: "customers_view",
        services: "services_view",
        payments: null,
        settings: null,
      }[page];

      if (requiredAccess === null || (requiredAccess && !state.access[requiredAccess])) {
        page = "dashboard";
        state.currentPage = page;
      }
    }

    document.querySelectorAll(".nav-item[data-page]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.page === page);
    });

    switch (page) {
      case "dashboard":
        await renderDashboard();
        break;
      case "invoices":
        await renderInvoices();
        break;
      case "quotes":
        await renderQuotes();
        break;
      case "customers":
        renderCustomers();
        break;
      case "services":
        renderServices();
        break;
      case "payments":
        await renderPaymentHistory();
        break;
      case "settings":
        await renderSettings(null, navigate);
        break;
      default:
        await renderDashboard();
    }
  } catch (error) {
    pageError(error);
  }
}

// Top Navigation Listener
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (button && (button.closest(".app-top-header") || button.closest("#navigation") || button.closest(".sidebar"))) {
    navigate(button.dataset.page);
  }
});

// Main Content Delegated Click Handlers
content?.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  // Actions
  if (button.dataset.action === "new-invoice") {
    openDocumentForm("invoice", navigate);
  }
  if (button.dataset.action === "new-quote") {
    openDocumentForm("quote", navigate);
  }
  if (button.dataset.action === "new-customer") {
    openCustomerForm(null, async () => {
      await refreshCommon();
      renderCustomers();
    });
  }
  if (button.dataset.action === "new-service") {
    openServiceForm(null, async () => {
      await refreshCommon();
      renderServices();
    });
  }
  if (button.dataset.action === "new-user") {
    openUserForm((id) => renderSettings(id, navigate));
  }

  // Record openers
  if (button.dataset.invoice) {
    openInvoice(button.dataset.invoice, navigate);
  }
  if (button.dataset.quote) {
    openQuote(button.dataset.quote);
  }

  // Edit record
  if (button.dataset.editCustomer) {
    const cust = state.customers.find((c) => c.id === Number(button.dataset.editCustomer));
    openCustomerForm(cust, async () => {
      await refreshCommon();
      renderCustomers();
    });
  }
  if (button.dataset.editService) {
    const svc = state.services.find((s) => s.id === Number(button.dataset.editService));
    openServiceForm(svc, async () => {
      await refreshCommon();
      renderServices();
    });
  }

  // Navigation jumps
  if (button.dataset.goto) {
    navigate(button.dataset.goto);
  }

  // Deletion
  if (button.dataset.deleteInvoice) {
    deleteDocument("invoice", button.dataset.deleteInvoice, button.dataset.documentNumber, () => {
      navigate(state.currentPage);
    });
  }
  if (button.dataset.deleteQuote) {
    deleteDocument("quote", button.dataset.deleteQuote, button.dataset.documentNumber, () => {
      navigate(state.currentPage);
    });
  }

  // Convert Quote
  if (button.dataset.convertQuote) {
    api(`/api/quotes/${button.dataset.convertQuote}/convert`, { method: "POST" })
      .then(() => {
        notify("Quote converted to invoice successfully.");
        navigate("invoices");
      })
      .catch((err) => notify(err.message, true));
  }

  // Payment History Controls
  if (button.dataset.clearPaymentFilters !== undefined) {
    renderPaymentHistory().catch((err) => notify(err.message, true));
  }
  if (button.dataset.paymentExport) {
    exportPaymentHistory(button.dataset.paymentExport).catch((err) => notify(err.message, true));
  }

  // User Management
  if (button.dataset.manageUser) {
    renderSettings(Number(button.dataset.manageUser), navigate).catch((err) => pageError(err));
  }
  if (button.dataset.resetUser) {
    openPasswordResetForm({
      id: Number(button.dataset.resetUser),
      display_name: button.dataset.userName,
    });
  }
  if (button.dataset.deleteUser) {
    const userId = Number(button.dataset.deleteUser);
    if (
      !window.confirm(
        `Delete team account "${button.dataset.userName}"? Active sessions for this user will be terminated.`
      )
    ) {
      return;
    }
    api(`/api/users/${userId}`, { method: "DELETE", body: "{}" })
      .then(async () => {
        notify("User account deleted.");
        await renderSettings(null, navigate);
      })
      .catch((err) => notify(err.message, true));
  }
});

// Dialog Click Delegation
dialog?.addEventListener("click", (event) => {
  if (event.target === dialog || event.target.closest("[data-close]")) {
    closeModal();
  }
  if (event.target.closest("[data-print]")) {
    window.print();
  }

  const deleteInvoiceBtn = event.target.closest("[data-delete-invoice]");
  if (deleteInvoiceBtn) {
    deleteDocument(
      "invoice",
      deleteInvoiceBtn.dataset.deleteInvoice,
      deleteInvoiceBtn.dataset.documentNumber,
      () => navigate(state.currentPage)
    );
  }

  const deleteQuoteBtn = event.target.closest("[data-delete-quote]");
  if (deleteQuoteBtn) {
    deleteDocument(
      "quote",
      deleteQuoteBtn.dataset.deleteQuote,
      deleteQuoteBtn.dataset.documentNumber,
      () => navigate(state.currentPage)
    );
  }

  const shareBtn = event.target.closest("[data-share-invoice]");
  if (shareBtn) {
    shareInvoicePdf(shareBtn);
  }

  const recordPaymentBtn = event.target.closest("[data-record-payment]");
  if (recordPaymentBtn) {
    openPaymentForm(recordPaymentBtn.dataset.recordPayment, async (invId) => {
      await navigate(state.currentPage);
      openInvoice(invId);
    });
  }
});

dialog?.addEventListener("close", () => {
  dialog.innerHTML = "";
});

// Account Menu Handling
const accountMenu = document.querySelector("#account-menu");
const accountMenuToggle = document.querySelector("#account-menu-toggle");

accountMenuToggle?.addEventListener("click", () => {
  if (!accountMenu) return;
  accountMenu.hidden = !accountMenu.hidden;
  accountMenuToggle.setAttribute("aria-expanded", String(!accountMenu.hidden));
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".account-menu") && accountMenu) {
    accountMenu.hidden = true;
    accountMenuToggle?.setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && accountMenu && !accountMenu.hidden) {
    accountMenu.hidden = true;
    accountMenuToggle?.setAttribute("aria-expanded", "false");
    accountMenuToggle?.focus();
  }
});

// Sign Out
document.querySelector("#logout-button")?.addEventListener("click", async () => {
  if (accountMenu) accountMenu.hidden = true;
  accountMenuToggle?.setAttribute("aria-expanded", "false");
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
  } catch {
    // proceed with frontend clear even if server fails
  }
  resetState();
  showAuthScreen(false, "You have been logged out.", enterApplication);
});

// Set session expired callback
setSessionExpiredHandler((msg) => {
  resetState();
  showAuthScreen(false, msg, enterApplication);
});

// Format Header Date
const todayLabel = document.querySelector("#today-label");
if (todayLabel) {
  todayLabel.textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

// Bootstrap Application
api("/api/auth/status")
  .then((status) => {
    if (status.user) {
      enterApplication(status.user);
    } else {
      showAuthScreen(status.setup_required, "", enterApplication);
    }
  })
  .catch((err) => {
    showAuthScreen(false, err.message, enterApplication);
  });
