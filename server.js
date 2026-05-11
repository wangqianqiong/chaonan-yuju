const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const dbFile = path.join(__dirname, 'data.db');

// ---- 数据库初始化 ----
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT DEFAULT '其他',
    price REAL NOT NULL DEFAULT 0,
    price2 REAL DEFAULT 0,
    unit TEXT DEFAULT '把',
    stock INTEGER DEFAULT 0,
    image TEXT DEFAULT '',
    icon TEXT DEFAULT '☂️',
    description TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT DEFAULT '',
    total REAL NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    total_orders INTEGER DEFAULT 0,
    total_spent REAL DEFAULT 0,
    first_order_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_order_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 数据库迁移：新增字段
try { db.exec("ALTER TABLE products ADD COLUMN price2 REAL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE products ADD COLUMN image TEXT DEFAULT ''"); } catch(e) {}

// 默认设置
const defaultSettings = {
  shop_name: '辉煌帐篷雨具批发部',
  shop_phone: '',
  shop_wechat: '',
  admin_password: '123456',
  price_level_name: '零售价',
  price_level_name2: '批发价',
  price_level_default: '1'
};
for (const [k, v] of Object.entries(defaultSettings)) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
  if (!row) db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(k, String(v));
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

// ---- 中间件 ----
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'chaonan-yuju-' + crypto.randomBytes(8).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// 图片上传
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('仅支持 jpg/png/gif/webp 格式'));
  }
});

function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  const pwd = req.headers['x-admin-password'];
  if (pwd && pwd === getSetting('admin_password')) {
    req.session.admin = true;
    return next();
  }
  return res.status(401).json({ error: '请先登录管理后台' });
}

// ---- 公开 API ----

// 获取店铺信息
app.get('/api/shop', (req, res) => {
  res.json({
    name: getSetting('shop_name'),
    phone: getSetting('shop_phone'),
    wechat: getSetting('shop_wechat'),
    priceLevelName: getSetting('price_level_name') || '零售价',
    priceLevelName2: getSetting('price_level_name2') || '批发价'
  });
});

// 获取商品列表（只返回上架的商品）
app.get('/api/products', (req, res) => {
  const cat = req.query.category;
  let sql = 'SELECT * FROM products WHERE active = 1';
  const params = [];
  if (cat && cat !== 'all') { sql += ' AND category = ?'; params.push(cat); }
  sql += ' ORDER BY sort_order ASC, id DESC';
  const products = db.prepare(sql).all(...params);
  res.json(products);
});

// 获取商品分类
app.get('/api/categories', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT category FROM products WHERE active = 1 ORDER BY category').all();
  res.json(rows.map(r => r.category));
});

// 提交订单
app.post('/api/orders', (req, res) => {
  const { customer_name, customer_phone, items, note } = req.body;
  if (!customer_name) return res.status(400).json({ error: '请填写姓名或店名' });
  if (!customer_phone || !/^1\d{10}$/.test(customer_phone)) return res.status(400).json({ error: '请输入正确的11位手机号' });
  if (!items || items.length === 0) return res.status(400).json({ error: '请选择商品' });

  let total = 0;
  for (const item of items) {
    total += (item.price || 0) * (item.quantity || 1);
  }

  const getStock = db.prepare('SELECT stock FROM products WHERE id = ?');
  const insertOrder = db.prepare('INSERT INTO orders (customer_name, customer_phone, total, note, status) VALUES (?, ?, ?, ?, ?)');
  const insertItem = db.prepare('INSERT INTO order_items (order_id, product_name, price, quantity) VALUES (?, ?, ?, ?)');
  const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
  const findCustomer = db.prepare('SELECT * FROM customers WHERE phone = ? OR (name = ? AND phone = ?)');
  const insertCustomer = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)');
  const updateCustomer = db.prepare('UPDATE customers SET total_orders = total_orders + 1, total_spent = total_spent + ?, last_order_at = CURRENT_TIMESTAMP WHERE id = ?');

  const trx = db.transaction(() => {
    // 先检查所有商品的库存
    for (const item of items) {
      if (item.product_id) {
        const row = getStock.get(item.product_id);
        if (!row) throw new Error('商品不存在: ' + (item.name || ''));
        if (row.stock < item.quantity) throw new Error('库存不足: ' + (item.name || '') + ' (剩余' + row.stock + ', 需要' + item.quantity + ')');
      }
    }
    // 库存都够，才创建订单和扣减
    const result = insertOrder.run(customer_name, customer_phone, total, note || '', 'pending');
    const orderId = result.lastInsertRowid;
    for (const item of items) {
      insertItem.run(orderId, item.name, item.price, item.quantity);
      if (item.product_id) {
        updateStock.run(item.quantity, item.product_id);
      }
    }
    // 自动保存客户
    const existing = findCustomer.get(customer_phone, customer_name, customer_phone);
    if (existing) {
      updateCustomer.run(total, existing.id);
    } else {
      insertCustomer.run(customer_name, customer_phone);
    }
    return orderId;
  });

  try {
    const orderId = trx();
    res.json({ success: true, order_id: orderId, total });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- 管理 API ----

// 登录
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === getSetting('admin_password')) {
    req.session.admin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: '密码错误' });
});

// 登出
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// 检查登录状态
app.get('/api/admin/check', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.admin) });
});

// 图片上传
app.post('/api/admin/upload', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '上传失败' });
    if (!req.file) return res.status(400).json({ error: '请选择图片' });
    res.json({ success: true, url: '/uploads/' + req.file.filename });
  });
});

// 删除图片
app.delete('/api/admin/upload/:filename', requireAuth, (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e) {}
  res.json({ success: true });
});

// ---- 客户管理 ----
app.get('/api/admin/customers', requireAuth, (req, res) => {
  const q = req.query.q;
  let sql = 'SELECT * FROM customers';
  const params = [];
  if (q && q.trim()) {
    sql += ' WHERE name LIKE ? OR phone LIKE ?';
    params.push(`%${q.trim()}%`, `%${q.trim()}%`);
  }
  sql += ' ORDER BY last_order_at DESC LIMIT 50';
  res.json(db.prepare(sql).all(...params));
});

// ---- 商品管理 ----
app.get('/api/admin/products', requireAuth, (req, res) => {
  const cat = req.query.category;
  let sql = 'SELECT * FROM products';
  const params = [];
  if (cat && cat !== 'all') { sql += ' WHERE category = ?'; params.push(cat); }
  sql += ' ORDER BY sort_order ASC, id DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/admin/products', requireAuth, (req, res) => {
  const { name, category, price, price2, unit, stock, image, icon, description } = req.body;
  if (!name) return res.status(400).json({ error: '商品名不能为空' });
  const r = db.prepare('INSERT INTO products (name, category, price, price2, unit, stock, image, icon, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    name, category || '其他', parseFloat(price) || 0, parseFloat(price2) || 0, unit || '把', parseInt(stock) || 0,
    image || '', icon || '☂️', description || ''
  );
  res.json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/admin/products/:id', requireAuth, (req, res) => {
  const { name, category, price, price2, unit, stock, image, icon, description, active } = req.body;
  const p = db.prepare('UPDATE products SET name=?, category=?, price=?, price2=?, unit=?, stock=?, image=?, icon=?, description=?, active=? WHERE id=?');
  p.run(
    name, category || '其他', parseFloat(price) || 0, parseFloat(price2) || 0, unit || '把', parseInt(stock) || 0,
    image || '', icon || '☂️', description || '',
    active !== undefined ? (active ? 1 : 0) : 1,
    req.params.id
  );
  res.json({ success: true });
});

app.delete('/api/admin/products/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/categories', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT DISTINCT category FROM products ORDER BY category').all();
  res.json(rows.map(r => r.category));
});

// ---- 订单管理 ----
app.get('/api/admin/orders', requireAuth, (req, res) => {
  const status = req.query.status;
  let sql = 'SELECT * FROM orders';
  const params = [];
  if (status && status !== 'all') { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY id DESC';
  const orders = db.prepare(sql).all(...params);

  const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  for (const o of orders) {
    o.items = getItems.all(o.id);
  }
  res.json(orders);
});

app.put('/api/admin/orders/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'shipped', 'done'].includes(status)) return res.status(400).json({ error: '无效状态' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/orders/:id', requireAuth, (req, res) => {
  const trx = db.transaction(() => {
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(req.params.id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  });
  trx();
  res.json({ success: true });
});

// 导出订单为CSV
app.get('/api/admin/orders/export', requireAuth, (req, res) => {
  const status = req.query.status;
  let sql = 'SELECT * FROM orders';
  const params = [];
  if (status && status !== 'all') { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY id DESC';
  const orders = db.prepare(sql).all(...params);

  const getItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const statusMap = { pending: '待处理', shipped: '已发货', done: '已完成' };

  // BOM for Excel UTF-8
  let csv = '﻿';
  csv += '订单号,客户,手机号,商品明细,合计,状态,备注,下单时间\n';
  for (const o of orders) {
    o.items = getItems.all(o.id);
    const itemsStr = o.items.map(it => `${it.product_name}×${it.quantity}`).join('、');
    const row = [
      o.id,
      o.customer_name,
      o.customer_phone,
      itemsStr,
      o.total.toFixed(2),
      statusMap[o.status] || o.status,
      (o.note || '').replace(/"/g, '""'),
      o.created_at ? o.created_at.replace('T', ' ').slice(0, 19) : ''
    ].map(v => `"${v}"`).join(',');
    csv += row + '\n';
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
  res.send(csv);
});

// ---- 设置管理 ----
app.get('/api/admin/settings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  res.json(obj);
});

app.put('/api/admin/settings', requireAuth, (req, res) => {
  const allowed = ['shop_name', 'shop_phone', 'shop_wechat', 'admin_password', 'price_level_name', 'price_level_name2', 'price_level_default'];
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) setSetting(k, String(v));
  }
  res.json({ success: true });
});

// ---- 统计数据 ----
app.get('/api/admin/stats', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const todayOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE date(created_at) = ?").get(today).c;
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
  const totalRevenue = db.prepare('SELECT COALESCE(SUM(total),0) as s FROM orders').get().s;
  const totalProducts = db.prepare('SELECT COUNT(*) as c FROM products WHERE active = 1').get().c;
  const lowStock = db.prepare("SELECT COUNT(*) as c FROM products WHERE active = 1 AND stock > 0 AND stock < 20").get().c;
  const totalCustomers = db.prepare('SELECT COUNT(*) as c FROM customers').get().c;

  res.json({
    totalOrders, todayOrders, pendingOrders,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalProducts, lowStock, totalCustomers
  });
});

// ---- 全局错误处理 ----
app.use((err, req, res, next) => {
  console.error('服务器错误:', err.message);
  res.status(500).json({ error: '服务器内部错误' });
});

// ---- 前端路由 ----
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- 启动 ----
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 潮南雨具系统已启动: http://localhost:${PORT}`);
});
