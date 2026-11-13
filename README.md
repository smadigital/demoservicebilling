# SMADemo Billing

A modern, self-hosted multi-user billing, quotation, and payment management application designed for service businesses, agencies, and consultancies.

---

## Key Features

- **Executive Overview Dashboard**: High-level KPI metrics (Total Outstanding, Total Invoices Created, Active Quotes, Overdue Invoices) and real-time payment feed.
- **Quotations & Estimates**: Multi-line estimates with individual tax calculations, expiration dates, status tracking (`Sent`, `Accepted`, `Declined`), and **One-Click Convert to Invoice**.
- **Invoicing & Milestone Billing**: Professional invoices supporting multi-line services, custom tax rates, percentage discounts, terms, and auto-generated numbering.
- **Partial & Milestone Payments**: Record partial payments against open invoices with real-time balance tracking, payment methods (Bank Transfer, Credit Card, UPI, Cash, Cheque), and transaction references.
- **Payment History Ledger**: Comprehensive payment tracking for administrators, filterable by month, custom date range, and invoice number, with instant export to **CSV (Excel)** and **PDF**.
- **PDF Generation & WhatsApp Sharing**: Clean, server-rendered PDF documents ready to download or share directly to clients via WhatsApp or native device share sheets.
- **Customer Directory**: Centralized client database with contact information, billing addresses, and tax identifiers (GSTIN).
- **Service Catalogue**: Reusable services and products with customizable base rates and default tax percentages.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions allowing administrators to delegate quotes, invoices, payments, and client management to staff accounts.
- **Demo Mode & Seed Generator**: Pre-loaded with realistic demo customers, quotes, invoices, and payments for client presentations, plus a one-click demo data reset.

---

## Quick Start

### Requirements
- **Node.js** 18 or newer

### 1. Start the application
From the root directory:
```sh
npm start
```
Or from within the `sma-billing` folder:
```sh
npm start
```
For development with hot reload:
```sh
npm run dev
```

Then open your browser at: **<http://localhost:3000>**

---

## Demo Accounts & Credentials

The system comes pre-loaded with sample demo data. You can sign in using either of the following accounts:

| Role | Username | Password | Access Level |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin` | `admin123` | Full access (Dashboard, Invoices, Quotes, Customers, Services, Payment History, Business Settings, User Management) |
| **Sales / Staff** | `sales` | `sales123` | Operational access (Dashboard, Invoices, Quotes, Customers, Services, Payment Recording) |

> **Tip for Client Demos**: The sign-in screen includes quick **1-Click Demo Login** buttons for both Admin and Sales roles so you can switch personas effortlessly.

---

## Resetting Demo Data

To reset all data back to the clean demo state at any time:
```sh
npm run seed
```
You can also reset demo data directly from **Business Settings** in the application interface when logged in as Admin.

---

## Project Structure

```
Billing Software/
├── package.json
└── sma-billing/
    ├── server.js            # Express API server, SQLite database, and PDFKit rendering
    ├── seed-demo.js         # Automated demo data generator and reset script
    ├── data/
    │   └── billing.sqlite   # SQLite database file
    └── public/
        ├── index.html       # Clean HTML5 application shell
        ├── styles.css       # Responsive design styles and print media rules
        ├── logo.svg         # Modern vector brand logo
        ├── logo.png         # High-resolution raster logo for PDFKit
        └── js/
            ├── app.js       # App initialization, routing, and event delegation
            ├── api.js       # Centralized API fetch wrapper and session handler
            ├── state.js     # Shared reactive state and permissions
            ├── utils.js     # Currency, date, and UI notification utilities
            ├── components/
            │   ├── modal.js # Modal dialog component
            │   └── brand.js # Document branding and header helpers
            └── views/
                ├── auth.js      # Sign-in and onboarding screens with quick demo pills
                ├── dashboard.js # Executive metrics and recent activity view
                ├── invoices.js  # Invoice listing, detail view, creation, payments, and sharing
                ├── quotes.js    # Quote listing, detail view, creation, and invoice conversion
                ├── customers.js # Customer directory and management
                ├── services.js  # Service catalogue and price list
                ├── payments.js  # Payment ledger and export view
                └── settings.js  # Business settings, staff permissions, and demo reset
```

---

## Architecture & Security Notes

- **Currency Storage**: Stored as integers (paise) to eliminate floating-point precision issues.
- **Authentication**: Salted password hashing with `crypto.scrypt` and HTTP-only, SameSite session cookies.
- **Data Safety**: The SQLite database is stored locally in the `data/` folder. Back up this directory before running production workloads.
