const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { createClient } = require('@libsql/client');

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION && process.env.TURSO_DB_TOKEN
  ? crypto.createHash('sha256').update('unicampus-jwt:' + process.env.TURSO_DB_TOKEN).digest('hex')
  : 'local-dev-only-change-this-secret');
const ADMIN_COOKIE = 'admin_token';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_TTL = '8h';
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function loginRateKey(req, email) {
  return `${clientIp(req)}:${String(email || '').trim().toLowerCase()}`;
}

function checkLoginRateLimit(req, email) {
  const key = loginRateKey(req, email);
  const now = Date.now();
  const item = loginAttempts.get(key);
  if (!item || now - item.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { startedAt: now, count: 0 });
    return { allowed: true, key };
  }
  if (item.count >= MAX_LOGIN_ATTEMPTS) {
    return { allowed: false, retryAfter: Math.ceil((LOGIN_WINDOW_MS - (now - item.startedAt)) / 1000), key };
  }
  return { allowed: true, key };
}

function recordFailedLogin(key) {
  const item = loginAttempts.get(key) || { startedAt: Date.now(), count: 0 };
  item.count += 1;
  loginAttempts.set(key, item);
}

function clearLoginRateLimit(key) {
  loginAttempts.delete(key);
}

function passwordIsStrong(password) {
  return typeof password === 'string' && password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

function setAdminCookie(res, token) {
  res.clearCookie(ADMIN_COOKIE, { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'strict', path: '/' });
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'strict',
    path: '/api',
    maxAge: SESSION_TTL_MS
  });
}

function clearAdminCookie(res) {
  res.clearCookie(ADMIN_COOKIE, { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'strict', path: '/' });
  res.clearCookie(ADMIN_COOKIE, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'strict',
    path: '/api'
  });
}

// ─── TURSO DB CLIENT ────────────────────────────────────────────
const db = createClient({
  url: process.env.TURSO_DB_URL,
  authToken: process.env.TURSO_DB_TOKEN,
});

// ─── HELPER: run a single statement ────────────────────────────
async function run(sql, args = []) {
  return db.execute({ sql, args });
}

async function get(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] || null;
}

async function all(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows;
}

// ─── SCHEMA + SEED (idempotent) ─────────────────────────────────
async function initDB() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT,
      items TEXT NOT NULL,
      amount REAL NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Pending',
      discount_code TEXT,
      discount_amount REAL DEFAULT 0,
      delivery_location TEXT DEFAULT 'Main Gate',
      delivery_notes TEXT DEFAULT 'Expected delivery in 1-2 days',
      delivery_charge REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS discounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL DEFAULT 'percentage',
      value REAL NOT NULL,
      min_order REAL DEFAULT 0,
      max_uses INTEGER DEFAULT NULL,
      uses INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      starts_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT DEFAULT NULL,
      allowed_emails TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT,
      subject TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open',
      priority TEXT DEFAULT 'Normal',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      uid TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      academic_block TEXT DEFAULT 'Main Academic Block - E',
      password_hash TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      category_label TEXT,
      price REAL NOT NULL DEFAULT 0,
      original_price REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      rating REAL DEFAULT 4.8,
      reviews_count INTEGER DEFAULT 0,
      badge TEXT,
      description TEXT DEFAULT '',
      specs TEXT DEFAULT '[]',
      stock_count INTEGER DEFAULT 0,
      image TEXT,
      gallery TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      out_of_stock INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      stock INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS printing_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Notes & Assignments',
      rate REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      flat INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      icon TEXT DEFAULT '🖨️',
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS printing_orders (
      id TEXT PRIMARY KEY,
      student_name TEXT NOT NULL,
      student_uid TEXT,
      student_email TEXT NOT NULL,
      student_phone TEXT,
      service_id INTEGER,
      service_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_data TEXT NOT NULL,
      pages INTEGER NOT NULL DEFAULT 1,
      copies INTEGER NOT NULL DEFAULT 1,
      paper_size TEXT DEFAULT 'A4',
      sides TEXT DEFAULT 'Double-sided',
      binding TEXT DEFAULT 'None',
      notes TEXT DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Received',
      payment_status TEXT NOT NULL DEFAULT 'Unpaid',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const discountCols = await all(`PRAGMA table_info(discounts)`);
  if (!discountCols.some(c => c.name === 'allowed_emails')) {
    await run(`ALTER TABLE discounts ADD COLUMN allowed_emails TEXT DEFAULT '[]'`);
  }

  const productCols = await all(`PRAGMA table_info(products)`);
  if (!productCols.some(c => c.name === 'cost_price')) {
    await run(`ALTER TABLE products ADD COLUMN cost_price REAL NOT NULL DEFAULT 0`);
  }
  if (!productCols.some(c => c.name === 'out_of_stock')) {
    await run(`ALTER TABLE products ADD COLUMN out_of_stock INTEGER DEFAULT 0`);
  }
  const orderCols = await all(`PRAGMA table_info(orders)`);
  if (!orderCols.some(c => c.name === 'delivery_location')) await run(`ALTER TABLE orders ADD COLUMN delivery_location TEXT DEFAULT 'Main Gate'`);
  if (!orderCols.some(c => c.name === 'delivery_notes')) await run(`ALTER TABLE orders ADD COLUMN delivery_notes TEXT DEFAULT 'Expected delivery in 1-2 days'`);
  if (!orderCols.some(c => c.name === 'delivery_charge')) await run(`ALTER TABLE orders ADD COLUMN delivery_charge REAL DEFAULT 0`);

  const variantCols = await all(`PRAGMA table_info(product_variants)`);
  if (!variantCols.some(c => c.name === 'cost')) {
    await run(`ALTER TABLE product_variants ADD COLUMN cost REAL NOT NULL DEFAULT 0`);
  }

  const studentCols = await all(`PRAGMA table_info(students)`);
  if (!studentCols.some(c => c.name === 'password_hash')) {
    await run(`ALTER TABLE students ADD COLUMN password_hash TEXT`);
  }

  const printingServiceCols = await all(`PRAGMA table_info(printing_services)`);
  if (!printingServiceCols.some(c => c.name === 'cost')) {
    await run(`ALTER TABLE printing_services ADD COLUMN cost REAL NOT NULL DEFAULT 0`);
  }
  if (!printingServiceCols.some(c => c.name === 'category')) {
    await run(`ALTER TABLE printing_services ADD COLUMN category TEXT NOT NULL DEFAULT 'Notes & Assignments'`);
  }
  if (!printingServiceCols.some(c => c.name === 'rate')) {
    await run(`ALTER TABLE printing_services ADD COLUMN rate REAL NOT NULL DEFAULT 0`);
  }
  if (!printingServiceCols.some(c => c.name === 'flat')) {
    await run(`ALTER TABLE printing_services ADD COLUMN flat INTEGER NOT NULL DEFAULT 0`);
  }
  if (!printingServiceCols.some(c => c.name === 'active')) {
    await run(`ALTER TABLE printing_services ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
  }
  if (!printingServiceCols.some(c => c.name === 'icon')) {
    await run(`ALTER TABLE printing_services ADD COLUMN icon TEXT DEFAULT '🖨️'`);
  }
  if (!printingServiceCols.some(c => c.name === 'description')) {
    await run(`ALTER TABLE printing_services ADD COLUMN description TEXT DEFAULT ''`);
  }
  const printingOrderCols = await all(`PRAGMA table_info(printing_orders)`);
  if (!printingOrderCols.some(c => c.name === 'cost')) {
    await run(`ALTER TABLE printing_orders ADD COLUMN cost REAL NOT NULL DEFAULT 0`);
  }

  await run(`CREATE TABLE IF NOT EXISTS system_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  const launchCleanup = await get(
    'SELECT id FROM system_migrations WHERE id = ?',
    ['production-clean-start-v2']
  );

  if (!launchCleanup) {
    await run('DELETE FROM product_variants');
    await run('DELETE FROM products');
    await run('DELETE FROM discounts');
    await run('DELETE FROM orders');
    await run('DELETE FROM support_tickets');
    await run(
      `INSERT INTO system_migrations (id) VALUES (?)`,
      ['production-clean-start-v2']
    );
  }

  const finalLaunchCleanup = await get(
    'SELECT id FROM system_migrations WHERE id = ?',
    ['production-clean-start-v3']
  );

  if (!finalLaunchCleanup) {
    await run('DELETE FROM orders');
    await run('DELETE FROM support_tickets');
    await run('DELETE FROM discounts');
    await run(
      `INSERT INTO system_migrations (id) VALUES (?)`,
      ['production-clean-start-v3']
    );
  }

  const existingAdmin = await get(
    'SELECT id FROM admin_users WHERE id=1'
  );

  if (!existingAdmin) {
    const seedEmail = String(
      process.env.PRINT_ADMIN_USERNAME || process.env.ADMIN_EMAIL || ''
    ).trim().toLowerCase();

    const seedPassword = String(
      process.env.PRINT_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || ''
    );

    if (
      !seedEmail ||
      !passwordIsStrong(seedPassword)
    ) {
      throw new Error(
        'No admin exists. Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ chars, with letters and numbers) before first launch.'
      );
    }

    const hash = bcrypt.hashSync(
      seedPassword,
      12
    );

    await run(
      'INSERT INTO admin_users (email, password_hash) VALUES (?, ?)',
      [seedEmail, hash]
    );
  }

  const printingServiceCount = await get(
    'SELECT COUNT(*) AS c FROM printing_services'
  );

  if (Number(printingServiceCount?.c || 0) === 0) {
    const defaults = [
      ['Black & White Copy', 'Notes & Assignments', 2, 0, 0, '🖨️', 'Crisp black-and-white printing for notes, assignments and everyday study work.'],
      ['Color Printing', 'Notes & Assignments', 5, 0, 0, '🌈', 'High-quality colour printing for covers, diagrams, presentations and important pages.'],
      ['Project Report Printing', 'Projects & Reports', 4, 0, 0, '📑', 'Professional project and report printing with clean, presentation-ready pages.'],
      ['Study Material Printing', 'Study Material', 2, 0, 0, '📚', 'Affordable printing for notes, study material, question papers and revision sheets.'],
      ['Forms & Documents', 'Forms & Documents', 2, 0, 0, '📄', 'Fast printing for forms, certificates, applications and other documents.']
    ];

    for (const [
      name,
      category,
      rate,
      cost,
      flat,
      icon,
      description
    ] of defaults) {
      await run(
        'INSERT INTO printing_services (name, category, rate, cost, flat, active, icon, description) VALUES (?,?,?,?,?,1,?,?)',
        [name, category, rate, cost, flat, icon, description]
      );
    }
  }

  // Repair legacy printing rows that were created with the old zero-rate defaults.
  // Only known built-in services are repaired; custom services are left untouched.
  const builtInRates = [
    ['Black & White Copy', 2],
    ['Color Printing', 5],
    ['Project Report Printing', 4],
    ['Study Material Printing', 2],
    ['Forms & Documents', 2]
  ];
  for (const [name, rate] of builtInRates) {
    await run(
      `UPDATE printing_services
       SET rate=?, updated_at=datetime('now')
       WHERE LOWER(name)=LOWER(?) AND (rate IS NULL OR rate <= 0)`,
      [rate, name]
    );
  }
}

// ─── EXPRESS APP ────────────────────────────────────────────────
const app = express();

app.disable('x-powered-by');

app.use(
  express.json({
    limit: '12mb'
  })
);

app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader(
    'X-Content-Type-Options',
    'nosniff'
  );

  res.setHeader(
    'X-Frame-Options',
    'DENY'
  );

  res.setHeader(
    'Referrer-Policy',
    'no-referrer'
  );

  res.setHeader(
    'Cache-Control',
    'no-store'
  );

  if (IS_PRODUCTION) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  next();
});

// Prevent cross-site state-changing requests.
app.use((req, res, next) => {
  if (
    ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
  ) {
    return next();
  }

  if (req.path === '/api/admin/login') return next();
  if (req.path === '/api/students/login') return next();
  if (req.path === '/api/students/register') return next();
  if (req.path === '/api/students/logout') return next();

  const origin = req.headers.origin;

  if (origin) {
    const forwardedProto = String(
      req.headers['x-forwarded-proto'] || 'https'
    ).split(',')[0].trim();

    const host = req.headers.host;

    if (
      host &&
      origin !== `${forwardedProto}://${host}`
    ) {
      return res.status(403).json({
        error: 'Cross-site request blocked'
      });
    }
  }

  next();
});

async function ensurePublicCatalogTables() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      category_label TEXT,
      price REAL NOT NULL DEFAULT 0,
      original_price REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      rating REAL DEFAULT 4.8,
      reviews_count INTEGER DEFAULT 0,
      badge TEXT,
      description TEXT DEFAULT '',
      specs TEXT DEFAULT '[]',
      stock_count INTEGER DEFAULT 0,
      image TEXT,
      gallery TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      stock INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      image TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const variantCols = await all(
    'PRAGMA table_info(product_variants)'
  );

  if (
    !variantCols.some(c => c.name === 'image')
  ) {
    await run(
      'ALTER TABLE product_variants ADD COLUMN image TEXT'
    );
  }
}

let publicCatalogReady = false;
let publicCatalogPromise = null;

async function ensurePublicCatalogReady() {
  if (publicCatalogReady) return;

  if (!publicCatalogPromise) {
    publicCatalogPromise =
      ensurePublicCatalogTables()
        .then(() => {
          publicCatalogReady = true;
        });
  }

  await publicCatalogPromise;
}

let dbReady = false;
let dbReadyPromise = null;

async function ensureDBReady() {
  if (dbReady) return;

  if (!dbReadyPromise) {
    dbReadyPromise =
      initDB()
        .then(() => {
          dbReady = true;
        })
        .catch(err => {
          dbReadyPromise = null;
          throw err;
        });
  }

  await dbReadyPromise;
}

app.use(async (req, res, next) => {
  try {
    if (
      req.path === '/api/admin/public-products' &&
      req.method === 'GET'
    ) {
      await ensurePublicCatalogReady();
      return next();
    }

    await ensureDBReady();
    next();
  } catch (err) {
    console.error(
      'Database initialization error:',
      err
    );

    res.status(503).json({
      error:
        'Database temporarily unavailable. Please try again.'
    });
  }
});

async function requireAuth(req, res, next) {
  const token =
    req.cookies?.[ADMIN_COOKIE];

  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }

  try {
    const payload =
      jwt.verify(token, JWT_SECRET);

    const admin = await get(
      'SELECT id, email, updated_at FROM admin_users WHERE id = ?',
      [payload.id]
    );

    if (
      !admin ||
      admin.email !== payload.email
    ) {
      return res.status(401).json({
        error: 'Session expired'
      });
    }

    if (
      payload.iat &&
      new Date(
        admin.updated_at + 'Z'
      ).getTime() / 1000 > payload.iat
    ) {
      return res.status(401).json({
        error: 'Session expired'
      });
    }

    req.admin = {
      id: admin.id,
      email: admin.email
    };

    next();
  } catch {
    return res.status(401).json({
      error: 'Invalid or expired session'
    });
  }
}

// AUTH
app.post(
  '/api/admin/login',
  async (req, res) => {
    const email = String(
      req.body?.email || ''
    ).trim().toLowerCase();

    const password = String(
      req.body?.password || ''
    );

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password required'
      });
    }

    const rate =
      checkLoginRateLimit(req, email);

    if (!rate.allowed) {
      res.setHeader(
        'Retry-After',
        String(rate.retryAfter)
      );

      return res.status(429).json({
        error:
          'Too many login attempts. Try again later.'
      });
    }

    const admin = await get(
      `SELECT * FROM admin_users
       WHERE LOWER(email) = ?
          OR LOWER(email) = ?
          OR LOWER(CASE WHEN instr(email,'@') > 0 THEN substr(email,1,instr(email,'@')-1) ELSE email END) = ?
       LIMIT 1`,
      [email, email, email]
    );

    const valid =
      !!admin &&
      await bcrypt.compare(
        password,
        admin.password_hash
      );

    if (!valid) {
      recordFailedLogin(rate.key);

      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    clearLoginRateLimit(rate.key);

    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email
      },
      JWT_SECRET,
      {
        expiresIn: SESSION_TTL
      }
    );

    setAdminCookie(
      res,
      token
    );

    res.json({
      success: true,
      email: admin.email
    });
  }
);

app.post(
  '/api/admin/logout',
  requireAuth,
  (req, res) => {
    clearAdminCookie(res);

    res.json({
      success: true
    });
  }
);

app.put(
  '/api/admin/profile',
  requireAuth,
  async (req, res) => {
    const {
      email,
      current_password,
      new_password
    } = req.body;

    const admin = await get(
      'SELECT * FROM admin_users WHERE id = ?',
      [req.admin.id]
    );

    if (!admin) {
      return res.status(404).json({
        error: 'Admin not found'
      });
    }

    if (
      !bcrypt.compareSync(
        current_password,
        admin.password_hash
      )
    ) {
      return res.status(401).json({
        error: 'Current password is incorrect'
      });
    }

    const updates = [];
    const params = [];

    if (
      email &&
      email !== admin.email
    ) {
      if (
        await get(
          'SELECT id FROM admin_users WHERE email = ? AND id != ?',
          [email, admin.id]
        )
      ) {
        return res.status(400).json({
          error: 'Email already in use'
        });
      }

      updates.push('email = ?');
      params.push(email);
    }

    if (new_password) {
      if (
        !passwordIsStrong(new_password)
      ) {
        return res.status(400).json({
          error:
            'New password must be at least 10 characters and contain letters and numbers'
        });
      }

      updates.push(
        'password_hash = ?'
      );

      params.push(
        bcrypt.hashSync(
          new_password,
          12
        )
      );
    }

    if (!updates.length) {
      return res.status(400).json({
        error: 'Nothing to update'
      });
    }

    updates.push(
      "updated_at = datetime('now')"
    );

    params.push(admin.id);

    await run(
      `UPDATE admin_users SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const newEmail =
      email || admin.email;

    const token = jwt.sign(
      {
        id: admin.id,
        email: newEmail
      },
      JWT_SECRET,
      {
        expiresIn: SESSION_TTL
      }
    );

    setAdminCookie(
      res,
      token
    );

    res.json({
      success: true,
      email: newEmail
    });
  }
);

app.get(
  '/api/admin/me',
  requireAuth,
  async (req, res) => {
    res.json({
      id: req.admin.id,
      email: req.admin.email
    });
  }
);

// OVERVIEW
app.get(
  '/api/admin/overview',
  requireAuth,
  async (req, res) => {
    const totalRevenue =
      (await get(
        "SELECT COALESCE(SUM(amount),0) as v FROM orders WHERE status != 'Cancelled'"
      )).v;

    const totalCost =
      (await get(
        "SELECT COALESCE(SUM(cost),0) as v FROM orders WHERE status != 'Cancelled'"
      )).v;

    const totalOrders =
      (await get(
        "SELECT COUNT(*) as v FROM orders"
      )).v;

    const ordersDone =
      (await get(
        "SELECT COUNT(*) as v FROM orders WHERE status='Completed'"
      )).v;

    const ordersPending =
      (await get(
        "SELECT COUNT(*) as v FROM orders WHERE status='Pending'"
      )).v;

    const ordersProcessing =
      (await get(
        "SELECT COUNT(*) as v FROM orders WHERE status='Processing'"
      )).v;

    const ordersCancelled =
      (await get(
        "SELECT COUNT(*) as v FROM orders WHERE status='Cancelled'"
      )).v;

    const discountsUsed =
      (await get(
        "SELECT COALESCE(SUM(discount_amount),0) as v FROM orders WHERE discount_amount > 0"
      )).v;

    const repeatedClients =
      (await get(
        "SELECT COUNT(*) as v FROM (SELECT customer_email FROM orders GROUP BY customer_email HAVING COUNT(*) > 1)"
      )).v;

    const recentOrders =
      await all(
        "SELECT id, customer_name, amount, status, created_at FROM orders ORDER BY created_at DESC LIMIT 5"
      );

    const monthlyRevenue =
      (
        await all(
          "SELECT strftime('%Y-%m', created_at) as month, COALESCE(SUM(amount),0) as revenue, COALESCE(SUM(cost),0) as cost FROM orders WHERE status != 'Cancelled' GROUP BY month ORDER BY month DESC LIMIT 6"
        )
      ).reverse();

    const dailyRevenue =
      await all(
        "SELECT strftime('%d %b', created_at) as day, COALESCE(SUM(amount),0) as revenue FROM orders WHERE status != 'Cancelled' AND created_at >= datetime('now','-30 days') GROUP BY strftime('%Y-%m-%d', created_at) ORDER BY created_at"
      );

    res.json({
      totalRevenue,
      totalCost,
      totalProfit:
        totalRevenue - totalCost,
      totalOrders,
      ordersDone,
      ordersPending,
      ordersProcessing,
      ordersCancelled,
      repeatedClients,
      discountsUsed,
      recentOrders,
      monthlyRevenue,
      dailyRevenue
    });
  }
);

// ORDERS
app.get(
  '/api/admin/orders',
  requireAuth,
  async (req, res) => {
    const {
      search,
      status,
      from,
      to,
      page = 1,
      limit = 20
    } = req.query;

    let where = '1=1';
    const params = [];

    if (search) {
      where +=
        " AND (customer_name LIKE ? OR customer_email LIKE ? OR id LIKE ?)";

      params.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`
      );
    }

    if (status) {
      where +=
        " AND status = ?";

      params.push(status);
    }

    if (from) {
      where +=
        " AND DATE(created_at) >= ?";

      params.push(from);
    }

    if (to) {
      where +=
        " AND DATE(created_at) <= ?";

      params.push(to);
    }

    const offset =
      (parseInt(page) - 1) *
      parseInt(limit);

    const total =
      Number(
        (
          await get(
            `SELECT COUNT(*) as c FROM orders WHERE ${where}`,
            params
          )
        ).c
      );

    const orders =
      await all(
        `SELECT * FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [
          ...params,
          parseInt(limit),
          offset
        ]
      );

    res.json({
      orders,
      total,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  }
);

app.get(
  '/api/admin/orders/:id',
  requireAuth,
  async (req, res) => {
    const order =
      await get(
        'SELECT * FROM orders WHERE id = ?',
        [req.params.id]
      );

    if (!order) {
      return res.status(404).json({
        error: 'Order not found'
      });
    }

    res.json(order);
  }
);

app.post(
  '/api/admin/orders',
  requireAuth,
  async (req, res) => {
    const {
      customer_name,
      customer_email,
      customer_phone,
      items,
      amount,
      cost,
      status,
      discount_code,
      discount_amount
    } = req.body;

    if (
      !customer_name ||
      !customer_email ||
      !items ||
      !amount
    ) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    const id =
      'ORD-' +
      Math.floor(
        1000 + Math.random() * 9000
      );

    await run(
      `INSERT INTO orders (id,customer_name,customer_email,customer_phone,items,amount,cost,status,discount_code,discount_amount) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        customer_name,
        customer_email,
        customer_phone || null,
        typeof items === 'string'
          ? items
          : JSON.stringify(items),
        amount,
        cost || 0,
        status || 'Pending',
        discount_code || null,
        discount_amount || 0
      ]
    );

    res.json({
      success: true,
      id
    });
  }
);

app.put(
  '/api/admin/orders/:id',
  requireAuth,
  async (req, res) => {
    const {
      status,
      customer_name,
      customer_email,
      customer_phone,
      amount,
      cost
    } = req.body;

    if (
      !await get(
        'SELECT id FROM orders WHERE id = ?',
        [req.params.id]
      )
    ) {
      return res.status(404).json({
        error: 'Order not found'
      });
    }

    const updates = [
      "updated_at = datetime('now')"
    ];

    const params = [];

    if (status) {
      updates.push(
        'status = ?'
      );
      params.push(status);
    }

    if (customer_name) {
      updates.push(
        'customer_name = ?'
      );
      params.push(customer_name);
    }

    if (customer_email) {
      updates.push(
        'customer_email = ?'
      );
      params.push(customer_email);
    }

    if (
      customer_phone !== undefined
    ) {
      updates.push(
        'customer_phone = ?'
      );
      params.push(customer_phone);
    }

    if (amount !== undefined) {
      updates.push(
        'amount = ?'
      );
      params.push(amount);
    }

    if (cost !== undefined) {
      updates.push(
        'cost = ?'
      );
      params.push(cost);
    }

    params.push(
      req.params.id
    );

    await run(
      `UPDATE orders SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    res.json({
      success: true
    });
  }
);

app.delete(
  '/api/admin/orders/:id',
  requireAuth,
  async (req, res) => {
    await run(
      'DELETE FROM orders WHERE id = ?',
      [req.params.id]
    );

    res.json({
      success: true
    });
  }
);

// REVENUE
app.get(
  '/api/admin/revenue',
  requireAuth,
  async (req, res) => {
    const {
      period = 'monthly',
      from,
      to
    } = req.query;

    let where =
      "status != 'Cancelled'";

    const params = [];

    if (from) {
      where +=
        " AND DATE(created_at) >= ?";

      params.push(from);
    }

    if (to) {
      where +=
        " AND DATE(created_at) <= ?";

      params.push(to);
    }

    const fmt =
      period === 'daily'
        ? '%d %b %Y'
        : period === 'yearly'
          ? '%Y'
          : '%b %Y';

    const grp =
      period === 'daily'
        ? '%Y-%m-%d'
        : period === 'yearly'
          ? '%Y'
          : '%Y-%m';

    const data =
      await all(
        `SELECT strftime('${fmt}', created_at) as label, COALESCE(SUM(amount),0) as revenue, COUNT(*) as orders FROM orders WHERE ${where} GROUP BY strftime('${grp}', created_at) ORDER BY strftime('${grp}', created_at)`,
        params
      );

    const total =
      (
        await get(
          `SELECT COALESCE(SUM(amount),0) as v FROM orders WHERE ${where}`,
          params
        )
      ).v;

    const avgOrder =
      (
        await get(
          `SELECT COALESCE(AVG(amount),0) as v FROM orders WHERE ${where}`,
          params
        )
      ).v;

    const orderCount =
      (
        await get(
          `SELECT COUNT(*) as v FROM orders WHERE ${where}`,
          params
        )
      ).v;

    res.json({
      data,
      total,
      avgOrder,
      orderCount
    });
  }
);

// PROFIT
app.get(
  '/api/admin/profit',
  requireAuth,
  async (req, res) => {
    const {
      period = 'monthly',
      from,
      to
    } = req.query;

    let where =
      "status != 'Cancelled'";

    const params = [];

    if (from) {
      where +=
        " AND DATE(created_at) >= ?";

      params.push(from);
    }

    if (to) {
      where +=
        " AND DATE(created_at) <= ?";

      params.push(to);
    }

    const fmt =
      period === 'daily'
        ? '%d %b %Y'
        : period === 'yearly'
          ? '%Y'
          : '%b %Y';

    const grp =
      period === 'daily'
        ? '%Y-%m-%d'
        : period === 'yearly'
          ? '%Y'
          : '%Y-%m';

    const data =
      await all(
        `SELECT strftime('${fmt}', created_at) as label, COALESCE(SUM(amount),0) as revenue, COALESCE(SUM(cost),0) as cost, COALESCE(SUM(amount)-SUM(cost),0) as profit FROM orders WHERE ${where} GROUP BY strftime('${grp}', created_at) ORDER BY strftime('${grp}', created_at)`,
        params
      );

    const summary =
      await get(
        `SELECT COALESCE(SUM(amount),0) as revenue, COALESCE(SUM(cost),0) as cost, COALESCE(SUM(amount)-SUM(cost),0) as profit, COALESCE(AVG((amount-cost)/NULLIF(amount,0)*100),0) as margin FROM orders WHERE ${where}`,
        params
      );

    res.json({
      data,
      ...summary
    });
  }
);

// DISCOUNTS
app.get(
  '/api/admin/discounts',
  requireAuth,
  async (req, res) => {
    const rows =
      await all(
        'SELECT * FROM discounts ORDER BY created_at DESC'
      );

    res.json(
      rows.map(d => ({
        ...d,
        allowed_emails:
          parseJsonArray(
            d.allowed_emails
          )
      }))
    );
  }
);

app.post(
  '/api/admin/discounts',
  requireAuth,
  async (req, res) => {
    const {
      code,
      type,
      value,
      min_order,
      max_uses,
      active,
      starts_at,
      expires_at,
      allowed_emails
    } = req.body;

    if (
      !code ||
      !type ||
      value == null
    ) {
      return res.status(400).json({
        error:
          'Missing required fields'
      });
    }

    if (
      !['percentage', 'fixed'].includes(type)
    ) {
      return res.status(400).json({
        error: 'Invalid type'
      });
    }

    const emails =
      normalizeEmailList(
        allowed_emails
      );

    try {
      await run(
        `INSERT INTO discounts (code,type,value,min_order,max_uses,active,starts_at,expires_at,allowed_emails) VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          code.toUpperCase(),
          type,
          value,
          min_order || 0,
          max_uses || null,
          active ? 1 : 0,
          starts_at ||
            new Date().toISOString(),
          expires_at || null,
          JSON.stringify(emails)
        ]
      );

      res.json({
        success: true
      });
    } catch (e) {
      if (
        e.message.includes(
          'UNIQUE'
        )
      ) {
        return res.status(400).json({
          error:
            'Code already exists'
        });
      }

      throw e;
    }
  }
);

app.put(
  '/api/admin/discounts/:id',
  requireAuth,
  async (req, res) => {
    const {
      code,
      type,
      value,
      min_order,
      max_uses,
      active,
      starts_at,
      expires_at,
      allowed_emails
    } = req.body;

    if (
      !await get(
        'SELECT id FROM discounts WHERE id = ?',
        [req.params.id]
      )
    ) {
      return res.status(404).json({
        error: 'Discount not found'
      });
    }

    const emails =
      normalizeEmailList(
        allowed_emails
      );

    try {
      await run(
        `UPDATE discounts SET code=?,type=?,value=?,min_order=?,max_uses=?,active=?,starts_at=?,expires_at=?,allowed_emails=? WHERE id=?`,
        [
          code.toUpperCase(),
          type,
          value,
          min_order || 0,
          max_uses || null,
          active ? 1 : 0,
          starts_at,
          expires_at || null,
          JSON.stringify(emails),
          req.params.id
        ]
      );

      res.json({
        success: true
      });
    } catch (e) {
      if (
        e.message.includes(
          'UNIQUE'
        )
      ) {
        return res.status(400).json({
          error:
            'Code already exists'
        });
      }

      throw e;
    }
  }
);

app.delete(
  '/api/admin/discounts/:id',
  requireAuth,
  async (req, res) => {
    await run(
      'DELETE FROM discounts WHERE id = ?',
      [req.params.id]
    );

    res.json({
      success: true
    });
  }
);

// ─── STUDENT AUTH HELPERS ────────────────────────────────────────
const STUDENT_COOKIE =
  'student_token';

const STUDENT_TTL_MS =
  30 * 24 * 60 * 60 * 1000;

const STUDENT_TTL =
  '30d';

function setStudentCookie(
  res,
  token
) {
  res.cookie(
    STUDENT_COOKIE,
    token,
    {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: 'strict',
      path: '/',
      maxAge:
        STUDENT_TTL_MS
    }
  );
}

function clearStudentCookie(res) {
  res.clearCookie(
    STUDENT_COOKIE,
    {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: 'strict',
      path: '/'
    }
  );
}

async function requireStudentAuth(
  req,
  res,
  next
) {
  const token =
    req.cookies?.[STUDENT_COOKIE];

  if (!token) {
    return res.status(401).json({
      error: 'Not logged in'
    });
  }

  try {
    const payload =
      jwt.verify(
        token,
        JWT_SECRET
      );

    const student =
      await get(
        'SELECT id,name,uid,email,phone,academic_block FROM students WHERE id = ?',
        [payload.id]
      );

    if (!student) {
      return res.status(401).json({
        error: 'Session expired'
      });
    }

    req.student = student;
    next();
  } catch {
    return res.status(401).json({
      error:
        'Invalid or expired session'
    });
  }
}

function studentPublic(s) {
  return {
    id: s.id,
    name: s.name,
    uid: s.uid,
    email: s.email,
    phone: s.phone,
    academicBlock:
      s.academic_block
  };
}

// STUDENT REGISTRATION
app.post(
  '/api/students/register',
  async (req, res) => {
    try {
      const name =
        String(
          req.body?.name || ''
        ).trim();

      const uid =
        String(
          req.body?.uid || ''
        ).trim();

      const email =
        String(
          req.body?.email || ''
        ).trim().toLowerCase();

      const phone =
        String(
          req.body?.phone || ''
        ).trim();

      const academic_block =
        String(
          req.body?.academic_block ||
            'Main Academic Block - E'
        ).trim();

      const password =
        String(
          req.body?.password || ''
        );

      if (
        !name ||
        !uid ||
        !email ||
        !phone
      ) {
        return res.status(400).json({
          error:
            'Name, Student ID, email and phone are required'
        });
      }

      if (
        password.length < 8
      ) {
        return res.status(400).json({
          error:
            'Password must be at least 8 characters'
        });
      }

      const password_hash =
        bcrypt.hashSync(
          password,
          10
        );

      await run(
        `INSERT INTO students (name,uid,email,phone,academic_block,password_hash) VALUES (?,?,?,?,?,?)
         ON CONFLICT(uid) DO UPDATE SET name=excluded.name,email=excluded.email,phone=excluded.phone,
         academic_block=excluded.academic_block,password_hash=excluded.password_hash,updated_at=datetime('now')`,
        [
          name,
          uid,
          email,
          phone,
          academic_block,
          password_hash
        ]
      );

      const student =
        await get(
          'SELECT id,name,uid,email,phone,academic_block FROM students WHERE uid = ?',
          [uid]
        );

      const token =
        jwt.sign(
          {
            id: student.id
          },
          JWT_SECRET,
          {
            expiresIn:
              STUDENT_TTL
          }
        );

      setStudentCookie(
        res,
        token
      );

      res.json({
        success: true,
        student:
          studentPublic(
            student
          )
      });
    } catch (e) {
      if (
        String(
          e.message
        ).includes('UNIQUE')
      ) {
        return res.status(400).json({
          error:
            'This email or Student ID is already registered'
        });
      }

      res.status(500).json({
        error:
          'Unable to create account'
      });
    }
  }
);

// STUDENT LOGIN
app.post(
  '/api/students/login',
  async (req, res) => {
    try {
      const identifier =
        String(
          req.body?.identifier ||
            ''
        ).trim().toLowerCase();

      const password =
        String(
          req.body?.password || ''
        );

      if (
        !identifier ||
        !password
      ) {
        return res.status(400).json({
          error:
            'Identifier and password are required'
        });
      }

      const student =
        await get(
          'SELECT id,name,uid,email,phone,academic_block,password_hash FROM students WHERE LOWER(uid)=? OR LOWER(email)=? OR phone=?',
          [
            identifier,
            identifier,
            identifier
          ]
        );

      if (
        !student ||
        !student.password_hash
      ) {
        return res.status(401).json({
          error:
            'Invalid credentials'
        });
      }

      const valid =
        bcrypt.compareSync(
          password,
          student.password_hash
        );

      if (!valid) {
        return res.status(401).json({
          error:
            'Invalid credentials'
        });
      }

      const token =
        jwt.sign(
          {
            id: student.id
          },
          JWT_SECRET,
          {
            expiresIn:
              STUDENT_TTL
          }
        );

      setStudentCookie(
        res,
        token
      );

      res.json({
        success: true,
        student:
          studentPublic(
            student
          )
      });
    } catch (e) {
      res.status(500).json({
        error:
          'Login failed'
      });
    }
  }
);

// STUDENT SESSION CHECK
app.get(
  '/api/students/me',
  requireStudentAuth,
  (req, res) => {
    res.json({
      student:
        studentPublic(
          req.student
        )
    });
  }
);

// UPDATE STUDENT PROFILE
app.put(
  '/api/students/me',
  requireStudentAuth,
  async (req, res) => {
    try {
      const {
        name,
        email,
        phone,
        academic_block,
        password
      } = req.body || {};

      const updates = [
        "updated_at = datetime('now')"
      ];

      const params = [];

      if (name) {
        updates.push(
          'name = ?'
        );

        params.push(
          String(
            name
          ).trim()
        );
      }

      if (email) {
        updates.push(
          'email = ?'
        );

        params.push(
          String(
            email
          ).trim().toLowerCase()
        );
      }

      if (phone) {
        updates.push(
          'phone = ?'
        );

        params.push(
          String(
            phone
          ).trim()
        );
      }

      if (academic_block) {
        updates.push(
          'academic_block = ?'
        );

        params.push(
          String(
            academic_block
          ).trim()
        );
      }

      if (password) {
        if (
          String(password).length < 8
        ) {
          return res.status(400).json({
            error:
              'Password must be at least 8 characters'
          });
        }

        updates.push(
          'password_hash = ?'
        );

        params.push(
          bcrypt.hashSync(
            String(password),
            10
          )
        );
      }

      params.push(
        req.student.id
      );

      await run(
        `UPDATE students SET ${updates.join(', ')} WHERE id = ?`,
        params
      );

      const updated =
        await get(
          'SELECT id,name,uid,email,phone,academic_block FROM students WHERE id = ?',
          [req.student.id]
        );

      res.json({
        success: true,
        student:
          studentPublic(
            updated
          )
      });
    } catch (e) {
      if (
        String(
          e.message
        ).includes('UNIQUE')
      ) {
        return res.status(400).json({
          error:
            'Email already in use'
        });
      }

      res.status(500).json({
        error:
          'Unable to update profile'
      });
    }
  }
);

// STUDENT LOGOUT
app.post(
  '/api/students/logout',
  (req, res) => {
    clearStudentCookie(res);

    res.json({
      success: true
    });
  }
);

// STUDENT ORDERS
app.get(
  '/api/students/orders',
  requireStudentAuth,
  async (req, res) => {
    try {
      const email =
        req.student.email;

      const rows =
        await all(
          `SELECT id,customer_name,items,amount,status,discount_code,discount_amount,delivery_location,delivery_notes,delivery_charge,created_at,
                  customer_phone AS phone
           FROM orders WHERE LOWER(customer_email)=? ORDER BY created_at DESC LIMIT 50`,
          [email]
        );

      const orders =
        rows.map(o => ({
          ...o,
          items:
            (() => {
              try {
                return JSON.parse(
                  o.items
                );
              } catch {
                return [];
              }
            })(),
          payment_status:
            o.status,
          delivery_location: o.delivery_location || req.student.academic_block,
          delivery_notes: o.delivery_notes || 'Expected delivery in 1-2 days',
          delivery_charge: Number(o.delivery_charge || 0)
        }));

      const printingRows = await all(
        `SELECT id, student_name AS customer_name, service_name, file_name, pages, copies,
                paper_size, sides, binding, amount, status, payment_status, created_at
         FROM printing_orders WHERE LOWER(student_email)=? ORDER BY created_at DESC LIMIT 50`,
        [String(email).toLowerCase()]
      );
      const printingOrders = printingRows.map(o => ({
        ...o,
        order_type: 'printing',
        items: [{ name: `Printing: ${o.service_name}`, variantLabel: '', qty: Number(o.pages || 1) * Number(o.copies || 1), price: Number(o.amount || 0) }],
        delivery_location: 'Printing service',
        delivery_notes: `${o.file_name} · ${o.pages} page(s) × ${o.copies} copies · ${o.paper_size || 'A4'} · ${o.sides || ''} · ${o.binding || ''}`,
        delivery_charge: 0
      }));
      res.json({ orders: [...orders.map(o => ({...o, order_type:'store'})), ...printingOrders]
        .sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 50) });
    } catch (e) {
      res.status(500).json({
        error:
          'Unable to load orders'
      });
    }
  }
);

// STUDENT COUPONS
app.get(
  '/api/students/coupons',
  requireStudentAuth,
  async (req, res) => {
    try {
      const email =
        req.student.email;

      const all_coupons =
        await all(
          `SELECT id,code,type,value,min_order,uses,max_uses,expires_at,allowed_emails FROM discounts
           WHERE active=1 AND (starts_at IS NULL OR datetime(starts_at)<=datetime('now'))
           AND (expires_at IS NULL OR datetime(expires_at)>=datetime('now'))
           AND (max_uses IS NULL OR uses < max_uses)
           ORDER BY created_at DESC`
        );

      const coupons =
        all_coupons
          .filter(c => {
            const allowed =
              (() => {
                try {
                  return JSON.parse(
                    c.allowed_emails ||
                      '[]'
                  );
                } catch {
                  return [];
                }
              })();

            return (
              !allowed.length ||
              allowed
                .map(e =>
                  e.toLowerCase()
                )
                .includes(email)
            );
          })
          .map(c => ({
            code: c.code,
            discount:
              c.type ===
              'percentage'
                ? `${c.value}% off`
                : `₹${c.value} off`,
            min_order:
              c.min_order,
            expires_at:
              c.expires_at,
            status: 'Active'
          }));

      res.json({
        coupons
      });
    } catch (e) {
      res.status(500).json({
        error:
          'Unable to load coupons'
      });
    }
  }
);

// PUBLIC ORDER CREATION
app.post(
  '/api/orders',
  async (req, res) => {
    try {
      const {
        customer_name,
        customer_email,
        customer_phone,
        items,
        discount_code,
        discount_amount,
        delivery_location,
        delivery_notes
      } = req.body || {};

      if (
        !customer_name ||
        !customer_email ||
        !Array.isArray(items) ||
        !items.length
      ) {
        return res.status(400).json({
          error:
            'Missing order details'
        });
      }

      const email =
        String(
          customer_email
        ).trim().toLowerCase();

      const cleanItems = [];
      let subtotal = 0;
      let totalCost = 0;

      for (
        const raw of items
      ) {
        const productId =
          String(
            raw.productId || ''
          ).trim();

        const qty =
          Math.max(
            1,
            Math.min(
              100,
              parseInt(
                raw.qty
              ) || 1
            )
          );

        if (!productId) {
          return res.status(400).json({
            error:
              'Invalid product in order'
          });
        }

        const product =
          await get(
            'SELECT id,name,price,cost_price,stock_count,out_of_stock,active FROM products WHERE id = ?',
            [productId]
          );

        if (
          !product ||
          Number(product.active) !== 1 ||
          Number(product.out_of_stock) === 1
        ) {
          return res.status(400).json({
            error:
              `Product unavailable: ${productId}`
          });
        }

        let unitPrice =
          Number(
            product.price
          ) || 0;

        let unitCost =
          Number(
            product.cost_price
          ) || 0;

        let variantLabel = '';

        if (
          raw.variantId != null
        ) {
          const variant =
            await get(
              'SELECT id,label,price,cost,stock,active FROM product_variants WHERE id = ? AND product_id = ?',
              [
                raw.variantId,
                productId
              ]
            );

          if (
            !variant ||
            Number(variant.active) !== 1
          ) {
            return res.status(400).json({
              error:
                `Product option unavailable: ${raw.variantId}`
            });
          }

          if (
            Number(
              variant.stock
            ) < qty
          ) {
            return res.status(400).json({
              error:
                `Insufficient stock for ${product.name} — ${variant.label}`
            });
          }

          unitPrice =
            Number(
              variant.price
            ) || 0;

          unitCost =
            Number(
              variant.cost
            ) || 0;

          variantLabel =
            variant.label || '';
        } else if (
          Number(
            product.stock_count
          ) < qty
        ) {
          return res.status(400).json({
            error:
              `Insufficient stock for ${product.name}`
          });
        }

        subtotal +=
          unitPrice * qty;

        totalCost +=
          unitCost * qty;

        cleanItems.push({
          productId,
          variantId:
            raw.variantId ||
            null,
          name:
            product.name,
          variantLabel,
          qty,
          price:
            unitPrice
        });
      }

      let finalDiscount = 0;
      let normalizedCode = null;

      if (discount_code) {
        const code =
          String(
            discount_code
          ).trim().toUpperCase();

        const d =
          await get(
            `SELECT * FROM discounts WHERE UPPER(code)=? AND active=1 AND (starts_at IS NULL OR datetime(starts_at)<=datetime('now')) AND (expires_at IS NULL OR datetime(expires_at)>=datetime('now')) AND (max_uses IS NULL OR uses < max_uses)`,
            [code]
          );

        if (!d) {
          return res.status(400).json({
            error:
              'Invalid coupon code'
          });
        }

        const registered =
          await get(
            'SELECT id FROM students WHERE LOWER(email)=?',
            [email]
          );

        if (!registered) {
          return res.status(403).json({
            error:
              'Please register with this email before using this coupon'
          });
        }

        const allowed =
          normalizeEmailList(
            d.allowed_emails
          );

        if (
          allowed.length &&
          !allowed.includes(
            email
          )
        ) {
          return res.status(403).json({
            error:
              'This coupon is not assigned to your registered email'
          });
        }

        if (
          subtotal <
          Number(
            d.min_order || 0
          )
        ) {
          return res.status(400).json({
            error:
              `Minimum order is ₹${Number(d.min_order || 0)}`
          });
        }

        finalDiscount =
          d.type ===
          'percentage'
            ? Math.min(
                subtotal,
                Math.round(
                  subtotal *
                    Number(d.value) /
                    100
                )
              )
            : Math.min(
                subtotal,
                Number(d.value)
              );

        normalizedCode =
          d.code;
      }

      const deliveryCharge = subtotal >= 249 ? 0 : 50;
      const amount = Math.max(0, subtotal - finalDiscount + deliveryCharge);

      const id =
        'ORD-' +
        Math.floor(
          100000 +
            Math.random() *
              900000
        ) +
        '-' +
        Date.now()
          .toString(36)
          .slice(-4)
          .toUpperCase();

      await run(
        `INSERT INTO orders (id,customer_name,customer_email,customer_phone,items,amount,cost,status,discount_code,discount_amount,delivery_location,delivery_notes,delivery_charge) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          customer_name,
          email,
          customer_phone ||
            null,
          JSON.stringify(
            cleanItems
          ),
          amount,
          totalCost,
          'Pending',
          normalizedCode,
          finalDiscount,
          String(delivery_location || 'Main Gate'),
          String(delivery_notes || 'Expected delivery in 1-2 days'),
          deliveryCharge
        ]
      );

      if (normalizedCode) {
        await run(
          'UPDATE discounts SET uses = uses + 1 WHERE UPPER(code)=?',
          [normalizedCode]
        );
      }

      res.json({
        success: true,
        orderId: id,
        subtotal,
        discount:
          finalDiscount,
        total:
          amount,
        deliveryCharge,
        cost:
          totalCost,
        items:
          cleanItems
      });
    } catch (e) {
      console.error(
        'Public order error:',
        e
      );

      res.status(500).json({
        error:
          'Unable to place order'
      });
    }
  }
);

// PUBLIC DISCOUNTS
app.get(
  '/api/discounts',
  async (req, res) => {
    try {
      const discounts =
        await all(
          `SELECT id, code, type, value, min_order, max_uses, uses, active, starts_at, expires_at, allowed_emails FROM discounts WHERE active = 1 AND (starts_at IS NULL OR datetime(starts_at) <= datetime('now')) AND (expires_at IS NULL OR datetime(expires_at) >= datetime('now')) AND (max_uses IS NULL OR uses < max_uses) ORDER BY created_at DESC`
        );

      res.set(
        'Cache-Control',
        'no-store'
      );

      res.json({
        discounts:
          discounts.map(d => ({
            ...d,
            allowed_emails:
              parseJsonArray(
                d.allowed_emails
              )
          }))
      });
    } catch (e) {
      res.status(500).json({
        error:
          'Failed to load discount codes'
      });
    }
  }
);

app.post(
  '/api/discounts/validate',
  async (req, res) => {
    try {
      const code =
        String(
          req.body?.code || ''
        ).trim().toUpperCase();

      const subtotal =
        Number(
          req.body?.subtotal ||
            0
        );

      const email =
        String(
          req.body?.email || ''
        ).trim().toLowerCase();

      if (!code) {
        return res.status(400).json({
          error:
            'Enter a coupon code'
        });
      }

      if (!email) {
        return res.status(400).json({
          error:
            'Enter your registered email to use this coupon'
        });
      }

      if (
        !Number.isFinite(
          subtotal
        ) ||
        subtotal < 0
      ) {
        return res.status(400).json({
          error:
            'Invalid subtotal'
        });
      }

      const d =
        await get(
          `SELECT * FROM discounts WHERE UPPER(code) = ? AND active = 1 AND (starts_at IS NULL OR datetime(starts_at) <= datetime('now')) AND (expires_at IS NULL OR datetime(expires_at) >= datetime('now')) AND (max_uses IS NULL OR uses < max_uses)`,
          [code]
        );

      if (!d) {
        return res.status(404).json({
          success: false,
          error:
            'Invalid coupon code'
        });
      }

      const registered =
        await get(
          'SELECT id FROM students WHERE LOWER(email) = ?',
          [email]
        );

      if (!registered) {
        return res.status(403).json({
          success: false,
          error:
            'Please register with this email before using this coupon'
        });
      }

      const allowed =
        normalizeEmailList(
          d.allowed_emails
        );

      if (
        allowed.length &&
        !allowed.includes(
          email
        )
      ) {
        return res.status(403).json({
          success: false,
          error:
            'This coupon is not assigned to your registered email'
        });
      }

      if (
        subtotal <
        Number(
          d.min_order || 0
        )
      ) {
        return res.status(400).json({
          error:
            `Minimum order is ₹${Number(d.min_order || 0)}`
        });
      }

      const discount =
        d.type ===
        'percentage'
          ? Math.min(
              subtotal,
              Math.round(
                subtotal *
                  Number(d.value) /
                  100
              )
            )
          : Math.min(
              subtotal,
              Number(d.value)
            );

      res.set(
        'Cache-Control',
        'no-store'
      );

      res.json({
        success: true,
        code: d.code,
        type: d.type,
        value:
          Number(d.value),
        discount,
        total:
          Math.max(
            0,
            subtotal -
              discount
          )
      });
    } catch (e) {
      res.status(500).json({
        error:
          'Unable to validate coupon'
      });
    }
  }
);

// SUPPORT
app.get(
  '/api/admin/support',
  requireAuth,
  async (req, res) => {
    const {
      search,
      status,
      priority,
      page = 1,
      limit = 20
    } = req.query;

    let where = '1=1';
    const params = [];

    if (search) {
      where +=
        " AND (customer_name LIKE ? OR customer_email LIKE ? OR subject LIKE ? OR message LIKE ?)";

      params.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`
      );
    }

    if (status) {
      where +=
        " AND status = ?";

      params.push(status);
    }

    if (priority) {
      where +=
        " AND priority = ?";

      params.push(priority);
    }

    const offset =
      (parseInt(page) - 1) *
      parseInt(limit);

    const total =
      Number(
        (
          await get(
            `SELECT COUNT(*) as c FROM support_tickets WHERE ${where}`,
            params
          )
        ).c
      );

    const tickets =
      await all(
        `SELECT * FROM support_tickets WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [
          ...params,
          parseInt(limit),
          offset
        ]
      );

    res.json({
      tickets,
      total
    });
  }
);

app.post(
  '/api/admin/support',
  requireAuth,
  async (req, res) => {
    const {
      customer_name,
      customer_email,
      customer_phone,
      subject,
      message,
      status,
      priority
    } = req.body;

    if (
      !customer_name ||
      !message
    ) {
      return res.status(400).json({
        error:
          'Missing required fields'
      });
    }

    const r =
      await run(
        `INSERT INTO support_tickets (customer_name,customer_email,customer_phone,subject,message,status,priority) VALUES (?,?,?,?,?,?,?)`,
        [
          customer_name,
          customer_email || '',
          customer_phone ||
            null,
          subject || '',
          message,
          status || 'Open',
          priority || 'Normal'
        ]
      );

    res.json({
      success: true,
      id:
        r.lastInsertRowid
    });
  }
);

app.put(
  '/api/admin/support/:id',
  requireAuth,
  async (req, res) => {
    const {
      status,
      notes,
      priority
    } = req.body;

    if (
      !await get(
        'SELECT id FROM support_tickets WHERE id = ?',
        [req.params.id]
      )
    ) {
      return res.status(404).json({
        error:
          'Ticket not found'
      });
    }

    const updates = [
      "updated_at = datetime('now')"
    ];

    const params = [];

    if (status) {
      updates.push(
        'status = ?'
      );
      params.push(status);
    }

    if (
      notes !== undefined
    ) {
      updates.push(
        'notes = ?'
      );
      params.push(notes);
    }

    if (priority) {
      updates.push(
        'priority = ?'
      );
      params.push(priority);
    }

    params.push(
      req.params.id
    );

    await run(
      `UPDATE support_tickets SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    res.json({
      success: true
    });
  }
);

app.delete(
  '/api/admin/support/:id',
  requireAuth,
  async (req, res) => {
    await run(
      'DELETE FROM support_tickets WHERE id = ?',
      [req.params.id]
    );

    res.json({
      success: true
    });
  }
);

// PUBLIC PRODUCT CATALOG
app.get(
  '/api/admin/public-products',
  async (req, res) => {
    try {
      await ensurePublicCatalogReady();

      const products =
        await all(`
          SELECT id, name, category, category_label, price, rating, reviews_count,
                 badge, description, specs, stock_count, image, gallery, tags, out_of_stock
          FROM products
          WHERE active = 1
          ORDER BY created_at DESC
        `);

      const variants =
        products.length
          ? await all(
              `
                SELECT id, product_id, label, price, stock, active, image
                FROM product_variants
                WHERE active = 1
                AND product_id IN (${products.map(() => '?').join(',')})
                ORDER BY id
              `,
              products.map(
                p => p.id
              )
            )
          : [];

      const variantsByProduct =
        new Map();

      for (
        const v of variants
      ) {
        const key =
          String(
            v.product_id
          );

        if (
          !variantsByProduct.has(
            key
          )
        ) {
          variantsByProduct.set(
            key,
            []
          );
        }

        variantsByProduct
          .get(key)
          .push(v);
      }

      const mapped =
        products.map(
          p => ({
            id: p.id,
            name: p.name,
            category:
              p.category,
            categoryLabel:
              p.category_label ||
              p.category,
            price:
              Number(
                p.price
              ) || 0,
            rating:
              Number(
                p.rating
              ) || 0,
            reviewsCount:
              Number(
                p.reviews_count
              ) || 0,
            badge:
              p.badge || '',
            description:
              p.description || '',
            specs:
              parseJsonArray(
                p.specs
              ),
            inStock: Number(p.out_of_stock) !== 1 && Number(p.stock_count) > 0,
            outOfStock: Number(p.out_of_stock) === 1,
            stockCount:
              Number(
                p.stock_count
              ) || 0,
            image:
              p.image || '',
            gallery:
              parseJsonArray(
                p.gallery
              ),
            tags:
              parseJsonArray(
                p.tags
              ),
            variants:
              variantsByProduct.get(
                String(p.id)
              ) || []
          })
        );

      res.set(
        'Cache-Control',
        'public, max-age=60, stale-while-revalidate=300'
      );

      res.json({
        products: mapped
      });
    } catch (err) {
      console.error(
        'Public products error:',
        err
      );

      res.status(500).json({
        error:
          'Unable to load products'
      });
    }
  }
);

function parseJsonArray(value) {
  if (Array.isArray(value))
    return value;

  if (!value)
    return [];

  try {
    const parsed =
      JSON.parse(value);

    return Array.isArray(
      parsed
    )
      ? parsed
      : [];
  } catch {
    return String(
      value
    )
      .split(',')
      .map(
        s => s.trim()
      )
      .filter(Boolean);
  }
}

function normalizeEmailList(
  value
) {
  let list = [];

  if (Array.isArray(value)) {
    list = value;
  } else if (
    typeof value ===
    'string'
  ) {
    const raw = value.trim();

    // allowed_emails is stored as JSON in the database.
    // Parse that representation before falling back to the
    // comma/newline format used by the admin input.
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        list = Array.isArray(parsed)
          ? parsed
          : raw.split(/[,\n]+/);
      } catch {
        list = raw.split(/[,\n]+/);
      }
    }
  }

  return [
    ...new Set(
      list
        .map(e =>
          String(
            e
          )
            .trim()
            .toLowerCase()
        )
        .filter(
          e =>
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
              e
            )
        )
    )
  ];
}

// PRINTING SERVICES
app.get(
  '/api/printing/services',
  async (req, res) => {
    try {
      // Ensure the table exists even on an older deployment.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS printing_services (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'Notes & Assignments',
          rate REAL NOT NULL DEFAULT 0,
          cost REAL NOT NULL DEFAULT 0,
          flat INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          icon TEXT DEFAULT '🖨️',
          description TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      let rows =
        await all(
          `SELECT id, name, category, rate, cost, flat, active, icon, description
           FROM printing_services
           WHERE active = 1
           ORDER BY id ASC`
        );

      // If the table exists but is empty, seed the services.
      if (!rows.length) {
        const defaults = [
          [
            'Black & White Copy',
            'Notes & Assignments',
            2,
            0,
            0
          ],
          [
            'Color Printing',
            'Notes & Assignments',
            5,
            0,
            0
          ],
          [
            'Project Report Printing',
            'Projects & Reports',
            4,
            0,
            0
          ],
          [
            'Study Material Printing',
            'Study Material',
            2,
            0,
            0
          ],
          [
            'Forms & Documents',
            'Forms & Documents',
            2,
            0,
            0
          ]
        ];

        for (
          const [
            name,
            category,
            rate,
            cost,
            flat
          ] of defaults
        ) {
          await run(
            'INSERT INTO printing_services (name, category, rate, cost, flat, active) VALUES (?,?,?,?,?,1)',
            [
              name,
              category,
              rate,
              cost,
              flat
            ]
          );
        }

        rows =
          await all(
            `SELECT id, name, category, rate, cost, flat, active, icon, description
             FROM printing_services
             WHERE active = 1
             ORDER BY id ASC`
          );
      }

      res.set(
        'Cache-Control',
        'no-store'
      );

      res.json(
        rows.map(
          row => ({
            id:
              row.id,
            name:
              row.name,
            category:
              row.category,
            rate:
              Number(
                row.rate
              ) || 0,
            pageRate:
              Number(
                row.rate
              ) || 0,
            cost:
              Number(
                row.cost
              ) || 0,
            flat:
              Number(
                row.flat
              ) === 1,
            icon:
              row.icon || '🖨️',
            description:
              row.description || ''
          })
        )
      );
    } catch (err) {
      console.error(
        'Printing services error:',
        err
      );

      res.status(500).json({
        error:
          'Unable to load printing services'
      });
    }
  }
);


// ─── PRINTING OPERATOR + ORDERS ────────────────────────────────
const PRINTING_STATUSES = ['Received', 'Accepted', 'Printing', 'Ready', 'Completed', 'Cancelled'];
const PRINTING_PAYMENTS = ['Paid', 'Unpaid'];

function printingOrderId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `PRN-${stamp}-${random}`;
}

function calculatePrintingAmount(service, pages, copies, sides, binding) {
  const p = Math.max(1, Math.min(1000, Number.parseInt(pages, 10) || 1));
  const c = Math.max(1, Math.min(100, Number.parseInt(copies, 10) || 1));
  let total = Number(service.rate) || 0;
  let cost = Number(service.cost) || 0;
  if (!Number(service.flat)) {
    total = total * p * c;
    cost = cost * p * c;
  } else {
    total = total * c;
    cost = cost * c;
  }
  if (!Number(service.flat) && binding && binding !== 'None') total += 20 * c;
  if (!Number(service.flat) && sides === 'Single-sided') total += Math.ceil(p * c * 0.5);
  return {
    amount: Math.max(0, Math.round(total * 100) / 100),
    cost: Math.max(0, Math.round(cost * 100) / 100),
    pages: p,
    copies: c
  };
}

async function getPrintingService(id) {
  return get(
    `SELECT id, name, category, rate, cost, flat, active, icon, description
     FROM printing_services WHERE id = ?`,
    [id]
  );
}

app.post('/api/printing/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const rate = checkLoginRateLimit(req, username);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfter));
      return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }

    const printUsername = String(process.env.PRINT_ADMIN_USERNAME || 'print').trim().toLowerCase();
    const admin = await get(
      `SELECT * FROM admin_users
       WHERE LOWER(email)=?
          OR LOWER(CASE WHEN instr(email,'@') > 0 THEN substr(email,1,instr(email,'@')-1) ELSE email END)=?
          OR (? = ? AND id = 1)
       LIMIT 1`,
      [username, username, username, printUsername]
    );

    const valid = !!admin && await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      recordFailedLogin(rate.key);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    clearLoginRateLimit(rate.key);
    const token = jwt.sign({ id: admin.id, email: admin.email }, JWT_SECRET, { expiresIn: SESSION_TTL });
    setAdminCookie(res, token);
    res.json({ success: true, username: admin.email });
  } catch (err) {
    console.error('Printing login error:', err);
    res.status(500).json({ error: 'Unable to sign in. Please check the server configuration.' });
  }
});

app.get('/api/printing/me', requireAuth, (req, res) => {
  res.json({ authenticated: true, admin: req.admin });
});

app.post('/api/printing/logout', (req, res) => {
  clearAdminCookie(res);
  res.json({ success: true });
});

async function sendPrintingOrderNotification(order) {
  const configuredRecipient = String(process.env.ORDER_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL || '').trim();
  const printUsernameFallback = String(process.env.PRINT_ADMIN_USERNAME || '').trim();
  const to = configuredRecipient || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(printUsernameFallback) ? printUsernameFallback : '');
  if (!to) throw new Error('Set ORDER_NOTIFICATION_EMAIL or ADMIN_EMAIL to a valid email address');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Printing notification recipient must be a valid email address');

  const subject = `New Printing Order ${order.id}`;
  const text = [
    `New printing order received: ${order.id}`,
    `Student: ${order.student_name}`,
    `Email: ${order.student_email}`,
    `Phone: ${order.student_phone || '-'}`,
    `Service: ${order.service_name}`,
    `File: ${order.file_name}`,
    `Pages: ${order.pages} × ${order.copies} copies`,
    `Amount: ₹${Number(order.amount || 0).toFixed(2)}`,
    `Cost: ₹${Number(order.cost || 0).toFixed(2)}`,
    `Profit: ₹${Math.max(0, Number(order.amount || 0) - Number(order.cost || 0)).toFixed(2)}`,
    `Status: ${order.status}`
  ].join('\n');

  if (process.env.RESEND_API_KEY) {
    const from = String(process.env.EMAIL_FROM || '').trim();
    if (!from) throw new Error('EMAIL_FROM is required with RESEND_API_KEY');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to: [to], subject, text })
    });
    if (!response.ok) throw new Error(`Resend email failed: ${response.status}`);
    return;
  }

  throw new Error('No email provider configured');
}

app.post('/api/printing/orders', async (req, res) => {
  try {
    const {
      student_name, student_uid, student_email, student_phone,
      service_id, file_name, file_type, file_data,
      pages, copies, paper_size, sides, binding, notes
    } = req.body || {};

    const name = String(student_name || '').trim();
    const email = String(student_email || '').trim().toLowerCase();
    const phone = String(student_phone || '').replace(/\D/g, '');
    const fileName = String(file_name || '').trim();
    const fileType = String(file_type || '').trim();
    const data = String(file_data || '');

    if (!name || !email || !fileName || !fileType || !data || service_id == null) {
      return res.status(400).json({ error: 'Name, email, service and file are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
    if (!/^\d{10}$/.test(phone)) return res.status(400).json({ error: 'Please enter a valid 10-digit phone number' });
    if (data.length > 10_500_000) return res.status(413).json({ error: 'File is too large. Please upload a file up to 6 MB.' });

    const allowed = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png'
    ]);
    if (!allowed.has(fileType)) return res.status(400).json({ error: 'Only PDF, DOC, DOCX, JPG and PNG files are allowed' });
    if (!/^data:[^;]+;base64,/.test(data)) return res.status(400).json({ error: 'Invalid uploaded file data' });

    const service = await getPrintingService(service_id);
    if (!service || !Number(service.active)) return res.status(400).json({ error: 'This printing service is no longer available' });

    const pricing = calculatePrintingAmount(service, pages, copies, sides, binding);
    const id = printingOrderId();
    await run(
      `INSERT INTO printing_orders
       (id,student_name,student_uid,student_email,student_phone,service_id,service_name,file_name,file_type,file_data,pages,copies,paper_size,sides,binding,notes,amount,cost,status,payment_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Received','Unpaid')`,
      [
        id, name, String(student_uid || '').trim(), email, phone,
        service.id, service.name, fileName, fileType, data,
        pricing.pages, pricing.copies, String(paper_size || 'A4'),
        String(sides || 'Double-sided'), String(binding || 'None'),
        String(notes || '').trim(), pricing.amount, pricing.cost
      ]
    );

    try {
      await sendPrintingOrderNotification({
        id, student_name: name, student_email: email, student_phone: phone,
        service_name: service.name, file_name: fileName, pages: pricing.pages,
        copies: pricing.copies, amount: pricing.amount, cost: pricing.cost, status: 'Received'
      });
    } catch (mailErr) {
      console.error('Printing order email error:', mailErr);
    }

    res.status(201).json({
      success: true,
      orderId: id,
      amount: pricing.amount,
      pages: pricing.pages,
      copies: pricing.copies,
      status: 'Received'
    });
  } catch (err) {
    console.error('Printing order error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

app.get('/api/printing/order/:id', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    const order = await get(
      `SELECT id, student_name, student_email, service_name, file_name, pages, copies,
              paper_size, sides, binding, amount, status, payment_status, created_at
       FROM printing_orders WHERE id = ? AND LOWER(student_email) = ?`,
      [req.params.id, email]
    );
    if (!order) return res.status(404).json({ error: 'Order not found. Check your order ID and email.' });
    res.json({ order });
  } catch (err) {
    console.error('Printing tracking error:', err);
    res.status(500).json({ error: 'Unable to track order' });
  }
});

app.get('/api/printing/dashboard', requireAuth, async (req, res) => {
  try {
    const range = String(req.query.range || 'today');
    const where = range === '30d'
      ? `created_at >= datetime('now','-30 days')`
      : range === 'all'
        ? '1=1'
        : `date(created_at)=date('now')`;
    const summary = await get(
      `SELECT
        COUNT(*) AS orders,
        COALESCE(SUM(amount),0) AS earnings,
        COALESCE(SUM(cost),0) AS cost,
        COALESCE(SUM(amount-cost),0) AS profit,
        SUM(CASE WHEN payment_status='Paid' THEN 1 ELSE 0 END) AS paid,
        COALESCE(SUM(CASE WHEN payment_status='Paid' THEN amount ELSE 0 END),0) AS paidAmount,
        SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) AS completed
       FROM printing_orders WHERE ${where}`
    );
    res.json({ summary: {
      orders: Number(summary.orders || 0),
      earnings: Number(summary.earnings || 0),
      cost: Number(summary.cost || 0),
      profit: Number(summary.profit || 0),
      paid: Number(summary.paid || 0),
      paidAmount: Number(summary.paidAmount || 0),
      completed: Number(summary.completed || 0)
    }});
  } catch (err) {
    console.error('Printing dashboard error:', err);
    res.status(500).json({ error: 'Unable to load dashboard' });
  }
});

app.get('/api/printing/orders', requireAuth, async (req, res) => {
  try {
    const range = String(req.query.range || 'today');
    const status = String(req.query.status || '').trim();
    const params = [];
    let where = '1=1';
    if (range === '30d') where += ` AND created_at >= datetime('now','-30 days')`;
    else if (range !== 'all') where += ` AND date(created_at)=date('now')`;
    if (status && PRINTING_STATUSES.includes(status)) { where += ' AND status = ?'; params.push(status); }
    const orders = await all(
      `SELECT id,student_name,student_uid,student_email,student_phone,service_name,file_name,pages,copies,paper_size,sides,binding,amount,cost,status,payment_status,created_at
       FROM printing_orders WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json({ orders });
  } catch (err) {
    console.error('Printing orders error:', err);
    res.status(500).json({ error: 'Unable to load printing orders' });
  }
});

app.get('/api/printing/orders/:id/file', requireAuth, async (req, res) => {
  try {
    const order = await get('SELECT file_name,file_type,file_data FROM printing_orders WHERE id=?', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const match = String(order.file_data || '').match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return res.status(404).json({ error: 'File data is unavailable' });
    const buffer = Buffer.from(match[2], 'base64');
    res.setHeader('Content-Type', order.file_type || match[1] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(order.file_name).replace(/["\\\r\n]/g, '_')}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Printing file error:', err);
    res.status(500).json({ error: 'Unable to download file' });
  }
});

app.patch('/api/printing/orders/:id/status', requireAuth, async (req, res) => {
  const status = String(req.body?.status || '');
  if (!PRINTING_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid printing status' });
  const existing = await get('SELECT id FROM printing_orders WHERE id=?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  await run(`UPDATE printing_orders SET status=?, updated_at=datetime('now') WHERE id=?`, [status, req.params.id]);
  res.json({ success: true });
});

app.patch('/api/printing/orders/:id/payment', requireAuth, async (req, res) => {
  const payment_status = String(req.body?.payment_status || '');
  if (!PRINTING_PAYMENTS.includes(payment_status)) return res.status(400).json({ error: 'Invalid payment status' });
  const existing = await get('SELECT id FROM printing_orders WHERE id=?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  await run(`UPDATE printing_orders SET payment_status=?, updated_at=datetime('now') WHERE id=?`, [payment_status, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/printing/orders/:id', requireAuth, async (req, res) => {
  try {
    const existing = await get('SELECT id FROM printing_orders WHERE id=?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Order not found' });
    await run('DELETE FROM printing_orders WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Printing order delete error:', err);
    res.status(500).json({ error: 'Unable to delete printing order' });
  }
});

app.get('/api/printing/services/manage', requireAuth, async (req, res) => {
  const services = await all(`SELECT id,name,category,rate,cost,flat,active,icon,description FROM printing_services ORDER BY id ASC`);
  res.json({ services: services.map(s => ({ ...s, rate:Number(s.rate)||0, pageRate:Number(s.rate)||0, cost:Number(s.cost)||0, flat:Number(s.flat)===1, active:Number(s.active)===1 })) });
});

app.post('/api/printing/services', requireAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const category = String(req.body?.category || 'Notes & Assignments').trim();
  const rate = Math.max(0, Number.parseFloat(req.body?.pageRate ?? req.body?.rate) || 0);
  const cost = Math.max(0, Number.parseFloat(req.body?.cost) || 0);
  const flat = req.body?.flat ? 1 : 0;
  const icon = String(req.body?.icon || '🖨️').trim();
  const description = String(req.body?.description || '').trim();
  if (!name) return res.status(400).json({ error: 'Service name is required' });
  const result = await run(`INSERT INTO printing_services (name,category,rate,cost,flat,active,icon,description) VALUES (?,?,?,?,?,?,?,?)`, [name,category,rate,cost,flat,req.body?.active === false ? 0 : 1,icon,description]);
  res.json({ success:true, id:Number(result.lastInsertRowid) });
});

app.patch('/api/printing/services/:id', requireAuth, async (req, res) => {
  const existing = await get('SELECT id FROM printing_services WHERE id=?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Service not found' });
  const updates = ["updated_at=datetime('now')"];
  const params = [];
  if (req.body?.name !== undefined) { updates.push('name=?'); params.push(String(req.body.name).trim()); }
  if (req.body?.category !== undefined) { updates.push('category=?'); params.push(String(req.body.category).trim()); }
  if (req.body?.pageRate !== undefined || req.body?.rate !== undefined) { updates.push('rate=?'); params.push(Math.max(0, Number.parseFloat(req.body.pageRate ?? req.body.rate) || 0)); }
  if (req.body?.cost !== undefined) { updates.push('cost=?'); params.push(Math.max(0, Number.parseFloat(req.body.cost) || 0)); }
  if (req.body?.flat !== undefined) { updates.push('flat=?'); params.push(req.body.flat ? 1 : 0); }
  if (req.body?.active !== undefined) { updates.push('active=?'); params.push(req.body.active ? 1 : 0); }
  if (req.body?.icon !== undefined) { updates.push('icon=?'); params.push(String(req.body.icon)); }
  if (req.body?.description !== undefined) { updates.push('description=?'); params.push(String(req.body.description)); }
  params.push(req.params.id);
  await run(`UPDATE printing_services SET ${updates.join(', ')} WHERE id=?`, params);
  res.json({ success:true });
});

app.delete('/api/printing/services/:id', requireAuth, async (req, res) => {
  const result = await run('DELETE FROM printing_services WHERE id=?', [req.params.id]);
  if (!Number(result.rowsAffected || 0)) return res.status(404).json({ error: 'Service not found' });
  res.json({ success:true });
});

// PRODUCTS
app.get(
  '/api/admin/products',
  requireAuth,
  async (req, res) => {
    const {
      search,
      category,
      active,
      page = 1,
      limit = 20
    } = req.query;

    let where = '1=1';
    const params = [];

    if (search) {
      where +=
        ' AND (name LIKE ? OR description LIKE ? OR badge LIKE ?)';

      params.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`
      );
    }

    if (category) {
      where +=
        ' AND category = ?';

      params.push(
        category
      );
    }

    if (
      active !== undefined &&
      active !== ''
    ) {
      where +=
        ' AND active = ?';

      params.push(
        active === '1'
          ? 1
          : 0
      );
    }

    const offset =
      (parseInt(page) - 1) *
      parseInt(limit);

    const total =
      Number(
        (
          await get(
            `SELECT COUNT(*) as c FROM products WHERE ${where}`,
            params
          )
        ).c
      );

    const products =
      await all(
        `SELECT * FROM products WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [
          ...params,
          parseInt(limit),
          offset
        ]
      );

    for (
      const p of products
    ) {
      p.variants =
        await all(
          'SELECT * FROM product_variants WHERE product_id = ? AND active = 1 ORDER BY id',
          [p.id]
        );
    }

    res.json({
      products,
      total,
      page:
        parseInt(page),
      limit:
        parseInt(limit)
    });
  }
);

app.get(
  '/api/admin/products/:id',
  requireAuth,
  async (req, res) => {
    const product =
      await get(
        'SELECT * FROM products WHERE id = ?',
        [req.params.id]
      );

    if (!product) {
      return res.status(404).json({
        error:
          'Product not found'
      });
    }

    product.variants =
      await all(
        'SELECT * FROM product_variants WHERE product_id = ? ORDER BY id',
        [product.id]
      );

    res.json(product);
  }
);

app.post(
  '/api/admin/products',
  requireAuth,
  async (req, res) => {
    const {
      id,
      name,
      category,
      category_label,
      price,
      cost_price,
      rating,
      reviews_count,
      badge,
      description,
      specs,
      stock_count,
      image,
      gallery,
      tags,
      out_of_stock,
      active,
      variants
    } = req.body;

    if (
      !id ||
      !name ||
      !category ||
      price == null ||
      cost_price == null
    ) {
      return res.status(400).json({
        error:
          'id, name, category, price and cost_price required'
      });
    }

    const existing =
      await get(
        'SELECT id FROM products WHERE id = ?',
        [id]
      );

    if (existing) {
      return res.status(400).json({
        error:
          'Product ID already exists'
      });
    }

    await run(
      `INSERT INTO products (id,name,category,category_label,price,original_price,cost_price,rating,reviews_count,badge,description,specs,stock_count,image,gallery,tags,out_of_stock,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        name,
        category,
        category_label || '',
        parseFloat(price),
        parseFloat(price),
        Math.max(
          0,
          parseFloat(
            cost_price
          ) || 0
        ),
        parseFloat(
          rating
        ) || 4.8,
        parseInt(
          reviews_count
        ) || 0,
        badge || null,
        description || '',
        typeof specs ===
        'string'
          ? specs
          : JSON.stringify(
              specs || []
            ),
        parseInt(
          stock_count
        ) || 0,
        image || null,
        typeof gallery ===
        'string'
          ? gallery
          : JSON.stringify(
              gallery || []
            ),
        typeof tags ===
        'string'
          ? tags
          : JSON.stringify(
              tags || []
            ),
        out_of_stock ? 1 : 0,
        active === false
          ? 0
          : 1
      ]
    );

    if (
      Array.isArray(
        variants
      )
    ) {
      for (
        const v of variants
      ) {
        await run(
          `INSERT INTO product_variants (product_id,product_name,label,price,cost,stock,active,image) VALUES (?,?,?,?,?,?,?,?)`,
          [
            id,
            name,
            v.label || '',
            parseFloat(
              v.price
            ) || 0,
            Math.max(
              0,
              parseFloat(
                v.cost
              ) || 0
            ),
            parseInt(
              v.stock
            ) || 0,
            v.active ===
            false
              ? 0
              : 1,
            v.image || ''
          ]
        );
      }
    }

    res.json({
      success: true,
      id
    });
  }
);

app.put(
  '/api/admin/products/:id',
  requireAuth,
  async (req, res) => {
    const pid =
      req.params.id;

    const existing =
      await get(
        'SELECT id,name FROM products WHERE id = ?',
        [pid]
      );

    if (!existing) {
      return res.status(404).json({
        error:
          'Product not found'
      });
    }

    const {
      name,
      category,
      category_label,
      price,
      original_price,
      cost_price,
      rating,
      reviews_count,
      badge,
      description,
      specs,
      stock_count,
      image,
      gallery,
      tags,
      out_of_stock,
      active,
      variants
    } = req.body;

    const updates = [
      "updated_at = datetime('now')"
    ];

    const params = [];

    if (name !== undefined) {
      updates.push(
        'name = ?'
      );
      params.push(name);
    }

    if (
      category !== undefined
    ) {
      updates.push(
        'category = ?'
      );
      params.push(category);
    }

    if (
      category_label !== undefined
    ) {
      updates.push(
        'category_label = ?'
      );
      params.push(
        category_label
      );
    }

    if (
      price !== undefined
    ) {
      updates.push(
        'price = ?'
      );
      params.push(
        parseFloat(price)
      );
    }

    if (
      original_price !== undefined
    ) {
      updates.push(
        'original_price = ?'
      );
      params.push(
        parseFloat(
          original_price
        )
      );
    }

    if (
      cost_price !== undefined
    ) {
      updates.push(
        'cost_price = ?'
      );

      params.push(
        Math.max(
          0,
          parseFloat(
            cost_price
          ) || 0
        )
      );
    }

    if (
      rating !== undefined
    ) {
      updates.push(
        'rating = ?'
      );

      params.push(
        parseFloat(
          rating
        )
      );
    }

    if (
      reviews_count !== undefined
    ) {
      updates.push(
        'reviews_count = ?'
      );

      params.push(
        parseInt(
          reviews_count
        )
      );
    }

    if (
      badge !== undefined
    ) {
      updates.push(
        'badge = ?'
      );

      params.push(
        badge
      );
    }

    if (
      description !== undefined
    ) {
      updates.push(
        'description = ?'
      );

      params.push(
        description
      );
    }

    if (
      specs !== undefined
    ) {
      updates.push(
        'specs = ?'
      );

      params.push(
        typeof specs ===
        'string'
          ? specs
          : JSON.stringify(
              specs
            )
      );
    }

    if (
      stock_count !== undefined
    ) {
      updates.push(
        'stock_count = ?'
      );

      params.push(
        parseInt(
          stock_count
        )
      );
    }

    if (
      image !== undefined
    ) {
      updates.push(
        'image = ?'
      );

      params.push(
        image
      );
    }

    if (
      gallery !== undefined
    ) {
      updates.push(
        'gallery = ?'
      );

      params.push(
        typeof gallery ===
        'string'
          ? gallery
          : JSON.stringify(
              gallery
            )
      );
    }

    if (
      tags !== undefined
    ) {
      updates.push(
        'tags = ?'
      );

      params.push(
        typeof tags ===
        'string'
          ? tags
          : JSON.stringify(
              tags
            )
      );
    }

    if (out_of_stock !== undefined) {
      updates.push('out_of_stock = ?');
      params.push(out_of_stock ? 1 : 0);
    }

    if (
      active !== undefined
    ) {
      updates.push(
        'active = ?'
      );

      params.push(
        active
          ? 1
          : 0
      );
    }

    params.push(pid);

    await run(
      `UPDATE products SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    if (
      Array.isArray(
        variants
      )
    ) {
      await run(
        'DELETE FROM product_variants WHERE product_id = ?',
        [pid]
      );

      const pName =
        name ||
        existing.name;

      for (
        const v of variants
      ) {
        await run(
          `INSERT INTO product_variants (product_id,product_name,label,price,cost,stock,active,image) VALUES (?,?,?,?,?,?,?,?)`,
          [
            pid,
            pName,
            v.label || '',
            parseFloat(
              v.price
            ) || 0,
            Math.max(
              0,
              parseFloat(
                v.cost
              ) || 0
            ),
            parseInt(
              v.stock
            ) || 0,
            v.active ===
            false
              ? 0
              : 1,
            v.image || ''
          ]
        );
      }
    }

    res.json({
      success: true
    });
  }
);

app.delete(
  '/api/admin/products/:id',
  requireAuth,
  async (req, res) => {
    await run(
      'DELETE FROM product_variants WHERE product_id = ?',
      [req.params.id]
    );

    await run(
      'DELETE FROM products WHERE id = ?',
      [req.params.id]
    );

    res.json({
      success: true
    });
  }
);

app.get(
  '/api/admin/products/categories/list',
  requireAuth,
  async (req, res) => {
    const rows =
      await all(
        "SELECT DISTINCT category, category_label FROM products WHERE category != '' ORDER BY category"
      );

    res.json(rows);
  }
);

// Always return JSON for API failures.
app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    console.error(
      'API error:',
      err
    );

    if (
      res.headersSent
    ) {
      return next(err);
    }

    res.status(500).json({
      error:
        'Server error. Please try again.'
    });
  }
);

module.exports = app;
