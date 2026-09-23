require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[meridian] WARNING: ADMIN_PASSWORD is not set in .env — using the default "change-me". Set a strong password before deploying.');
}

// ---------- tiny JSON-file datastore ----------
// Good enough for a small/medium courier site. If you outgrow it (heavy
// concurrent writes, thousands of shipments/day), swap this module for a
// real database — see README.md "Growing beyond the file store".
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ packages: {} }, null, 2));
}
function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { packages: {} };
  }
}
function writeStore(data) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---------- helpers ----------
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdmin(req, res, next) {
  const pw = req.get('x-admin-password') || '';
  if (!pw || !safeEqual(pw, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function genTrackingNumber() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let body = '';
  for (let i = 0; i < 9; i++) body += chars[Math.floor(Math.random() * chars.length)];
  return 'MC-' + body;
}

function cleanStr(v, max) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return max ? s.slice(0, max) : s;
}

function validatePartyOrError(party, label) {
  if (!party || typeof party !== 'object') return `${label} is required`;
  if (!cleanStr(party.name)) return `${label} name is required`;
  if (!cleanStr(party.city)) return `${label} city is required`;
  if (!cleanStr(party.country)) return `${label} country is required`;
  return null;
}

// ---------- app ----------
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password && safeEqual(password, ADMIN_PASSWORD)) return res.json({ ok: true });
  res.status(401).json({ ok: false, error: 'Incorrect password' });
});

// Public: look up a single shipment
app.get('/api/packages/:number', (req, res) => {
  const store = readStore();
  const num = cleanStr(req.params.number).toUpperCase();
  const pkg = store.packages[num];
  if (!pkg) return res.status(404).json({ error: 'No shipment found for that tracking number' });
  res.json({ trackingNumber: num, ...pkg });
});

// Admin: list recent shipments
app.get('/api/packages', requireAdmin, (req, res) => {
  const store = readStore();
  const list = Object.keys(store.packages).map((num) => ({
    trackingNumber: num,
    status: store.packages[num].status,
    createdAt: store.packages[num].createdAt,
  }));
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ packages: list.slice(0, 50) });
});

// Admin: create a shipment
app.post('/api/packages', requireAdmin, (req, res) => {
  const body = req.body || {};

  const senderErr = validatePartyOrError(body.sender, 'Sender');
  if (senderErr) return res.status(400).json({ error: senderErr });
  const receiverErr = validatePartyOrError(body.receiver, 'Receiver');
  if (receiverErr) return res.status(400).json({ error: receiverErr });
  if (!cleanStr(body.description)) return res.status(400).json({ error: 'Package description is required' });

  const store = readStore();
  let number = null;
  for (let i = 0; i < 8; i++) {
    const candidate = genTrackingNumber();
    if (!store.packages[candidate]) { number = candidate; break; }
  }
  if (!number) return res.status(500).json({ error: 'Could not generate a unique tracking number, try again' });

  const now = new Date().toISOString();
  const sender = {
    name: cleanStr(body.sender.name, 120),
    city: cleanStr(body.sender.city, 80),
    country: cleanStr(body.sender.country, 80),
  };
  const receiver = {
    name: cleanStr(body.receiver.name, 120),
    city: cleanStr(body.receiver.city, 80),
    country: cleanStr(body.receiver.country, 80),
  };

  const pkg = {
    sender,
    receiver,
    description: cleanStr(body.description, 200),
    weight: Number.isFinite(Number(body.weight)) ? Number(body.weight) : 0,
    service: cleanStr(body.service, 40) || 'Standard',
    estimatedDelivery: cleanStr(body.estimatedDelivery, 40) || null,
    status: 'Order Created',
    createdAt: now,
    updatedAt: now,
    history: [{
      status: 'Order Created',
      location: `${sender.city}, ${sender.country}`,
      note: 'Shipment registered with Meridian Courier.',
      timestamp: now,
    }],
  };

  store.packages[number] = pkg;
  writeStore(store);
  res.status(201).json({ trackingNumber: number, ...pkg });
});

// Admin: log a tracking event
app.post('/api/packages/:number/events', requireAdmin, (req, res) => {
  const store = readStore();
  const num = cleanStr(req.params.number).toUpperCase();
  const pkg = store.packages[num];
  if (!pkg) return res.status(404).json({ error: 'No shipment found for that tracking number' });

  const status = cleanStr(req.body && req.body.status, 60);
  const location = cleanStr(req.body && req.body.location, 120);
  const note = cleanStr(req.body && req.body.note, 300);
  if (!status) return res.status(400).json({ error: 'Status is required' });
  if (!location) return res.status(400).json({ error: 'Location is required' });

  const now = new Date().toISOString();
  pkg.history.push({ status, location, note, timestamp: now });
  pkg.status = status;
  pkg.updatedAt = now;
  writeStore(store);
  res.json({ trackingNumber: num, ...pkg });
});

// Everything else -> the single-page app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Meridian Courier listening on http://localhost:${PORT}`);
});
