const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const PDFDocument = require("pdfkit");
const { promisify } = require("node:util");
const {
  createHash,
  randomBytes,
  scrypt: scryptCallback,
  timingSafeEqual,
} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const app = express();
app.set("trust proxy", 1);
if (typeof PhusionPassenger !== "undefined") {
  PhusionPassenger.configure({ autoInstall: false });
}
const port = typeof PhusionPassenger !== "undefined"
  ? "passenger"
  : (process.env.PORT ? (isNaN(Number(process.env.PORT)) ? process.env.PORT : Number(process.env.PORT)) : 3000);
const dataDirectory = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(dataDirectory, { recursive: true });

const databasePath = process.env.DATABASE_PATH || path.join(dataDirectory, "billing.sqlite");
const db = new sqlite3.Database(databasePath);
const scrypt = promisify(scryptCallback);
const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)));
  });
const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
let transactionQueue = Promise.resolve();
const transaction = (work) => {
  const current = transactionQueue.then(async () => {
    await run("BEGIN IMMEDIATE");
    try {
      const result = await work();
      await run("COMMIT");
      return result;
    } catch (error) {
      await run("ROLLBACK");
      throw error;
    }
  });
  transactionQueue = current.catch(() => {});
  return current;
};

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      gstin TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_paise INTEGER NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS quotes (
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
    CREATE TABLE IF NOT EXISTS quote_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id),
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_paise INTEGER NOT NULL,
      tax_rate REAL NOT NULL,
      line_total_paise INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoices (
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
    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_paise INTEGER NOT NULL,
      tax_rate REAL NOT NULL,
      line_total_paise INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      amount_paise INTEGER NOT NULL,
      payment_date TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'Bank transfer',
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'sales')),
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sales_permissions (
      permission_key TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      PRIMARY KEY (user_id, permission_key)
    );
  `);
  db.run(
    `INSERT OR IGNORE INTO settings (key, value) VALUES
      ('business_name', 'SMADemo'),
      ('business_email', 'billing@smadigital.in'),
      ('business_phone', '+91 93423 12115'),
      ('business_address', 'SMA Digital Hub, Tamil Nadu, India'),
      ('business_gstin', '33ABCDE1234F1Z5'),
      ('invoice_prefix', 'INV'),
      ('payment_terms', 'Payment due within 15 days of invoice date')`
  );
  db.run(
    `INSERT OR IGNORE INTO sales_permissions (permission_key, enabled) VALUES
      ('customers_view', 1),
      ('customers_manage', 0),
      ('services_view', 1),
      ('services_manage', 0),
      ('quotes', 1),
      ('invoices', 1),
      ('invoices_send', 1),
      ('payments', 1)`
  );
});

const invoiceSchemaReady = new Promise((resolve, reject) => {
  db.all("PRAGMA table_info(invoices)", (error, columns) => {
    if (error) {
      reject(error);
      return;
    }
    const existingColumns = new Set(columns.map((column) => column.name));
    const migrations = [
      ["discount_rate", "REAL NOT NULL DEFAULT 0"],
      ["discount_paise", "INTEGER NOT NULL DEFAULT 0"],
    ].filter(([name]) => !existingColumns.has(name));
    const applyMigration = (index) => {
      if (index === migrations.length) {
        resolve();
        return;
      }
      const [name, definition] = migrations[index];
      db.run(`ALTER TABLE invoices ADD COLUMN ${name} ${definition}`, (migrationError) => {
        if (migrationError) {
          reject(migrationError);
          return;
        }
        applyMigration(index + 1);
      });
    };
    applyMigration(0);
  });
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });
const today = () => new Date().toISOString().slice(0, 10);
const toPaise = (value, label = "Amount") => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) {
    throw badRequest(`${label} must be a valid non-negative amount.`);
  }
  return Math.round(amount * 100);
};
const cleanText = (value, max = 1000) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const dateValue = (value, label, optional = false) => {
  const date = cleanText(value, 10);
  if (!date && optional) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw badRequest(`${label} must be a valid date.`);
  }
  return date;
};
const positiveId = (value, label = "ID") => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw badRequest(`${label} is invalid.`);
  return id;
};
const NO_SESSION_EXPIRY = 253402300799000;
const PASSWORD_MIN_LENGTH = 8;

function sessionTokenFromRequest(req) {
  const cookies = (req.headers.cookie || "").split(";");
  const sessionCookie = cookies.find((cookie) => {
    const trimmed = cookie.trim();
    return trimmed.startsWith("apex_session=") || trimmed.startsWith("sma_session=");
  });
  if (!sessionCookie) return "";
  const trimmed = sessionCookie.trim();
  return trimmed.startsWith("apex_session=")
    ? trimmed.slice("apex_session=".length)
    : trimmed.slice("sma_session=".length);
}

function sessionCookieOptions() {
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
}

async function makePasswordHash(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}

async function passwordMatches(password, user) {
  const actual = await scrypt(password, Buffer.from(user.password_salt, "hex"), 64);
  const expected = Buffer.from(user.password_hash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function validatePassword(password, label) {
  if (
    typeof password !== "string" ||
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > 128
  ) {
    throw badRequest(`${label} must be between ${PASSWORD_MIN_LENGTH} and 128 characters.`);
  }
  return password;
}

async function createSession(userId, res) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [
    tokenHash,
    userId,
    NO_SESSION_EXPIRY,
  ]);
  res.setHeader("Set-Cookie", `apex_session=${token}; ${sessionCookieOptions()}`);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    created_at: user.created_at,
  };
}

async function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access is required for this action." });
  }
  next();
}

const salesPermissionKeys = [
  "customers_view",
  "customers_manage",
  "services_view",
  "services_manage",
  "quotes",
  "invoices",
  "invoices_send",
  "payments",
];

async function permissionsForUser(user) {
  if (user.role === "admin") {
    return Object.fromEntries(salesPermissionKeys.map((key) => [key, true]));
  }
  const [defaults, overrides] = await Promise.all([
    all("SELECT permission_key, enabled FROM sales_permissions"),
    all("SELECT permission_key, enabled FROM user_permissions WHERE user_id = ?", [user.id]),
  ]);
  return Object.fromEntries(
    salesPermissionKeys.map((key) => {
      const override = overrides.find((row) => row.permission_key === key);
      const fallback = defaults.find((row) => row.permission_key === key);
      return [key, (override?.enabled ?? fallback?.enabled ?? 0) === 1];
    })
  );
}

function requirePermission(permissionKey) {
  return async (req, res, next) => {
    try {
      if ((await permissionsForUser(req.user))[permissionKey]) return next();
      res.status(403).json({ error: "Your account does not have access to this feature." });
    } catch (error) {
      next(error);
    }
  };
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
    throw badRequest("Add at least one line item.");
  }
  let subtotal = 0;
  let tax = 0;
  const normalized = items.map((item) => {
    const description = cleanText(item.description, 250);
    const quantity = Number(item.quantity);
    const unitPrice = toPaise(item.unit_price, "Unit price");
    const taxRate = Number(item.tax_rate);
    const serviceId = item.service_id ? positiveId(item.service_id, "Service") : null;
    if (!description) throw badRequest("Each line item needs a description.");
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) {
      throw badRequest("Quantity must be greater than zero.");
    }
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      throw badRequest("Tax rate must be between 0 and 100.");
    }
    const lineSubtotal = Math.round(quantity * unitPrice);
    const lineTax = Math.round((lineSubtotal * taxRate) / 100);
    subtotal += lineSubtotal;
    tax += lineTax;
    return {
      service_id: serviceId,
      description,
      quantity,
      unit_price_paise: unitPrice,
      tax_rate: taxRate,
      line_total_paise: lineSubtotal + lineTax,
    };
  });
  return { items: normalized, subtotal_paise: subtotal, tax_paise: tax, total_paise: subtotal + tax };
}

async function requireCustomer(id) {
  const customer = await get("SELECT id FROM customers WHERE id = ?", [id]);
  if (!customer) throw notFound("Customer not found.");
}

async function saveItems(table, parentColumn, parentId, items) {
  for (const item of items) {
    await run(
      `INSERT INTO ${table} (${parentColumn}, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        parentId,
        item.service_id,
        item.description,
        item.quantity,
        item.unit_price_paise,
        item.tax_rate,
        item.line_total_paise,
      ]
    );
  }
}

const invoiceListSql = `
  SELECT i.*, c.name AS customer_name, c.email AS customer_email,
    COALESCE((SELECT SUM(p.amount_paise) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_paise
  FROM invoices i JOIN customers c ON c.id = i.customer_id`;
const quoteListSql = `
  SELECT q.*, c.name AS customer_name, c.email AS customer_email
  FROM quotes q JOIN customers c ON c.id = q.customer_id`;

app.get("/api/auth/status", async (req, res, next) => {
  try {
    const { account_count: accountCount } = await get("SELECT COUNT(*) AS account_count FROM users");
    const token = sessionTokenFromRequest(req);
    if (token) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const user = await get(
        `SELECT u.id, u.username, u.display_name, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
        [tokenHash]
      );
      if (user) return res.json({ setup_required: false, user: publicUser(user) });
    }
    res.json({ setup_required: accountCount === 0, user: null });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/setup", async (req, res, next) => {
  try {
    const { account_count: existingAccounts } = await get("SELECT COUNT(*) AS account_count FROM users");
    if (existingAccounts !== 0) {
      throw Object.assign(new Error("Initial account setup has already been completed."), {
        status: 409,
      });
    }
    const adminPassword = validatePassword(req.body?.admin_password, "Admin password");
    const salesPassword = validatePassword(req.body?.sales_password, "Sales password");
    if (adminPassword === salesPassword) {
      throw badRequest("Use different passwords for admin and sales.");
    }
    const [adminCredentials, salesCredentials] = await Promise.all([
      makePasswordHash(adminPassword),
      makePasswordHash(salesPassword),
    ]);
    const adminId = await transaction(async () => {
      const { account_count: accountCount } = await get("SELECT COUNT(*) AS account_count FROM users");
      if (accountCount !== 0) {
        throw Object.assign(new Error("Initial account setup has already been completed."), {
          status: 409,
        });
      }
      const admin = await run(
        "INSERT INTO users (username, display_name, role, password_salt, password_hash) VALUES (?, ?, ?, ?, ?)",
        ["admin", "Admin", "admin", adminCredentials.salt, adminCredentials.hash]
      );
      await run(
        "INSERT INTO users (username, display_name, role, password_salt, password_hash) VALUES (?, ?, ?, ?, ?)",
        ["sales", "Sales", "sales", salesCredentials.salt, salesCredentials.hash]
      );
      return admin.lastID;
    });
    const user = await get("SELECT id, username, display_name, role FROM users WHERE id = ?", [
      adminId,
    ]);
    await createSession(adminId, res);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const username = cleanText(req.body?.username, 32).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const user = await get("SELECT * FROM users WHERE username = ?", [username]);
    const candidate = user || {
      password_salt: "00000000000000000000000000000000",
      password_hash: "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    };
    const valid = password.length <= 128 && (await passwordMatches(password, candidate));
    if (!user || !valid) {
      return res.status(401).json({ error: "Invalid username or password." });
    }
    const token = sessionTokenFromRequest(req);
    if (token) {
      await run("DELETE FROM sessions WHERE token_hash = ?", [
        createHash("sha256").update(token).digest("hex"),
      ]);
    }
    await createSession(user.id, res);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const token = sessionTokenFromRequest(req);
    if (token) {
      await run("DELETE FROM sessions WHERE token_hash = ?", [
        createHash("sha256").update(token).digest("hex"),
      ]);
    }
    res.setHeader("Set-Cookie", `apex_session=; ${sessionCookieOptions()}; Max-Age=0`);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});


app.get("/api/auth/users", async (req, res, next) => {
  try {
    res.json(
      await all(
        "SELECT username, display_name, role FROM users ORDER BY role, display_name COLLATE NOCASE"
      )
    );
  } catch (error) {
    next(error);
  }
});

app.use("/api", (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !req.is("application/json")) {
    return res.status(415).json({ error: "API requests must use application/json." });
  }
  const token = sessionTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: "Sign in to continue." });
  const tokenHash = createHash("sha256").update(token).digest("hex");
  get(
    `SELECT u.id, u.username, u.display_name, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    [tokenHash]
  )
    .then((user) => {
      if (!user) {
        res.setHeader("Set-Cookie", `apex_session=; ${sessionCookieOptions()}; Max-Age=0`);
        return res.status(401).json({ error: "Your session is no longer valid. Please sign in again." });
      }
      req.user = user;
      next();
    })
    .catch(next);
});

app.get("/api/access", async (req, res, next) => {
  try {
    let targetUser = req.user;
    if (req.query.user_id !== undefined) {
      const userId = positiveId(req.query.user_id, "User");
      if (req.user.role !== "admin" && userId !== req.user.id) {
        throw Object.assign(new Error("Admin access is required to manage another account."), {
          status: 403,
        });
      }
      targetUser = await get("SELECT id, role FROM users WHERE id = ?", [userId]);
      if (!targetUser) throw notFound("User not found.");
    }
    const targetPermissions = await permissionsForUser(targetUser);
    const defaultRows = await all("SELECT permission_key, enabled FROM sales_permissions");
    const defaultPermissions = Object.fromEntries(
      salesPermissionKeys.map((key) => [
        key,
        defaultRows.some((row) => row.permission_key === key && row.enabled === 1),
      ])
    );
    res.json({
      role: targetUser.role,
      user_id: targetUser.id,
      permissions: targetPermissions,
      sales_permissions: targetUser.role === "admin" ? defaultPermissions : targetPermissions,
    });
  } catch (error) {
    next(error);
  }
});
app.put("/api/access", requireAdmin, async (req, res, next) => {
  try {
    const targetUserId = req.body.user_id === undefined
      ? null
      : positiveId(req.body.user_id, "User");
    if (targetUserId !== null) {
      const targetUser = await get("SELECT id, role FROM users WHERE id = ?", [targetUserId]);
      if (!targetUser) throw notFound("User not found.");
      if (targetUser.role === "admin") throw badRequest("Admin access cannot be changed.");
    }
    const updates = [];
    for (const key of salesPermissionKeys) {
      if (req.body[key] === undefined) continue;
      if (typeof req.body[key] !== "boolean") {
        throw badRequest(`Permission "${key}" must be true or false.`);
      }
      updates.push([key, req.body[key] ? 1 : 0]);
    }
    await transaction(async () => {
      const currentPermissions = targetUserId === null
        ? Object.fromEntries(
            (await all("SELECT permission_key, enabled FROM sales_permissions"))
              .map((row) => [row.permission_key, row.enabled])
          )
        : Object.fromEntries(
            Object.entries(await permissionsForUser({ id: targetUserId, role: "sales" }))
              .map(([key, enabled]) => [key, enabled ? 1 : 0])
          );
      const finalPermissions = { ...currentPermissions, ...Object.fromEntries(updates) };
      if (
        (finalPermissions.customers_manage === 1 && finalPermissions.customers_view !== 1) ||
        (finalPermissions.services_manage === 1 && finalPermissions.services_view !== 1) ||
        ((finalPermissions.quotes === 1 || finalPermissions.invoices === 1) &&
          finalPermissions.customers_view !== 1) ||
        ((finalPermissions.invoices_send === 1 || finalPermissions.payments === 1) &&
          finalPermissions.invoices !== 1)
      ) {
        throw badRequest("Customer, invoice, and payment permissions require their related view or invoice access.");
      }
      for (const [key, enabled] of updates) {
        await run(
          targetUserId === null
            ? `INSERT INTO sales_permissions (permission_key, enabled) VALUES (?, ?)
               ON CONFLICT(permission_key) DO UPDATE SET enabled = excluded.enabled`
            : `INSERT INTO user_permissions (user_id, permission_key, enabled) VALUES (?, ?, ?)
               ON CONFLICT(user_id, permission_key) DO UPDATE SET enabled = excluded.enabled`,
          targetUserId === null ? [key, enabled] : [targetUserId, key, enabled]
        );
      }
    });
    let savedPermissions;
    if (targetUserId === null) {
      const rows = await all("SELECT permission_key, enabled FROM sales_permissions");
      savedPermissions = Object.fromEntries(
        salesPermissionKeys.map((key) => [
          key,
          rows.some((row) => row.permission_key === key && row.enabled === 1),
        ])
      );
    } else {
      savedPermissions = await permissionsForUser({ id: targetUserId, role: "sales" });
    }
    res.json({
      role: req.user.role,
      user_id: targetUserId,
      permissions: req.user.role === "admin"
        ? Object.fromEntries(salesPermissionKeys.map((key) => [key, true]))
        : savedPermissions,
      sales_permissions: savedPermissions,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/users", requireAdmin, async (req, res, next) => {
  try {
    res.json(
      await all("SELECT id, username, display_name, role, created_at FROM users ORDER BY role, display_name COLLATE NOCASE")
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/users", requireAdmin, async (req, res, next) => {
  try {
    const username = cleanText(req.body.username, 32).toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      throw badRequest("Username must be 3–32 characters and use only letters, numbers, dots, underscores, or hyphens.");
    }
    const displayName = cleanText(req.body.display_name, 80);
    if (!displayName) throw badRequest("Display name is required.");
    const password = validatePassword(req.body.password, "Password");
    if (await get("SELECT id FROM users WHERE username = ?", [username])) {
      throw Object.assign(new Error("That username is already in use."), { status: 409 });
    }
    const credentials = await makePasswordHash(password);
    const userId = await transaction(async () => {
      const result = await run(
        "INSERT INTO users (username, display_name, role, password_salt, password_hash) VALUES (?, ?, 'sales', ?, ?)",
        [username, displayName, credentials.salt, credentials.hash]
      );
      const defaults = await all("SELECT permission_key, enabled FROM sales_permissions");
      for (const key of salesPermissionKeys) {
        const setting = defaults.find((row) => row.permission_key === key);
        await run(
          "INSERT INTO user_permissions (user_id, permission_key, enabled) VALUES (?, ?, ?)",
          [result.lastID, key, setting?.enabled ?? 0]
        );
      }
      return result.lastID;
    });
    res.status(201).json(
      await get("SELECT id, username, display_name, role, created_at FROM users WHERE id = ?", [userId])
    );
  } catch (error) {
    if (
      error.code?.startsWith("SQLITE_CONSTRAINT") &&
      error.message.includes("users.username")
    ) {
      error.status = 409;
      error.message = "That username is already in use.";
    }
    next(error);
  }
});

app.put("/api/users/:id/password", requireAdmin, async (req, res, next) => {
  try {
    const userId = positiveId(req.params.id, "User");
    const password = validatePassword(req.body?.password, "Password");
    const credentials = await makePasswordHash(password);
    await transaction(async () => {
      const user = await get("SELECT role FROM users WHERE id = ?", [userId]);
      if (!user) throw notFound("User not found.");
      if (user.role !== "sales") throw badRequest("Only staff passwords can be reset here.");
      await run(
        "UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?",
        [credentials.salt, credentials.hash, userId]
      );
      await run("DELETE FROM sessions WHERE user_id = ?", [userId]);
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});


app.delete("/api/users/:id", requireAdmin, async (req, res, next) => {
  try {
    const userId = positiveId(req.params.id, "User");
    await transaction(async () => {
      const user = await get("SELECT role FROM users WHERE id = ?", [userId]);
      if (!user) throw notFound("User not found.");
      if (user.role !== "sales") throw badRequest("Administrator accounts cannot be deleted here.");
      await run("DELETE FROM sessions WHERE user_id = ?", [userId]);
      await run("DELETE FROM users WHERE id = ?", [userId]);
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});


app.get("/api/dashboard", async (req, res, next) => {
  try {
    const access = await permissionsForUser(req.user);
    const [invoices, quotes, recentPayments, allPayments] = await Promise.all([
      access.invoices ? all(`${invoiceListSql} ORDER BY i.id DESC`) : [],
      access.quotes ? all(`${quoteListSql} ORDER BY q.id DESC`) : [],
      access.payments
        ? all(
            `SELECT p.*, i.invoice_number, c.name AS customer_name
             FROM payments p JOIN invoices i ON i.id = p.invoice_id
             JOIN customers c ON c.id = i.customer_id ORDER BY p.payment_date DESC, p.id DESC LIMIT 5`
          )
        : [],
      access.payments ? all(`SELECT * FROM payments ORDER BY payment_date ASC`) : [],
    ]);
    const pending = invoices.filter((invoice) => invoice.paid_paise < invoice.total_paise);
    const todayDate = today();

    const paidInvoices = invoices.filter((i) => i.paid_paise >= i.total_paise);
    const partialInvoices = invoices.filter((i) => i.paid_paise > 0 && i.paid_paise < i.total_paise);
    const overdueInvoices = pending.filter((i) => i.due_date && i.due_date < todayDate);
    const sentInvoices = pending.filter((i) => i.paid_paise === 0 && (!i.due_date || i.due_date >= todayDate));

    const totalBilledPaise = invoices.reduce((sum, inv) => sum + inv.total_paise, 0);
    const totalCollectedPaise = allPayments.reduce((sum, p) => sum + p.amount_paise, 0);
    const totalOutstandingPaise = pending.reduce((sum, inv) => sum + (inv.total_paise - inv.paid_paise), 0);

    // Generate last 6 months trend
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const now = new Date();
    const monthlyTrends = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const key = `${yyyy}-${mm}`;
      const label = `${monthNames[d.getMonth()]} '${String(yyyy).slice(-2)}`;

      const billed = invoices
        .filter((inv) => inv.issue_date && inv.issue_date.startsWith(key))
        .reduce((sum, inv) => sum + inv.total_paise, 0);

      const collected = allPayments
        .filter((p) => p.payment_date && p.payment_date.startsWith(key))
        .reduce((sum, p) => sum + p.amount_paise, 0);

      monthlyTrends.push({
        month: key,
        label,
        billed_paise: billed,
        collected_paise: collected,
      });
    }

    res.json({
      invoice_count: invoices.length,
      quote_count: quotes.length,
      outstanding_paise: totalOutstandingPaise,
      total_billed_paise: totalBilledPaise,
      total_collected_paise: totalCollectedPaise,
      overdue_count: overdueInvoices.length,
      status_breakdown: {
        paid: {
          count: paidInvoices.length,
          total_paise: paidInvoices.reduce((s, i) => s + i.total_paise, 0),
        },
        partial: {
          count: partialInvoices.length,
          total_paise: partialInvoices.reduce((s, i) => s + i.total_paise, 0),
          balance_paise: partialInvoices.reduce((s, i) => s + (i.total_paise - i.paid_paise), 0),
        },
        sent: {
          count: sentInvoices.length,
          total_paise: sentInvoices.reduce((s, i) => s + i.total_paise, 0),
          balance_paise: sentInvoices.reduce((s, i) => s + (i.total_paise - i.paid_paise), 0),
        },
        overdue: {
          count: overdueInvoices.length,
          total_paise: overdueInvoices.reduce((s, i) => s + i.total_paise, 0),
          balance_paise: overdueInvoices.reduce((s, i) => s + (i.total_paise - i.paid_paise), 0),
        },
      },
      monthly_trends: monthlyTrends,
      recent_invoices: invoices.slice(0, 5),
      recent_payments: recentPayments,
    });
  } catch (error) {
    next(error);
  }
});

async function paymentHistoryRows(query) {
  const conditions = [];
  const parameters = [];
  const month = cleanText(query.month, 7);
  const dateFrom = cleanText(query.from, 10);
  const dateTo = cleanText(query.to, 10);
  const invoiceNumber = cleanText(query.invoice, 100);

  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw badRequest("Month must use the YYYY-MM format.");
  }
  if (dateFrom) {
    dateValue(dateFrom, "Start date");
    conditions.push("p.payment_date >= ?");
    parameters.push(dateFrom);
  }
  if (dateTo) {
    dateValue(dateTo, "End date");
    conditions.push("p.payment_date <= ?");
    parameters.push(dateTo);
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw badRequest("Start date cannot be after the end date.");
  }
  if (month) {
    const [year, monthNumber] = month.split("-").map(Number);
    const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1))
      .toISOString()
      .slice(0, 10);
    conditions.push("p.payment_date >= ? AND p.payment_date < ?");
    parameters.push(`${month}-01`, nextMonthDate);
  }
  if (invoiceNumber) {
    conditions.push("i.invoice_number LIKE ? ESCAPE '\\'");
    parameters.push(`%${invoiceNumber.replace(/[\\%_]/g, "\\$&")}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return all(
    `SELECT p.id, p.invoice_id, p.amount_paise, p.payment_date, p.method, p.reference, p.notes,
            i.invoice_number, c.name AS customer_name
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     JOIN customers c ON c.id = i.customer_id
     ${where}
     ORDER BY p.payment_date DESC, p.id DESC`,
    parameters
  );
}

app.get("/api/payments", requireAdmin, async (req, res, next) => {
  try {
    res.json(await paymentHistoryRows(req.query));
  } catch (error) {
    next(error);
  }
});

app.get("/api/payments/export", requireAdmin, async (req, res, next) => {
  try {
    const format = cleanText(req.query.format, 10);
    if (!["excel", "pdf"].includes(format)) {
      throw badRequest("Export format must be excel or pdf.");
    }
    const payments = await paymentHistoryRows(req.query);
    const filename = "payment-history";
    if (format === "excel") {
      const csvCell = (value) => {
        let text = String(value ?? "");
        if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
      };
      const rows = [
        ["Date received", "Invoice number", "Customer", "Method", "Reference", "Amount received (INR)"],
        ...payments.map((payment) => [
          payment.payment_date,
          payment.invoice_number,
          payment.customer_name,
          payment.method,
          payment.reference,
          (payment.amount_paise / 100).toFixed(2),
        ]),
      ];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
      res.send(`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`);
      return;
    }

    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const widths = [70, 100, 155, 105, 160, 130];
    const headers = ["Date received", "Invoice", "Customer", "Method", "Reference", "Amount"];
    const pageWidth = doc.page.width - 72;
    const totalWidth = widths.reduce((sum, value) => sum + value, 0);
    const columnWidths = widths.map((width) => (width / totalWidth) * pageWidth);
    const drawHeader = () => {
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#1c2434").text("Payment history", 36, 36);
      doc.font("Helvetica").fontSize(9).fillColor("#697284")
        .text(`Generated ${new Date().toISOString().slice(0, 10)} · ${payments.length} payment(s)`, 36, 60);
      let x = 36;
      const y = 82;
      headers.forEach((header, index) => {
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#596579")
          .text(header, x + 3, y + 6, { width: columnWidths[index] - 6, lineBreak: false });
        x += columnWidths[index];
      });
      doc.moveTo(36, y + 22).lineTo(doc.page.width - 36, y + 22).strokeColor("#dfe3eb").stroke();
      doc.y = y + 30;
    };
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
    doc.pipe(res);
    drawHeader();
    let totalPaise = 0;
    for (const payment of payments) {
      const cells = [
        payment.payment_date,
        payment.invoice_number,
        payment.customer_name,
        payment.method,
        payment.reference || "—",
        `INR ${(payment.amount_paise / 100).toFixed(2)}`,
      ];
      const rowHeight = Math.max(
        23,
        ...cells.map((cell, index) =>
          doc.font("Helvetica").fontSize(8).heightOfString(String(cell), {
            width: columnWidths[index] - 8,
          }) + 8
        )
      );
      if (doc.y + rowHeight > doc.page.height - 48) {
        doc.addPage();
        drawHeader();
      }
      const rowY = doc.y;
      let x = 36;
      cells.forEach((cell, index) => {
        doc.font("Helvetica").fontSize(8).fillColor("#30394a")
          .text(String(cell), x + 4, rowY + 6, { width: columnWidths[index] - 8 });
        x += columnWidths[index];
      });
      doc.moveTo(36, rowY + rowHeight).lineTo(doc.page.width - 36, rowY + rowHeight)
        .strokeColor("#eef0f4").stroke();
      doc.y = rowY + rowHeight;
      totalPaise += payment.amount_paise;
    }
    if (doc.y + 30 > doc.page.height - 36) doc.addPage();
    doc.moveDown(0.5).font("Helvetica-Bold").fontSize(10).fillColor("#1c2434")
      .text(`Total received: INR ${(totalPaise / 100).toFixed(2)}`, { align: "right" });
    doc.end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/customers", requirePermission("customers_view"), async (req, res, next) => {
  try {
    res.json(await all("SELECT * FROM customers ORDER BY name COLLATE NOCASE"));
  } catch (error) {
    next(error);
  }
});
app.post("/api/customers", requirePermission("customers_manage"), async (req, res, next) => {
  try {
    const name = cleanText(req.body.name, 160);
    if (!name) throw badRequest("Customer name is required.");
    const result = await run(
      "INSERT INTO customers (name, email, phone, address, gstin) VALUES (?, ?, ?, ?, ?)",
      [
        name,
        cleanText(req.body.email, 160),
        cleanText(req.body.phone, 60),
        cleanText(req.body.address, 1000),
        cleanText(req.body.gstin, 30).toUpperCase(),
      ]
    );
    res.status(201).json(await get("SELECT * FROM customers WHERE id = ?", [result.lastID]));
  } catch (error) {
    next(error);
  }
});
app.put("/api/customers/:id", requirePermission("customers_manage"), async (req, res, next) => {
  try {
    const id = positiveId(req.params.id);
    const name = cleanText(req.body.name, 160);
    if (!name) throw badRequest("Customer name is required.");
    const result = await run(
      "UPDATE customers SET name = ?, email = ?, phone = ?, address = ?, gstin = ? WHERE id = ?",
      [
        name,
        cleanText(req.body.email, 160),
        cleanText(req.body.phone, 60),
        cleanText(req.body.address, 1000),
        cleanText(req.body.gstin, 30).toUpperCase(),
        id,
      ]
    );
    if (!result.changes) throw notFound("Customer not found.");
    res.json(await get("SELECT * FROM customers WHERE id = ?", [id]));
  } catch (error) {
    next(error);
  }
});

app.get("/api/services", requirePermission("services_view"), async (req, res, next) => {
  try {
    res.json(await all("SELECT * FROM services ORDER BY active DESC, name COLLATE NOCASE"));
  } catch (error) {
    next(error);
  }
});
app.post("/api/services", requirePermission("services_manage"), async (req, res, next) => {
  try {
    const name = cleanText(req.body.name, 160);
    const description = cleanText(req.body.description, 500);
    const price = toPaise(req.body.price, "Price");
    const taxRate = Number(req.body.tax_rate ?? 0);
    if (!name) throw badRequest("Service name is required.");
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      throw badRequest("Tax rate must be between 0 and 100.");
    }
    const result = await run(
      "INSERT INTO services (name, description, price_paise, tax_rate) VALUES (?, ?, ?, ?)",
      [name, description, price, taxRate]
    );
    res.status(201).json(await get("SELECT * FROM services WHERE id = ?", [result.lastID]));
  } catch (error) {
    next(error);
  }
});
app.put("/api/services/:id", requirePermission("services_manage"), async (req, res, next) => {
  try {
    const id = positiveId(req.params.id);
    const name = cleanText(req.body.name, 160);
    const description = cleanText(req.body.description, 500);
    const price = toPaise(req.body.price, "Price");
    const taxRate = Number(req.body.tax_rate ?? 0);
    if (!name) throw badRequest("Service name is required.");
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      throw badRequest("Tax rate must be between 0 and 100.");
    }
    const result = await run(
      "UPDATE services SET name = ?, description = ?, price_paise = ?, tax_rate = ? WHERE id = ?",
      [name, description, price, taxRate, id]
    );
    if (!result.changes) throw notFound("Service not found.");
    res.json(await get("SELECT * FROM services WHERE id = ?", [id]));
  } catch (error) {
    next(error);
  }
});

app.get("/api/quotes", requirePermission("quotes"), async (req, res, next) => {
  try {
    res.json(await all(`${quoteListSql} ORDER BY q.id DESC`));
  } catch (error) {
    next(error);
  }
});
app.get(
  "/api/quotes/:id",
  requirePermission("quotes"),
  requirePermission("customers_view"),
  async (req, res, next) => {
    try {
      const id = positiveId(req.params.id, "Quote");
      const quote = await get(`${quoteListSql} WHERE q.id = ?`, [id]);
      if (!quote) throw notFound("Quote not found.");
      const [customer, items] = await Promise.all([
        get("SELECT * FROM customers WHERE id = ?", [quote.customer_id]),
        all("SELECT * FROM quote_items WHERE quote_id = ? ORDER BY id", [id]),
      ]);
      res.json({ ...quote, customer, items });
    } catch (error) {
      next(error);
    }
  }
);
app.post(
  "/api/quotes",
  requirePermission("quotes"),
  requirePermission("customers_view"),
  async (req, res, next) => {
  try {
    const customerId = positiveId(req.body.customer_id, "Customer");
    const issueDate = dateValue(req.body.issue_date, "Issue date");
    const validUntil = dateValue(req.body.valid_until, "Valid until", true);
    const notes = cleanText(req.body.notes, 2000);
    const totals = normalizeItems(req.body.items);
    await requireCustomer(customerId);
    const quoteId = await transaction(async () => {
      const result = await run(
        `INSERT INTO quotes (quote_number, customer_id, issue_date, valid_until, status, subtotal_paise, tax_paise, total_paise, notes)
         VALUES ('', ?, ?, ?, 'sent', ?, ?, ?, ?)`,
        [
          customerId,
          issueDate,
          validUntil,
          totals.subtotal_paise,
          totals.tax_paise,
          totals.total_paise,
          notes,
        ]
      );
      const quoteNumber = `Q-${String(result.lastID).padStart(6, "0")}`;
      await run("UPDATE quotes SET quote_number = ? WHERE id = ?", [quoteNumber, result.lastID]);
      await saveItems("quote_items", "quote_id", result.lastID, totals.items);
      return result.lastID;
    });
    res.status(201).json(await get(`${quoteListSql} WHERE q.id = ?`, [quoteId]));
  } catch (error) {
    next(error);
  }
});
app.post(
  "/api/quotes/:id/convert",
  requirePermission("quotes"),
  requirePermission("invoices"),
  async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, "Quote");
    const invoiceId = await transaction(async () => {
      const quote = await get("SELECT * FROM quotes WHERE id = ?", [id]);
      if (!quote) throw notFound("Quote not found.");
      if (quote.status === "declined") throw badRequest("A declined quote cannot be invoiced.");
      const existingInvoice = await get("SELECT id FROM invoices WHERE quote_id = ?", [id]);
      if (existingInvoice) throw badRequest("This quote has already been converted to an invoice.");
      const settings = await all("SELECT key, value FROM settings");
      const prefix = settings.find((row) => row.key === "invoice_prefix")?.value || "INV";
      const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const result = await run(
        `INSERT INTO invoices (invoice_number, customer_id, quote_id, issue_date, due_date, status, subtotal_paise, tax_paise, total_paise, notes)
         VALUES ('', ?, ?, ?, ?, 'sent', ?, ?, ?, ?)`,
        [
          quote.customer_id,
          quote.id,
          today(),
          dueDate,
          quote.subtotal_paise,
          quote.tax_paise,
          quote.total_paise,
          quote.notes,
        ]
      );
      const invoiceNumber = `${cleanText(prefix, 16) || "INV"}-${String(result.lastID).padStart(6, "0")}`;
      await run("UPDATE invoices SET invoice_number = ? WHERE id = ?", [invoiceNumber, result.lastID]);
      await run(
        `INSERT INTO invoice_items (invoice_id, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise)
         SELECT ?, service_id, description, quantity, unit_price_paise, tax_rate, line_total_paise
         FROM quote_items WHERE quote_id = ?`,
        [result.lastID, quote.id]
      );
      await run("UPDATE quotes SET status = 'accepted' WHERE id = ?", [quote.id]);
      return result.lastID;
    });
    res.status(201).json(await get(`${invoiceListSql} WHERE i.id = ?`, [invoiceId]));
  } catch (error) {
    next(error);
  }
});
app.patch("/api/quotes/:id/status", requirePermission("quotes"), async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, "Quote");
    const status = cleanText(req.body.status, 20);
    if (!["sent", "accepted", "declined"].includes(status)) {
      throw badRequest("Quote status is invalid.");
    }
    const result = await run("UPDATE quotes SET status = ? WHERE id = ?", [status, id]);
    if (!result.changes) throw notFound("Quote not found.");
    res.json(await get(`${quoteListSql} WHERE q.id = ?`, [id]));
  } catch (error) {
    next(error);
  }
});
app.delete("/api/quotes/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, "Quote");
    await transaction(async () => {
      const quote = await get("SELECT id FROM quotes WHERE id = ?", [id]);
      if (!quote) throw notFound("Quote not found.");
      const linkedInvoice = await get("SELECT invoice_number FROM invoices WHERE quote_id = ?", [id]);
      if (linkedInvoice) {
        throw Object.assign(
          new Error(`Delete linked invoice ${linkedInvoice.invoice_number} before deleting this quote.`),
          { status: 409 }
        );
      }
      await run("DELETE FROM quote_items WHERE quote_id = ?", [id]);
      await run("DELETE FROM quotes WHERE id = ?", [id]);
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/quotes/:id/pdf", requirePermission("quotes"), async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, "Quote");
    const quote = await get(`${quoteListSql} WHERE q.id = ?`, [id]);
    if (!quote) throw notFound("Quote not found.");

    const [customer, items, settingRows] = await Promise.all([
      get("SELECT * FROM customers WHERE id = ?", [quote.customer_id]),
      all("SELECT * FROM quote_items WHERE quote_id = ? ORDER BY id", [id]),
      all("SELECT key, value FROM settings"),
    ]);
    const business = Object.fromEntries(settingRows.map((row) => [row.key, row.value]));
    const filename = `${quote.quote_number.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const pageWidth = doc.page.width - 96;
    const pageBottom = doc.page.height - 52;
    const moneyText = (paise) =>
      `INR ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        (Number(paise) || 0) / 100
      )}`;
    const dateText = (value) =>
      value
        ? new Intl.DateTimeFormat("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(`${value}T00:00:00Z`))
        : "-";

    const drawWatermarkAndFooter = () => {
      doc.save();
      doc.rotate(-32, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.fillColor("#6954e8");
      doc.fillOpacity(0.09);
      doc.font("Helvetica-Bold").fontSize(36);
      doc.text("Demo Quotation/Invoices", 0, doc.page.height / 2 - 180, { align: "center", width: doc.page.width });
      doc.text("Demo Quotation/Invoices", 0, doc.page.height / 2 - 20, { align: "center", width: doc.page.width });
      doc.text("Demo Quotation/Invoices", 0, doc.page.height / 2 + 140, { align: "center", width: doc.page.width });
      doc.restore();

      const disclaimerY = doc.page.height - 40;
      doc.save();
      doc.rect(48, disclaimerY, pageWidth, 20).fillAndStroke("#fff7ed", "#fed7aa");
      doc.fillColor("#c2410c").font("Helvetica-Bold").fontSize(7.5)
        .text(
          "This is a Demo application, so shared invoices and quotations are not Valid.",
          52,
          disclaimerY + 6,
          { width: pageWidth - 8, align: "center" }
        );
      doc.restore();
    };

    const drawPageHeader = () => {
      drawWatermarkAndFooter();
      const logoPng = path.join(__dirname, "public", "logo.png");
      const logoJpg = path.join(__dirname, "public", "logo.jpg");
      const logoPath = fs.existsSync(logoPng) ? logoPng : logoJpg;
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 48, 44, { fit: [60, 48] });
      }
      doc.fillColor("#1c2434").font("Helvetica-Bold").fontSize(14)
        .text(business.business_name || "SMADemo", 116, 46, { width: 250 });
      doc.fillColor("#596579").font("Helvetica").fontSize(8)
        .text(
          [
            business.business_address,
            business.business_phone ? `Mobile/WhatsApp: ${business.business_phone}` : "",
            business.business_email,
            business.business_gstin ? `GSTIN: ${business.business_gstin}` : "",
          ].filter(Boolean).join("\n"),
          116,
          65,
          { width: 250, lineGap: 2 }
        );
      doc.fillColor("#1c2434").font("Helvetica-Bold").fontSize(19)
        .text("QUOTATION", 390, 44, { width: pageWidth - 342, align: "right" });
      doc.fillColor("#596579").font("Helvetica").fontSize(9)
        .text(quote.quote_number, 390, 68, { width: pageWidth - 342, align: "right" });
      doc.fillColor("#c2410c").font("Helvetica-Bold").fontSize(8)
        .text("Demo Quotation/Invoices", 390, 83, { width: pageWidth - 342, align: "right" });
      doc.moveTo(48, 116).lineTo(48 + pageWidth, 116).strokeColor("#dfe3ea").stroke();
      doc.y = 132;
    };

    const columns = [210, 45, 80, 45, pageWidth - 380];
    const drawTableHeader = () => {
      const y = doc.y;
      doc.rect(48, y, pageWidth, 24).fill("#f7f7f8");
      const labels = ["DESCRIPTION", "QTY", "RATE", "TAX", "TOTAL"];
      let x = 48;
      labels.forEach((label, index) => {
        doc.fillColor("#596579").font("Helvetica-Bold").fontSize(8)
          .text(label, x + 5, y + 8, { width: columns[index] - 10 });
        x += columns[index];
      });
      doc.y = y + 31;
    };

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);
    drawPageHeader();

    const billToY = doc.y;
    doc.fillColor("#596579").font("Helvetica").fontSize(9)
      .text("PREPARED FOR", 48, billToY, { continued: false });
    doc.fillColor("#1c2434").font("Helvetica-Bold").fontSize(11)
      .text(customer.name, 48, doc.y + 4, { width: 280 });
    doc.fillColor("#596579").font("Helvetica").fontSize(9)
      .text(
        [customer.email, customer.phone, customer.address, customer.gstin ? `GSTIN: ${customer.gstin}` : ""]
          .filter(Boolean).join("\n"),
        48,
        doc.y + 4,
        { width: 280, lineGap: 2 }
      );
    const customerBlockBottom = doc.y;

    doc.fillColor("#596579").font("Helvetica").fontSize(9)
      .text(`Quote date: ${dateText(quote.issue_date)}\nValid until: ${dateText(quote.valid_until)}`, 360, billToY + 4, {
        width: pageWidth - 312,
        align: "right",
        lineGap: 5,
      });
    const datesBlockBottom = doc.y;

    doc.y = Math.max(customerBlockBottom, datesBlockBottom, 205) + 16;
    drawTableHeader();

    for (const item of items) {
      const descriptionHeight = doc.font("Helvetica").fontSize(9)
        .heightOfString(item.description, { width: columns[0] - 12 });
      const rowHeight = Math.max(26, descriptionHeight + 12);
      if (doc.y + rowHeight > pageBottom) {
        doc.addPage();
        drawPageHeader();
        drawTableHeader();
      }
      const y = doc.y;
      let x = 48;
      const values = [
        item.description,
        String(item.quantity),
        moneyText(item.unit_price_paise),
        `${item.tax_rate}%`,
        moneyText(item.line_total_paise),
      ];
      values.forEach((value, index) => {
        doc.fillColor("#1c2434").font("Helvetica").fontSize(9)
          .text(value, x + 5, y, { width: columns[index] - 10, height: rowHeight });
        x += columns[index];
      });
      doc.moveTo(48, y + rowHeight + 5).lineTo(48 + pageWidth, y + rowHeight + 5)
        .strokeColor("#e8ebf0").stroke();
      doc.y = y + rowHeight + 13;
    }

    const totals = [
      ["Subtotal", moneyText(quote.subtotal_paise)],
      ["Tax", moneyText(quote.tax_paise)],
      ["Quote total", moneyText(quote.total_paise)],
    ];
    const totalsX = 330;
    for (const [label, amount] of totals) {
      const isTotal = label === "Quote total";
      const y = doc.y;
      doc.fillColor(isTotal ? "#1c2434" : "#596579")
        .font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(isTotal ? 11 : 9)
        .text(label, totalsX, y, { width: 100 });
      doc.fillColor(isTotal ? "#1c2434" : "#596579")
        .font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(isTotal ? 11 : 9)
        .text(amount, totalsX + 100, y, { width: 48 + pageWidth - totalsX - 100, align: "right" });
      doc.y = y + (isTotal ? 19 : 15);
    }
    if (quote.notes) {
      doc.moveDown();
      doc.fillColor("#596579").font("Helvetica-Bold").fontSize(9).text("NOTES", 48, doc.y);
      doc.moveDown(0.3);
      doc.fillColor("#1c2434").font("Helvetica").fontSize(9)
        .text(quote.notes, 48, doc.y, { width: pageWidth, lineGap: 3 });
    }
    doc.end();
  } catch (error) {
    next(error);
  }
});


app.get("/api/invoices", requirePermission("invoices"), async (req, res, next) => {
  try {
    res.json(await all(`${invoiceListSql} ORDER BY i.id DESC`));
  } catch (error) {
    next(error);
  }
});
app.post(
  "/api/invoices",
  requirePermission("invoices"),
  requirePermission("customers_view"),
  async (req, res, next) => {
  try {
    const customerId = positiveId(req.body.customer_id, "Customer");
    const issueDate = dateValue(req.body.issue_date, "Issue date");
    const dueDate = dateValue(req.body.due_date, "Due date", true);
    const notes = cleanText(req.body.notes, 2000);
    const totals = normalizeItems(req.body.items);
    const discountRate = req.body.discount_rate === undefined || req.body.discount_rate === ""
      ? 0
      : Number(req.body.discount_rate);
    if (!Number.isFinite(discountRate) || discountRate < 0 || discountRate > 100) {
      throw badRequest("Discount must be a percentage between 0 and 100.");
    }
    const discountPaise = Math.round(totals.subtotal_paise * discountRate / 100);
    const invoiceTotalPaise = totals.total_paise - discountPaise;
    await requireCustomer(customerId);
    const invoiceId = await transaction(async () => {
      const result = await run(
        `INSERT INTO invoices (invoice_number, customer_id, issue_date, due_date, status, subtotal_paise, tax_paise, discount_rate, discount_paise, total_paise, notes)
         VALUES ('', ?, ?, ?, 'sent', ?, ?, ?, ?, ?, ?)`,
        [
          customerId,
          issueDate,
          dueDate,
          totals.subtotal_paise,
          totals.tax_paise,
          discountRate,
          discountPaise,
          invoiceTotalPaise,
          notes,
        ]
      );
      const settings = await all("SELECT key, value FROM settings");
      const prefix = settings.find((row) => row.key === "invoice_prefix")?.value || "INV";
      const invoiceNumber = `${cleanText(prefix, 16) || "INV"}-${String(result.lastID).padStart(6, "0")}`;
      await run("UPDATE invoices SET invoice_number = ? WHERE id = ?", [invoiceNumber, result.lastID]);
      await saveItems("invoice_items", "invoice_id", result.lastID, totals.items);
      return result.lastID;
    });
    res.status(201).json(await get(`${invoiceListSql} WHERE i.id = ?`, [invoiceId]));
  } catch (error) {
    next(error);
  }
});
app.delete("/api/invoices/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, "Invoice");
    await transaction(async () => {
      const invoice = await get("SELECT id, invoice_number FROM invoices WHERE id = ?", [id]);
      if (!invoice) throw notFound("Invoice not found.");
      const paymentCount = await get(
        "SELECT COUNT(*) AS count FROM payments WHERE invoice_id = ?",
        [id]
      );
      if (paymentCount.count > 0) {
        throw Object.assign(
          new Error(`Invoice ${invoice.invoice_number} has recorded payments and cannot be deleted.`),
          { status: 409 }
        );
      }
      await run("DELETE FROM invoice_items WHERE invoice_id = ?", [id]);
      await run("DELETE FROM invoices WHERE id = ?", [id]);
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/invoices/:id", requirePermission("invoices"), async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, "Invoice");
    const invoice = await get(
      `${invoiceListSql} WHERE i.id = ?`,
      [id]
    );
    if (!invoice) throw notFound("Invoice not found.");
    const [customer, items, payments] = await Promise.all([
      get("SELECT * FROM customers WHERE id = ?", [invoice.customer_id]),
      all("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id", [id]),
      all("SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC, id DESC", [id]),
    ]);
    res.json({ ...invoice, customer, items, payments });
  } catch (error) {
    next(error);
  }
});
app.get("/api/invoices/:id/pdf", requirePermission("invoices_send"), async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, "Invoice");
    const invoice = await get(`${invoiceListSql} WHERE i.id = ?`, [id]);
    if (!invoice) throw notFound("Invoice not found.");

    const [customer, items, payments, settingRows] = await Promise.all([
      get("SELECT * FROM customers WHERE id = ?", [invoice.customer_id]),
      all("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id", [id]),
      all("SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC, id DESC", [id]),
      all("SELECT key, value FROM settings"),
    ]);
    const business = Object.fromEntries(settingRows.map((row) => [row.key, row.value]));
    const filename = `${invoice.invoice_number.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const pageWidth = doc.page.width - 96;
    const pageBottom = doc.page.height - 52;
    const moneyText = (paise) =>
      `INR ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        (Number(paise) || 0) / 100
      )}`;
    const dateText = (value) =>
      value
        ? new Intl.DateTimeFormat("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(`${value}T00:00:00Z`))
        : "-";

    const drawWatermarkAndFooter = () => {
      // 1. Diagonal Watermark: "Demo Quotation/Invoices"
      doc.save();
      doc.rotate(-32, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.fillColor("#6954e8");
      doc.fillOpacity(0.09);
      doc.font("Helvetica-Bold").fontSize(36);

      doc.text("Demo Quotation/Invoices", 0, doc.page.height / 2 - 180, {
        align: "center",
        width: doc.page.width,
      });
      doc.text("Demo Quotation/Invoices", 0, doc.page.height / 2 - 20, {
        align: "center",
        width: doc.page.width,
      });
      doc.text("Demo Quotation/Invoices", 0, doc.page.height / 2 + 140, {
        align: "center",
        width: doc.page.width,
      });
      doc.restore();

      // 2. Demo Disclaimer Banner at footer of every page
      const disclaimerY = doc.page.height - 40;
      doc.save();
      doc.rect(48, disclaimerY, pageWidth, 20).fillAndStroke("#fff7ed", "#fed7aa");
      doc.fillColor("#c2410c").font("Helvetica-Bold").fontSize(7.5)
        .text(
          "This is a Demo application, so shared invoices and quotations are not Valid.",
          52,
          disclaimerY + 6,
          { width: pageWidth - 8, align: "center" }
        );
      doc.restore();
    };

    const drawPageHeader = () => {
      drawWatermarkAndFooter();
      const logoPng = path.join(__dirname, "public", "logo.png");
      const logoJpg = path.join(__dirname, "public", "logo.jpg");
      const logoPath = fs.existsSync(logoPng) ? logoPng : logoJpg;
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 48, 44, { fit: [60, 48] });
      }
      doc.fillColor("#1c2434").font("Helvetica-Bold").fontSize(14)
        .text(business.business_name || "SMADemo", 116, 46, { width: 250 });
      doc.fillColor("#596579").font("Helvetica").fontSize(8)
        .text(
          [
            business.business_address,
            business.business_phone ? `Mobile/WhatsApp: ${business.business_phone}` : "",
            business.business_email,
            business.business_gstin ? `GSTIN: ${business.business_gstin}` : "",
          ].filter(Boolean).join("\n"),
          116,
          65,
          { width: 250, lineGap: 2 }
        );
      doc.fillColor("#1c2434").font("Helvetica-Bold").fontSize(19)
        .text("INVOICE", 390, 44, { width: pageWidth - 342, align: "right" });
      doc.fillColor("#596579").font("Helvetica").fontSize(9)
        .text(invoice.invoice_number, 390, 68, { width: pageWidth - 342, align: "right" });
      doc.fillColor("#c2410c").font("Helvetica-Bold").fontSize(8)
        .text("Demo Quotation/Invoices", 390, 83, { width: pageWidth - 342, align: "right" });
      doc.moveTo(48, 116).lineTo(48 + pageWidth, 116).strokeColor("#dfe3ea").stroke();
      doc.y = 132;
    };
    const ensureSpace = (height) => {
      if (doc.y + height > pageBottom) {
        doc.addPage();
        drawPageHeader();
      }
    };
    const columns = [210, 45, 80, 45, pageWidth - 380];
    const drawTableHeader = () => {
      const y = doc.y;
      doc.rect(48, y, pageWidth, 24).fill("#f7f7f8");
      const labels = ["DESCRIPTION", "QTY", "RATE", "TAX", "TOTAL"];
      let x = 48;
      labels.forEach((label, index) => {
        doc.fillColor("#596579").font("Helvetica-Bold").fontSize(8)
          .text(label, x + 5, y + 8, { width: columns[index] - 10 });
        x += columns[index];
      });
      doc.y = y + 31;
    };

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);
    drawPageHeader();

    const billToY = doc.y;
    doc.fillColor("#596579").font("Helvetica").fontSize(9)
      .text("BILL TO", 48, billToY, { continued: false });
    doc.fillColor("#1c2434").font("Helvetica-Bold").fontSize(11)
      .text(customer.name, 48, doc.y + 4, { width: 280 });
    doc.fillColor("#596579").font("Helvetica").fontSize(9)
      .text(
        [customer.email, customer.phone, customer.address, customer.gstin ? `GSTIN: ${customer.gstin}` : ""]
          .filter(Boolean).join("\n"),
        48,
        doc.y + 4,
        { width: 280, lineGap: 2 }
      );
    const customerBlockBottom = doc.y;

    doc.fillColor("#596579").font("Helvetica").fontSize(9)
      .text(`Issued: ${dateText(invoice.issue_date)}\nDue date: ${dateText(invoice.due_date)}`, 360, billToY + 4, {
        width: pageWidth - 312,
        align: "right",
        lineGap: 5,
      });
    const datesBlockBottom = doc.y;

    // Position table header safely below whichever column is taller, with generous breathing space
    doc.y = Math.max(customerBlockBottom, datesBlockBottom, 205) + 16;
    drawTableHeader();

    for (const item of items) {
      const descriptionHeight = doc.font("Helvetica").fontSize(9)
        .heightOfString(item.description, { width: columns[0] - 12 });
      const rowHeight = Math.max(26, descriptionHeight + 12);
      if (doc.y + rowHeight > pageBottom) {
        doc.addPage();
        drawPageHeader();
        drawTableHeader();
      }
      const y = doc.y;
      let x = 48;
      const values = [
        item.description,
        String(item.quantity),
        moneyText(item.unit_price_paise),
        `${item.tax_rate}%`,
        moneyText(item.line_total_paise),
      ];
      values.forEach((value, index) => {
        doc.fillColor("#1c2434").font("Helvetica").fontSize(9)
          .text(value, x + 5, y, { width: columns[index] - 10, height: rowHeight });
        x += columns[index];
      });
      doc.moveTo(48, y + rowHeight + 5).lineTo(48 + pageWidth, y + rowHeight + 5)
        .strokeColor("#e8ebf0").stroke();
      doc.y = y + rowHeight + 13;
    }

    ensureSpace(130);
    const paid = Number(invoice.paid_paise) || 0;
    const totals = [
      ["Subtotal", moneyText(invoice.subtotal_paise)],
      ["Tax", moneyText(invoice.tax_paise)],
      ...(invoice.discount_paise > 0
        ? [[`Discount (${invoice.discount_rate}%)`, `-${moneyText(invoice.discount_paise)}`]]
        : []),
      ["Total", moneyText(invoice.total_paise)],
      ["Paid", moneyText(paid)],
      ["Balance due", moneyText(invoice.total_paise - paid)],
    ];
    const totalsX = 330;
    for (const [label, amount] of totals) {
      const isTotal = label === "Total";
      const y = doc.y;
      doc.fillColor(isTotal ? "#1c2434" : "#596579")
        .font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(isTotal ? 11 : 9)
        .text(label, totalsX, y, { width: 100 });
      doc.fillColor(isTotal ? "#1c2434" : "#596579")
        .font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(isTotal ? 11 : 9)
        .text(amount, totalsX + 100, y, { width: 48 + pageWidth - totalsX - 100, align: "right" });
      doc.y = y + (isTotal ? 19 : 15);
    }
    if (invoice.notes) {
      ensureSpace(60);
      doc.moveDown();
      doc.fillColor("#596579").font("Helvetica-Bold").fontSize(9).text("NOTES", 48, doc.y);
      doc.moveDown(0.3);
      doc.fillColor("#1c2434").font("Helvetica").fontSize(9)
        .text(invoice.notes, 48, doc.y, { width: pageWidth, lineGap: 3 });
    }
    if (payments.length) {
      ensureSpace(60);
      doc.moveDown();
      doc.fillColor("#1c2434").font("Helvetica-Bold").fontSize(11).text("Payment history", 48, doc.y);
      doc.moveDown(0.4);
      for (const payment of payments) {
        ensureSpace(20);
        doc.fillColor("#596579").font("Helvetica").fontSize(9)
          .text(
            `${dateText(payment.payment_date)}  |  ${payment.method}  |  ${payment.reference || "-"}  |  ${moneyText(payment.amount_paise)}`,
            48,
            doc.y,
            { width: pageWidth }
          );
        doc.moveDown(0.4);
      }
    }
    doc.end();
  } catch (error) {
    next(error);
  }
});
app.post("/api/invoices/:id/payments", requirePermission("payments"), async (req, res, next) => {
  try {
    const id = positiveId(req.params.id, "Invoice");
    const amountPaise = toPaise(req.body.amount, "Payment amount");
    if (amountPaise < 1) throw badRequest("Payment amount must be greater than zero.");
    const paymentDate = dateValue(req.body.payment_date, "Payment date");
    const method = cleanText(req.body.method, 40) || "Bank transfer";
    const reference = cleanText(req.body.reference, 100);
    const notes = cleanText(req.body.notes, 500);
    await transaction(async () => {
      const invoice = await get(
        `SELECT i.total_paise, COALESCE(SUM(p.amount_paise), 0) AS paid_paise
         FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id WHERE i.id = ? GROUP BY i.id`,
        [id]
      );
      if (!invoice) throw notFound("Invoice not found.");
      if (amountPaise > invoice.total_paise - invoice.paid_paise) {
        throw badRequest("Payment cannot be greater than the remaining invoice balance.");
      }
      await run(
        "INSERT INTO payments (invoice_id, amount_paise, payment_date, method, reference, notes) VALUES (?, ?, ?, ?, ?, ?)",
        [id, amountPaise, paymentDate, method, reference, notes]
      );
    });
    res.status(201).json(await get(`${invoiceListSql} WHERE i.id = ?`, [id]));
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings", async (req, res, next) => {
  try {
    const rows = await all("SELECT key, value FROM settings");
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    res.json({
      business_name: values.business_name?.trim() || "SMADemo",
      business_email: values.business_email?.trim() || "billing@smadigital.in",
      business_phone: values.business_phone?.trim() || "+91 93423 12115",
      business_address: values.business_address?.trim()
        || "SMA Digital Hub, Tamil Nadu, India",
      business_gstin: values.business_gstin || "33ABCDE1234F1Z5",
      invoice_prefix: values.invoice_prefix?.trim() || "INV",
      payment_terms: values.payment_terms?.trim() || "Payment due within 15 days of invoice date",
    });
  } catch (error) {
    next(error);
  }
});
app.put("/api/settings", requireAdmin, async (req, res, next) => {
  try {
    const allowed = [
      "business_name",
      "business_email",
      "business_phone",
      "business_address",
      "business_gstin",
      "invoice_prefix",
      "payment_terms",
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        await run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [
          key,
          cleanText(req.body[key], key === "business_address" ? 1000 : 160),
        ]);
      }
    }
    const rows = await all("SELECT key, value FROM settings");
    res.json(Object.fromEntries(rows.map((row) => [row.key, row.value])));
  } catch (error) {
    next(error);
  }
});

app.post("/api/demo/reset", requireAdmin, async (req, res, next) => {
  try {
    const { seedDatabase } = require("./seed-demo");
    await seedDatabase(databasePath);
    res.json({ ok: true, message: "Demo data has been reset successfully." });
  } catch (error) {
    next(error);
  }
});

app.use("/api", (req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error(error);
  res.status(error.status || 500).json({
    error: error.status ? error.message : "Something went wrong. Check the server logs.",
  });
});

invoiceSchemaReady
  .then(() => {
    app.listen(port, () => {
      console.log(`SMADemo Billing is running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Could not initialize the invoice database schema.", error);
    db.close(() => {
      process.exitCode = 1;
    });
  });
