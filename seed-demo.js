const sqlite3 = require("sqlite3").verbose();
const { promisify } = require("node:util");
const { randomBytes, scrypt: scryptCallback } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");

const scrypt = promisify(scryptCallback);

async function makePasswordHash(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}

async function seedDatabase(dbPath) {
  const resolvedPath = dbPath || path.join(__dirname, "data", "billing.sqlite");
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const db = new sqlite3.Database(resolvedPath);
  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function (error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });

  console.log("Resetting database at:", resolvedPath);

  // Enable foreign keys
  await run("PRAGMA foreign_keys = OFF");

  // Drop existing tables cleanly
  const tables = [
    "sessions",
    "payments",
    "invoice_items",
    "invoices",
    "quote_items",
    "quotes",
    "services",
    "customers",
    "user_permissions",
    "sales_permissions",
    "users",
    "settings",
  ];

  for (const tbl of tables) {
    await run(`DROP TABLE IF EXISTS ${tbl}`);
  }

  await run("PRAGMA foreign_keys = ON");

  // Create tables
  await run(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      gstin TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_paise INTEGER NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);

  await run(`
    CREATE TABLE quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      issue_date TEXT NOT NULL,
      valid_until TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'sent',
      subtotal_paise INTEGER NOT NULL,
      tax_paise INTEGER NOT NULL,
      total_paise INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE quote_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id),
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_paise INTEGER NOT NULL,
      tax_rate REAL NOT NULL,
      line_total_paise INTEGER NOT NULL
    );
  `);

  await run(`
    CREATE TABLE invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      quote_id INTEGER REFERENCES quotes(id),
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'sent',
      subtotal_paise INTEGER NOT NULL,
      tax_paise INTEGER NOT NULL,
      discount_rate REAL NOT NULL DEFAULT 0,
      discount_paise INTEGER NOT NULL DEFAULT 0,
      total_paise INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_paise INTEGER NOT NULL,
      tax_rate REAL NOT NULL,
      line_total_paise INTEGER NOT NULL
    );
  `);

  await run(`
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      amount_paise INTEGER NOT NULL,
      payment_date TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'Bank transfer',
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  `);

  await run(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'sales')),
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE sales_permissions (
      permission_key TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
    );
  `);

  await run(`
    CREATE TABLE user_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      PRIMARY KEY (user_id, permission_key)
    );
  `);

  // 1. Seed Business Settings
  const defaultSettings = [
    ["business_name", "ApexFlow Technologies"],
    ["business_email", "billing@apexflow.demo"],
    ["business_phone", "+1 (555) 234-5678"],
    ["business_address", "Suite 400, Apex Tech Park, 100 Innovation Boulevard, Cyber City"],
    ["business_gstin", "29ABCDE1234F1Z5"],
    ["invoice_prefix", "INV"],
    ["payment_terms", "Payment due within 15 days of invoice date"],
  ];
  for (const [k, v] of defaultSettings) {
    await run("INSERT INTO settings (key, value) VALUES (?, ?)", [k, v]);
  }

  // 2. Seed Default Permissions
  const permissions = [
    ["customers_view", 1],
    ["customers_manage", 1],
    ["services_view", 1],
    ["services_manage", 0],
    ["quotes", 1],
    ["invoices", 1],
    ["invoices_send", 1],
    ["payments", 1],
  ];
  for (const [perm, enabled] of permissions) {
    await run("INSERT INTO sales_permissions (permission_key, enabled) VALUES (?, ?)", [perm, enabled]);
  }

  // 3. Seed Users
  // Admin: admin / admin123
  // Sales: sales / sales123
  const adminCreds = await makePasswordHash("admin123");
  const salesCreds = await makePasswordHash("sales123");

  const adminResult = await run(
    "INSERT INTO users (username, display_name, role, password_salt, password_hash) VALUES (?, ?, ?, ?, ?)",
    ["admin", "Admin User", "admin", adminCreds.salt, adminCreds.hash]
  );
  const salesResult = await run(
    "INSERT INTO users (username, display_name, role, password_salt, password_hash) VALUES (?, ?, ?, ?, ?)",
    ["sales", "Sales User", "sales", salesCreds.salt, salesCreds.hash]
  );

  // Set user permissions for sales user
  for (const [perm, enabled] of permissions) {
    await run("INSERT INTO user_permissions (user_id, permission_key, enabled) VALUES (?, ?, ?)", [
      salesResult.lastID,
      perm,
      enabled,
    ]);
  }

  // 4. Seed Services
  const demoServices = [
    {
      name: "Enterprise Web Application",
      description: "Full-stack cloud-native web application with React frontend, Node.js API, responsive UI/UX, database architecture, and automated CI/CD deployment.",
      price_paise: 12500000, // ₹1,25,000
      tax_rate: 18.0,
      active: 1,
    },
    {
      name: "Cloud Infrastructure & DevOps Setup",
      description: "Configuration of production cloud infrastructure on GCP/AWS, Docker containerization, Kubernetes cluster setup, and monitoring alerts.",
      price_paise: 4500000, // ₹45,000
      tax_rate: 18.0,
      active: 1,
    },
    {
      name: "UI/UX Design System & Prototyping",
      description: "Comprehensive design system kit, interactive high-fidelity Figma prototypes, accessibility review, and design handoff specifications.",
      price_paise: 3500000, // ₹35,000
      tax_rate: 18.0,
      active: 1,
    },
    {
      name: "Mobile Application Development",
      description: "Cross-platform mobile app development (iOS & Android) with push notifications, offline data sync, secure biometrics, and app store deployment.",
      price_paise: 9500000, // ₹95,000
      tax_rate: 18.0,
      active: 1,
    },
    {
      name: "Technical SEO & Speed Optimization",
      description: "Comprehensive Core Web Vitals audit, speed optimization, structured data schema, crawl budget optimization, and search rankings report.",
      price_paise: 1800000, // ₹18,000
      tax_rate: 18.0,
      active: 1,
    },
    {
      name: "Monthly Managed Maintenance Retainer",
      description: "Monthly technical maintenance retainer including security patches, database backups, uptime monitoring (99.9%), and 20 hours of feature enhancements.",
      price_paise: 2500000, // ₹25,000
      tax_rate: 18.0,
      active: 1,
    },
    {
      name: "Payment Gateway & API Integration",
      description: "Integration of Stripe, Razorpay, or PayPal payment gateways with webhook listeners, refund automation, and fraud detection compliance.",
      price_paise: 2200000, // ₹22,000
      tax_rate: 18.0,
      active: 1,
    },
  ];

  for (const s of demoServices) {
    await run(
      "INSERT INTO services (name, description, price_paise, tax_rate, active) VALUES (?, ?, ?, ?, ?)",
      [s.name, s.description, s.price_paise, s.tax_rate, s.active]
    );
  }

  // 5. Seed Customers
  const demoCustomers = [
    {
      name: "Acme Global Technologies",
      email: "accounts@acmeglobal.demo",
      phone: "+1 (555) 789-0123",
      address: "742 Evergreen Terrace, Tech Park Sector 4, Silicon Bay, CA 94025",
      gstin: "27AAACA1234A1Z5",
    },
    {
      name: "Stellar Media Works",
      email: "finance@stellarmedia.demo",
      phone: "+1 (555) 456-7890",
      address: "Floor 12, Skyline Media Center, Broadway District, NY 10001",
      gstin: "36BBBPS5678B1Z2",
    },
    {
      name: "Horizon Healthcare Solutions",
      email: "billing@horizonhealth.demo",
      phone: "+1 (555) 321-6540",
      address: "Building B, Medical Arts Center, West Lake Avenue, Chicago, IL 60601",
      gstin: "29AAACH9876C1Z4",
    },
    {
      name: "Vanguard Logistics Ltd",
      email: "invoices@vanguardlogistics.demo",
      phone: "+1 (555) 654-9870",
      address: "Terminal 5, Port Logistics Zone, Harbor Road, Seattle, WA 98101",
      gstin: "33AAACV4321D1Z8",
    },
    {
      name: "Nexus Retail Dynamics",
      email: "admin@nexusretail.demo",
      phone: "+1 (555) 987-1234",
      address: "Commerce Hub Plaza, 500 Market Square, Austin, TX 78701",
      gstin: "07AAACN8765E1Z9",
    },
  ];

  for (const c of demoCustomers) {
    await run(
      "INSERT INTO customers (name, email, phone, address, gstin) VALUES (?, ?, ?, ?, ?)",
      [c.name, c.email, c.phone, c.address, c.gstin]
    );
  }

  // 6. Seed Quotes
  // Quote 1: Accepted
  const q1 = await run(
    `INSERT INTO quotes (quote_number, customer_id, issue_date, valid_until, status, subtotal_paise, tax_paise, total_paise, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "Q-000001",
      1, // Acme Global
      "2026-11-01",
      "2026-12-01",
      "accepted",
      17000000, // ₹1,70,000
      3060000,  // ₹30,600 (18%)
      20060000, // ₹2,00,600
      "Proposed Q4 technical infrastructure upgrade and web portal redesign.",
    ]
  );
  await run(
    `INSERT INTO quote_items (quote_id, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [q1.lastID, 1, "Enterprise Web Application", 1, 12500000, 18, 14750000]
  );
  await run(
    `INSERT INTO quote_items (quote_id, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [q1.lastID, 2, "Cloud Infrastructure & DevOps Setup", 1, 4500000, 18, 5310000]
  );

  // Quote 2: Sent
  const q2 = await run(
    `INSERT INTO quotes (quote_number, customer_id, issue_date, valid_until, status, subtotal_paise, tax_paise, total_paise, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "Q-000002",
      3, // Horizon Healthcare
      "2026-11-08",
      "2026-11-30",
      "sent",
      13000000, // ₹1,30,000
      2340000,  // ₹23,400
      15340000, // ₹1,53,400
      "Estimate for healthcare patient portal mobile app and interactive prototyping.",
    ]
  );
  await run(
    `INSERT INTO quote_items (quote_id, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [q2.lastID, 4, "Mobile Application Development", 1, 9500000, 18, 11210000]
  );
  await run(
    `INSERT INTO quote_items (quote_id, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [q2.lastID, 3, "UI/UX Design System & Prototyping", 1, 3500000, 18, 4130000]
  );

  // Quote 3: Sent
  const q3 = await run(
    `INSERT INTO quotes (quote_number, customer_id, issue_date, valid_until, status, subtotal_paise, tax_paise, total_paise, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "Q-000003",
      5, // Nexus Retail
      "2026-11-10",
      "2026-12-10",
      "sent",
      4000000, // ₹40,000
      720000,  // ₹7,200
      4720000, // ₹47,200
      "E-commerce speed optimization and checkout payment integration.",
    ]
  );
  await run(
    `INSERT INTO quote_items (quote_id, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [q3.lastID, 5, "Technical SEO & Speed Optimization", 1, 1800000, 18, 2124000]
  );
  await run(
    `INSERT INTO quote_items (quote_id, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [q3.lastID, 7, "Payment Gateway & API Integration", 1, 2200000, 18, 2596000]
  );

  // 7. Seed Invoices
  // Invoice 1: INV-000001 (Paid with discount)
  // Subtotal: 125,000, Tax: 22,500, Discount 5%: -6,250 => Total: 141,250
  const inv1 = await run(
    `INSERT INTO invoices (invoice_number, customer_id, quote_id, issue_date, due_date, status, subtotal_paise, tax_paise, discount_rate, discount_paise, total_paise, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "INV-000001",
      1, // Acme Global
      null,
      "2026-10-15",
      "2026-10-30",
      "sent",
      12500000,
      2250000,
      5.0,
      625000,
      14125000,
      "Milestone 1: Web application core architecture and database setup.",
    ]
  );
  await run(
    `INSERT INTO invoice_items (invoice_id, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [inv1.lastID, 1, "Enterprise Web Application", 1, 12500000, 18, 14750000]
  );
  // Full payment recorded for INV-000001
  await run(
    `INSERT INTO payments (invoice_id, amount_paise, payment_date, method, reference, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [inv1.lastID, 14125000, "2026-10-25", "Bank transfer", "TXN-88492019", "Full payment received via NEFT/Wire."]
  );

  // Invoice 2: INV-000002 (Partially Paid)
  // Total: 62,540, Paid: 30,000, Balance due: 32,540
  const inv2 = await run(
    `INSERT INTO invoices (invoice_number, customer_id, quote_id, issue_date, due_date, status, subtotal_paise, tax_paise, discount_rate, discount_paise, total_paise, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "INV-000002",
      2, // Stellar Media
      null,
      "2026-10-28",
      "2026-11-20",
      "sent",
      5300000,
      954000,
      0,
      0,
      6254000,
      "Brand identity system and interactive high-fidelity prototype handoff.",
    ]
  );
  await run(
    `INSERT INTO invoice_items (invoice_id, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [inv2.lastID, 3, "UI/UX Design System & Prototyping", 1, 3500000, 18, 4130000]
  );
  await run(
    `INSERT INTO invoice_items (invoice_id, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [inv2.lastID, 5, "Technical SEO & Speed Optimization", 1, 1800000, 18, 2124000]
  );
  // Partial payment of ₹30,000
  await run(
    `INSERT INTO payments (invoice_id, amount_paise, payment_date, method, reference, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [inv2.lastID, 3000000, "2026-11-05", "UPI", "UPI/2026/894021", "First installment received."]
  );

  // Invoice 3: INV-000003 (Sent / Pending)
  const inv3 = await run(
    `INSERT INTO invoices (invoice_number, customer_id, quote_id, issue_date, due_date, status, subtotal_paise, tax_paise, discount_rate, discount_paise, total_paise, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "INV-000003",
      3, // Horizon Healthcare
      null,
      "2026-11-05",
      "2026-11-20",
      "sent",
      2500000,
      450000,
      0,
      0,
      2950000,
      "Monthly managed maintenance and 24/7 technical monitoring retainer.",
    ]
  );
  await run(
    `INSERT INTO invoice_items (invoice_id, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [inv3.lastID, 6, "Monthly Managed Maintenance Retainer", 1, 2500000, 18, 2950000]
  );

  // Invoice 4: INV-000004 (Overdue!)
  const inv4 = await run(
    `INSERT INTO invoices (invoice_number, customer_id, quote_id, issue_date, due_date, status, subtotal_paise, tax_paise, discount_rate, discount_paise, total_paise, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "INV-000004",
      4, // Vanguard Logistics
      null,
      "2026-10-01",
      "2026-10-20", // Past due date!
      "sent",
      4500000,
      810000,
      0,
      0,
      5310000,
      "DevOps automated CI/CD pipeline and multi-region cloud cluster setup.",
    ]
  );
  await run(
    `INSERT INTO invoice_items (invoice_id, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [inv4.lastID, 2, "Cloud Infrastructure & DevOps Setup", 1, 4500000, 18, 5310000]
  );

  // Invoice 5: INV-000005 (Sent with 10% promotional discount)
  const inv5 = await run(
    `INSERT INTO invoices (invoice_number, customer_id, quote_id, issue_date, due_date, status, subtotal_paise, tax_paise, discount_rate, discount_paise, total_paise, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "INV-000005",
      5, // Nexus Retail
      null,
      "2026-11-10",
      "2026-11-25",
      "sent",
      2200000,
      396000,
      10.0,
      220000,
      2376000,
      "Payment gateway integration with special Q4 early adopter promo discount.",
    ]
  );
  await run(
    `INSERT INTO invoice_items (invoice_id, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [inv5.lastID, 7, "Payment Gateway & API Integration", 1, 2200000, 18, 2596000]
  );

  console.log("Demo seed successfully completed!");
  await new Promise((resolve) => db.close(resolve));
}

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Error seeding database:", err);
      process.exit(1);
    });
}

module.exports = { seedDatabase };
