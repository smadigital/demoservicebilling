/**
 * Central application state store
 */
import { api } from "./api.js";

export const state = {
  currentPage: "dashboard",
  authenticatedUser: null,
  customers: [],
  services: [],
  settings: {},
  invoiceCache: [],
  quoteCache: [],
  access: {
    customers_view: false,
    customers_manage: false,
    services_view: false,
    services_manage: false,
    quotes: false,
    invoices: false,
    invoices_send: false,
    payments: false,
  },
  salesAccess: {},
};

export async function refreshCommon() {
  const accessData = await api("/api/access");
  state.access = accessData.permissions || {};
  state.salesAccess = accessData.sales_permissions || {};

  const [customerRows, serviceRows, businessSettings] = await Promise.all([
    state.access.customers_view ? api("/api/customers") : [],
    state.access.services_view ? api("/api/services") : [],
    api("/api/settings"),
  ]);

  state.customers = customerRows;
  state.services = serviceRows;
  state.settings = businessSettings;

  // Sync access-restricted elements in navigation and DOM
  document.querySelectorAll("[data-access]").forEach((element) => {
    element.hidden = !state.access[element.dataset.access];
  });
}

export function resetState() {
  state.authenticatedUser = null;
  state.customers = [];
  state.services = [];
  state.settings = {};
  state.invoiceCache = [];
  state.quoteCache = [];
  state.access = {
    customers_view: false,
    customers_manage: false,
    services_view: false,
    services_manage: false,
    quotes: false,
    invoices: false,
    invoices_send: false,
    payments: false,
  };
  state.salesAccess = { ...state.access };
}
