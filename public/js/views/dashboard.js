/**
 * Dashboard / Business Intelligence view
 * Interactive charts, revenue analytics & receivables tracking
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
} from "../utils.js";
import { invoiceTable } from "./invoices.js";

export async function renderDashboard() {
  setPageTitle("Dashboard");
  const content = document.querySelector("#page-content");
  if (!content) return;

  const data = await api("/api/dashboard");
  state.invoiceCache = data.recent_invoices;
  const collected = (data.recent_payments || []).reduce(
    (sum, payment) => sum + payment.amount_paise,
    0
  );

  const businessShortName = escapeHtml(
    (state.settings.business_name || "ApexFlow").split(" ")[0]
  );

  const newInvoiceBtn =
    state.access.invoices && state.access.customers_view
      ? `<button class="button primary" data-action="new-invoice">＋ Create invoice</button>`
      : "";

  const totalBilled = data.total_billed_paise || 0;
  const totalCollected = data.total_collected_paise || 0;
  const collectionRate =
    totalBilled > 0
      ? `${Math.min(100, (totalCollected / totalBilled) * 100).toFixed(1)}%`
      : "0.0%";

  const sb = data.status_breakdown || {
    paid: { count: 0, total_paise: 0 },
    partial: { count: 0, total_paise: 0, balance_paise: 0 },
    sent: { count: 0, total_paise: 0, balance_paise: 0 },
    overdue: { count: 0, total_paise: 0, balance_paise: 0 },
  };

  content.innerHTML = `
    <!-- Executive Hero Card -->
    <div class="dashboard-hero-card">
      <div class="hero-left">
        <div class="hero-badge-row">
          <span class="hero-eyebrow">✦ EXECUTIVE INTELLIGENCE</span>
          <span class="hero-status-pill"><span class="pulse-dot-green"></span> Live Metrics</span>
        </div>
        <h1>Good day, ${businessShortName}</h1>
        <p class="hero-subtitle">Real-time visibility into revenue, cash flow trends, and invoice receivables.</p>
      </div>
      <div class="hero-actions">
        ${
          state.access.quotes
            ? `<button type="button" class="button secondary hero-btn" data-action="new-quote"><span>▧</span> Prepare Quote</button>`
            : ""
        }
        ${
          state.access.invoices && state.access.customers_view
            ? `<button type="button" class="button primary hero-btn" data-action="new-invoice"><span>＋</span> Create Invoice</button>`
            : ""
        }
      </div>
    </div>

    <!-- KPI Metric Cards -->
    <div class="stats-grid">
      <article class="stat-card">
        <div class="stat-top">
          <span>Outstanding</span>
          <span class="stat-icon">₹</span>
        </div>
        <p class="stat-value">${state.access.invoices ? money(data.outstanding_paise) : "Restricted"}</p>
        <p class="stat-caption">${state.access.invoices ? "Balance due across open invoices" : "Access restricted by administrator"}</p>
      </article>

      <article class="stat-card">
        <div class="stat-top">
          <span>Invoices created</span>
          <span class="stat-icon">▤</span>
        </div>
        <p class="stat-value">${state.access.invoices ? data.invoice_count : "Restricted"}</p>
        <p class="stat-caption">${state.access.invoices ? "Total lifetime invoices" : "Access restricted by administrator"}</p>
      </article>

      <article class="stat-card">
        <div class="stat-top">
          <span>Quotes prepared</span>
          <span class="stat-icon">▧</span>
        </div>
        <p class="stat-value">${state.access.quotes ? data.quote_count : "Restricted"}</p>
        <p class="stat-caption">${state.access.quotes ? "Total lifetime estimates" : "Access restricted by administrator"}</p>
      </article>

      <article class="stat-card ${data.overdue_count > 0 ? "stat-card-alert" : ""}">
        <div class="stat-top">
          <span>Overdue invoices</span>
          <span class="stat-icon ${data.overdue_count > 0 ? "icon-alert" : ""}">⌛</span>
        </div>
        <p class="stat-value ${data.overdue_count > 0 ? "text-danger" : ""}">${state.access.invoices ? data.overdue_count : "Restricted"}</p>
        <p class="stat-caption">${state.access.invoices ? "Invoices requiring payment follow-up" : "Access restricted by administrator"}</p>
      </article>
    </div>

    <!-- Interactive Charts & Analytics Grid -->
    <div class="dashboard-analytics-grid">
      <!-- Chart 1: Revenue & Cash Flow Trend -->
      <section class="panel chart-panel">
        <div class="panel-heading chart-heading">
          <div>
            <div class="chart-title-wrap">
              <h2>Revenue & Cash Flow</h2>
              <span class="chart-pill-badge badge-green">✦ Live Trend</span>
            </div>
            <p class="chart-subtitle">Monthly comparison of invoiced billing vs. collected cash flow</p>
          </div>
          <div class="segmented-control" id="trend-metric-toggle">
            <button type="button" class="seg-btn active" data-metric="all">Both</button>
            <button type="button" class="seg-btn" data-metric="billed">Billed</button>
            <button type="button" class="seg-btn" data-metric="collected">Collected</button>
          </div>
        </div>

        <!-- Quick Summary Bar -->
        <div class="chart-kpi-bar">
          <div class="chart-kpi-item">
            <span class="chart-kpi-dot dot-billed"></span>
            <div>
              <small>Total Invoiced</small>
              <strong>${money(totalBilled)}</strong>
            </div>
          </div>
          <div class="chart-kpi-item">
            <span class="chart-kpi-dot dot-collected"></span>
            <div>
              <small>Total Collected</small>
              <strong>${money(totalCollected)}</strong>
            </div>
          </div>
          <div class="chart-kpi-item">
            <span class="chart-kpi-dot dot-rate"></span>
            <div>
              <small>Collection Efficiency</small>
              <strong class="text-indigo">${collectionRate}</strong>
            </div>
          </div>
        </div>

        <div class="chart-canvas-container">
          <canvas id="revenueFlowChart" height="230"></canvas>
        </div>
      </section>

      <!-- Chart 2: Invoice Receivables Health & Portfolio Status -->
      <section class="panel chart-panel">
        <div class="panel-heading chart-heading">
          <div>
            <div class="chart-title-wrap">
              <h2>Receivables Portfolio</h2>
              <span class="chart-pill-badge badge-purple">Settlement Health</span>
            </div>
            <p class="chart-subtitle">Invoice distribution by payment & aging status</p>
          </div>
          ${state.access.invoices ? `<button class="text-link" data-goto="invoices">Manage Invoices →</button>` : ""}
        </div>

        <div class="portfolio-container">
          <div class="doughnut-canvas-wrap">
            <canvas id="invoiceStatusChart" height="195"></canvas>
            <div class="doughnut-center-pill">
              <strong>${data.invoice_count}</strong>
              <small>Invoices</small>
            </div>
          </div>

          <div class="status-legend-grid">
            <div class="status-legend-card status-paid" data-index="0">
              <div class="legend-header">
                <span class="legend-dot dot-paid"></span>
                <span class="legend-label">Fully Paid</span>
                <span class="legend-badge">${sb.paid.count} inv</span>
              </div>
              <strong class="legend-val">${money(sb.paid.total_paise)}</strong>
            </div>

            <div class="status-legend-card status-partial" data-index="1">
              <div class="legend-header">
                <span class="legend-dot dot-partial"></span>
                <span class="legend-label">Partially Paid</span>
                <span class="legend-badge">${sb.partial.count} inv</span>
              </div>
              <strong class="legend-val">${money(sb.partial.total_paise)}</strong>
            </div>

            <div class="status-legend-card status-pending" data-index="2">
              <div class="legend-header">
                <span class="legend-dot dot-pending"></span>
                <span class="legend-label">Pending / Sent</span>
                <span class="legend-badge">${sb.sent.count} inv</span>
              </div>
              <strong class="legend-val">${money(sb.sent.total_paise)}</strong>
            </div>

            <div class="status-legend-card status-overdue" data-index="3">
              <div class="legend-header">
                <span class="legend-dot dot-overdue"></span>
                <span class="legend-label">Overdue</span>
                <span class="legend-badge">${sb.overdue.count} inv</span>
              </div>
              <strong class="legend-val">${money(sb.overdue.total_paise)}</strong>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Interactive Activity Ledger Drawer -->
    <section class="panel dashboard-activity-panel">
      <div class="panel-heading activity-panel-heading">
        <div class="activity-tab-nav" role="tablist">
          <button type="button" class="activity-tab-btn active" data-tab="recent-invoices">
            <span class="tab-icon">▤</span> Recent Invoices
            <span class="tab-count-pill">${data.recent_invoices?.length || 0}</span>
          </button>
          <button type="button" class="activity-tab-btn" data-tab="recent-payments">
            <span class="tab-icon">✓</span> Recent Payments
            <span class="tab-count-pill">${data.recent_payments?.length || 0}</span>
          </button>
        </div>
        <button class="text-link" id="activity-view-all-link" data-goto="invoices">View all invoices →</button>
      </div>

      <div id="tab-content-invoices" class="tab-content-pane">
        ${
          state.access.invoices
            ? invoiceTable(data.recent_invoices, true)
            : emptyState("Invoice access is restricted", "Contact Administrator to enable Sales invoice access.")
        }
      </div>

      <div id="tab-content-payments" class="tab-content-pane" hidden>
        ${
          !state.access.payments
            ? emptyState("Payment view restricted", "Contact Administrator to enable payment access.")
            : data.recent_payments && data.recent_payments.length
            ? `<div class="activity-list">${data.recent_payments
                .map(
                  (payment) => `
                <div class="activity">
                  <span class="activity-mark">✓</span>
                  <div>
                    <strong>${escapeHtml(payment.customer_name)}</strong>
                    <small>${escapeHtml(payment.invoice_number)} · ${dateFormat(payment.payment_date)}${payment.method ? ` · ${escapeHtml(payment.method)}` : ""}</small>
                  </div>
                  <span class="activity-amount">${money(payment.amount_paise)}</span>
                </div>`
                )
                .join("")}</div>`
            : emptyState("No payments recorded yet", "Payments you record will appear here.")
        }
      </div>
    </section>
  `;

  initDashboardCharts(data);
}

function initDashboardCharts(data) {
  if (typeof window.Chart === "undefined") {
    console.warn("Chart.js not loaded");
    return;
  }

  // Destroy previous instances to avoid memory leaks or canvas reuse errors
  if (window._revenueChartInstance) {
    window._revenueChartInstance.destroy();
    window._revenueChartInstance = null;
  }
  if (window._statusChartInstance) {
    window._statusChartInstance.destroy();
    window._statusChartInstance = null;
  }

  // 1. Revenue Flow Chart (Monthly Invoiced vs Collected)
  const revenueCanvas = document.querySelector("#revenueFlowChart");
  if (revenueCanvas) {
    const ctx = revenueCanvas.getContext("2d");
    const labels = (data.monthly_trends || []).map((t) => t.label);
    const billedValues = (data.monthly_trends || []).map((t) => Math.round((t.billed_paise || 0) / 100));
    const collectedValues = (data.monthly_trends || []).map((t) => Math.round((t.collected_paise || 0) / 100));

    window._revenueChartInstance = new window.Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Invoiced (Billed)",
            data: billedValues,
            backgroundColor: "rgba(99, 102, 241, 0.8)",
            hoverBackgroundColor: "rgba(79, 70, 229, 0.95)",
            borderColor: "#6366f1",
            borderWidth: 1.5,
            borderRadius: 6,
            maxBarThickness: 34,
          },
          {
            label: "Collected (Cash in)",
            data: collectedValues,
            backgroundColor: "rgba(16, 185, 129, 0.8)",
            hoverBackgroundColor: "rgba(5, 150, 105, 0.95)",
            borderColor: "#10b981",
            borderWidth: 1.5,
            borderRadius: 6,
            maxBarThickness: 34,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 750,
          easing: "easeOutQuart",
        },
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: "#1e293b",
            titleColor: "#f8fafc",
            bodyColor: "#f1f5f9",
            padding: 10,
            cornerRadius: 8,
            boxPadding: 4,
            callbacks: {
              label: function (context) {
                const val = context.parsed.y || 0;
                return ` ${context.dataset.label}: ₹${val.toLocaleString("en-IN")}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: {
              display: false,
            },
            ticks: {
              color: "#64748b",
              font: {
                size: 11,
                weight: "500",
              },
            },
          },
          y: {
            beginAtZero: true,
            grid: {
              color: "rgba(226, 232, 240, 0.7)",
            },
            ticks: {
              color: "#64748b",
              font: {
                size: 10,
              },
              callback: function (value) {
                if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
                if (value >= 1000) return `₹${(value / 1000).toFixed(0)}k`;
                return `₹${value}`;
              },
            },
          },
        },
      },
    });
  }

  // 2. Receivables Portfolio Doughnut Chart
  const statusCanvas = document.querySelector("#invoiceStatusChart");
  if (statusCanvas) {
    const ctx = statusCanvas.getContext("2d");
    const sb = data.status_breakdown || {};
    const paidAmt = Math.round((sb.paid?.total_paise || 0) / 100);
    const partialAmt = Math.round((sb.partial?.total_paise || 0) / 100);
    const sentAmt = Math.round((sb.sent?.total_paise || 0) / 100);
    const overdueAmt = Math.round((sb.overdue?.total_paise || 0) / 100);

    const hasData = paidAmt > 0 || partialAmt > 0 || sentAmt > 0 || overdueAmt > 0;
    const chartLabels = ["Fully Paid", "Partially Paid", "Pending / Sent", "Overdue"];
    const chartData = hasData ? [paidAmt, partialAmt, sentAmt, overdueAmt] : [1];
    const chartColors = hasData
      ? ["#10b981", "#f59e0b", "#6366f1", "#f43f5e"]
      : ["#e2e8f0"];

    window._statusChartInstance = new window.Chart(ctx, {
      type: "doughnut",
      data: {
        labels: chartLabels,
        datasets: [
          {
            data: chartData,
            backgroundColor: chartColors,
            borderWidth: 3,
            borderColor: "#ffffff",
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "72%",
        animation: {
          duration: 800,
          easing: "easeOutCirc",
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: "#1e293b",
            titleColor: "#f8fafc",
            bodyColor: "#f1f5f9",
            padding: 10,
            cornerRadius: 8,
            boxPadding: 4,
            callbacks: {
              label: function (context) {
                if (!hasData) return " No invoice data recorded";
                const val = context.parsed || 0;
                const total = context.dataset.data.reduce((a, b) => a + b, 0) || 1;
                const pct = ((val / total) * 100).toFixed(1);
                return ` ${context.label}: ₹${val.toLocaleString("en-IN")} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  // Segmented control toggling datasets on Revenue Flow Chart
  document.querySelectorAll("#trend-metric-toggle .seg-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll("#trend-metric-toggle .seg-btn").forEach((b) => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      const metric = e.currentTarget.dataset.metric;
      if (!window._revenueChartInstance) return;

      if (metric === "all") {
        window._revenueChartInstance.show(0);
        window._revenueChartInstance.show(1);
      } else if (metric === "billed") {
        window._revenueChartInstance.show(0);
        window._revenueChartInstance.hide(1);
      } else if (metric === "collected") {
        window._revenueChartInstance.hide(0);
        window._revenueChartInstance.show(1);
      }
      window._revenueChartInstance.update();
    });
  });

  // Interactive Tab Switcher for Recent Activity
  document.querySelectorAll(".activity-tab-btn").forEach((tabBtn) => {
    tabBtn.addEventListener("click", (e) => {
      const targetTab = e.currentTarget.dataset.tab;
      document.querySelectorAll(".activity-tab-btn").forEach((b) => b.classList.remove("active"));
      e.currentTarget.classList.add("active");

      const invoicesPane = document.querySelector("#tab-content-invoices");
      const paymentsPane = document.querySelector("#tab-content-payments");
      const viewAllLink = document.querySelector("#activity-view-all-link");

      if (targetTab === "recent-invoices") {
        if (invoicesPane) invoicesPane.hidden = false;
        if (paymentsPane) paymentsPane.hidden = true;
        if (viewAllLink) {
          viewAllLink.textContent = "View all invoices →";
          viewAllLink.dataset.goto = "invoices";
        }
      } else {
        if (invoicesPane) invoicesPane.hidden = true;
        if (paymentsPane) paymentsPane.hidden = false;
        if (viewAllLink) {
          viewAllLink.textContent = "Payment history →";
          viewAllLink.dataset.goto = "payments";
        }
      }
    });
  });

  // Highlight doughnut segments on legend card hover
  document.querySelectorAll(".status-legend-card").forEach((card) => {
    card.addEventListener("mouseenter", () => {
      const idx = parseInt(card.dataset.index, 10);
      if (window._statusChartInstance && !isNaN(idx)) {
        window._statusChartInstance.setActiveElements([{ datasetIndex: 0, index: idx }]);
        window._statusChartInstance.update();
      }
    });
    card.addEventListener("mouseleave", () => {
      if (window._statusChartInstance) {
        window._statusChartInstance.setActiveElements([]);
        window._statusChartInstance.update();
      }
    });
  });
}
