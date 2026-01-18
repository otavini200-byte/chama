const express = require("express");
const cors = require("cors");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// =====================
// CONFIG
// =====================
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "CHAMA_SECRET_DEV_ONLY";
const DB_PATH = path.join(__dirname, "db.sqlite");

const COMPANY_DAYS = 31;
const MS_DAY = 24 * 60 * 60 * 1000;

// =====================
// DB
// =====================
const db = new sqlite3.Database(DB_PATH);

// =====================
// HELPERS
// =====================
function nowMs() { return Date.now(); }
function addDays(ms, days) { return ms + days * MS_DAY; }
function safeText(v, max = 4000) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}
function normalizeLogin(v) { return safeText(v, 120).toLowerCase(); }
function signToken(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" }); }
function onlyDigits(str) { return String(str || "").replace(/\D/g, ""); }
function isCNPJValid(cnpj) { return onlyDigits(cnpj).length === 14; }

function genCompanyKey(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// =====================
// AUTH MIDDLEWARE
// =====================
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ ok: false, message: "Sem token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    db.get(
      `
      SELECT 
        u.id, u.company_id, u.username, u.email, u.role,
        c.company_key as company_key,
        c.expires_at as company_expires_at
      FROM users u
      LEFT JOIN companies c ON c.id = u.company_id
      WHERE u.id = ?
      `,
      [decoded.id],
      (err, row) => {
        if (err || !row) return res.status(401).json({ ok: false, message: "Token inválido" });

        // bloqueia empresa vencida (exceto DEV)
        if (row.role !== "dev" && row.company_id) {
          if (row.company_expires_at && Number(row.company_expires_at) < nowMs()) {
            return res.status(403).json({ ok: false, message: "Empresa vencida. Fale com o DEV." });
          }
        }

        req.user = row;
        next();
      }
    );
  } catch {
    return res.status(401).json({ ok: false, message: "Token inválido" });
  }
}

function devOnly(req, res, next) {
  if (!req.user || req.user.role !== "dev") {
    return res.status(403).json({ ok: false, message: "Acesso DEV somente." });
  }
  next();
}

// =====================
// CREATE TABLES
// =====================
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_key TEXT UNIQUE,
      name TEXT,
      cnpj TEXT,
      email TEXT,
      phone TEXT,
      notes TEXT,
      created_at INTEGER,
      expires_at INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      username TEXT,
      email TEXT,
      password_hash TEXT,
      role TEXT,
      created_at INTEGER,
      UNIQUE(company_id, username),
      UNIQUE(email)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      user_id INTEGER,
      title TEXT,
      description TEXT,
      status TEXT DEFAULT 'OPEN',
      scan_json TEXT,
      assigned_operator_id INTEGER,
      claimed_at INTEGER,
      resolved_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  // ✅ cria DEV se não existir
  const devUser = "otavio";
  const devEmail = "otavini200@gmail.com";
  const devPass = "26106867";

  db.get(
    `SELECT id FROM users WHERE username=? OR email=?`,
    [devUser, devEmail],
    async (err, row) => {
      if (!row) {
        const hash = await bcrypt.hash(devPass, 10);
        db.run(
          `INSERT INTO users (company_id, username, email, password_hash, role, created_at)
           VALUES (NULL,?,?,?,?,?)`,
          [devUser, devEmail, hash, "dev", nowMs()],
          () => console.log(`✅ Conta DEV criada: ${devUser} | senha: ${devPass}`)
        );
      }
    }
  );
});

// =====================
// ROUTES
// =====================
app.get("/api/health", (req, res) => res.json({ ok: true, message: "Server online" }));

// ✅ VALIDAR CHAVE
app.post("/api/company/validate-key", (req, res) => {
  const company_key = safeText(req.body?.company_key, 80).toUpperCase();
  if (!company_key) return res.status(400).json({ ok: false, message: "Informe a chave." });

  db.get(
    `SELECT id, company_key, name, expires_at FROM companies WHERE company_key=?`,
    [company_key],
    (err, c) => {
      if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
      if (!c) return res.status(404).json({ ok: false, message: "❌ Chave não encontrada." });

      const expired = c.expires_at && Number(c.expires_at) < nowMs();
      const days_left = c.expires_at ? Math.ceil((Number(c.expires_at) - nowMs()) / MS_DAY) : null;

      if (expired) {
        return res.status(403).json({ ok: false, message: "❌ Chave vencida.", company: { ...c, expired, days_left } });
      }

      return res.json({ ok: true, message: "✅ Chave válida!", company: { ...c, expired: false, days_left } });
    }
  );
});

app.post("/api/check-username", (req, res) => {
  const username = normalizeLogin(req.body?.username);
  if (!username) return res.json({ ok: true, available: false });

  db.get(`SELECT id FROM users WHERE username=?`, [username], (err, row) => {
    if (err) return res.status(500).json({ ok: false });
    return res.json({ ok: true, available: !row });
  });
});

// =====================
// SIGNUP
// =====================
app.post("/api/signup", (req, res) => {
  const company_key = safeText(req.body?.company_key, 80).toUpperCase();
  const username = normalizeLogin(req.body?.username);
  const email = normalizeLogin(req.body?.email);
  const password = String(req.body?.password || "");
  const confirm = String(req.body?.confirm || "");
  const role = req.body?.role === "operator" ? "operator" : "client";

  if (!company_key || !username || !email || !password || !confirm) {
    return res.status(400).json({ ok: false, message: "Preencha tudo." });
  }
  if (password.length < 6) return res.status(400).json({ ok: false, message: "Senha mínima: 6 caracteres." });
  if (password !== confirm) return res.status(400).json({ ok: false, message: "Senhas não conferem." });

  db.get(`SELECT id, expires_at, name FROM companies WHERE company_key=?`, [company_key], async (err, c) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
    if (!c?.id) return res.status(401).json({ ok: false, message: "❌ Chave de empresa inválida ou inativa." });

    if (c.expires_at && Number(c.expires_at) < nowMs()) {
      return res.status(403).json({ ok: false, message: "❌ Empresa vencida. Fale com o DEV." });
    }

    const hash = await bcrypt.hash(password, 10);

    db.run(
      `INSERT INTO users (company_id, username, email, password_hash, role, created_at)
       VALUES (?,?,?,?,?,?)`,
      [c.id, username, email, hash, role, nowMs()],
      function (err2) {
        if (err2) {
          const msg = String(err2.message || "");
          if (msg.includes("UNIQUE") && msg.includes("email")) return res.status(409).json({ ok: false, message: "Email já em uso." });
          if (msg.includes("UNIQUE") && msg.includes("username")) return res.status(409).json({ ok: false, message: "Usuário indisponível." });
          return res.status(500).json({ ok: false, message: "Erro ao criar conta." });
        }
        return res.json({ ok: true, message: `✅ Conta criada na empresa: ${c.name || company_key}` });
      }
    );
  });
});

// =====================
// LOGIN
// =====================
app.post("/api/login", (req, res) => {
  const login = normalizeLogin(req.body?.login);
  const password = String(req.body?.password || "");
  if (!login || !password) return res.status(400).json({ ok: false, message: "Preencha tudo." });

  db.get(
    `
    SELECT 
      u.id, u.company_id, u.username, u.email, u.password_hash, u.role,
      c.expires_at as company_expires_at
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    WHERE u.username=? OR u.email=?
    `,
    [login, login],
    async (err, row) => {
      if (err || !row) return res.status(401).json({ ok: false, message: "Login inválido." });

      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) return res.status(401).json({ ok: false, message: "Login inválido." });

      if (row.role !== "dev" && row.company_id && row.company_expires_at && Number(row.company_expires_at) < nowMs()) {
        return res.status(403).json({ ok: false, message: "Empresa vencida. Fale com o DEV." });
      }

      const token = signToken({ id: row.id });
      return res.json({
        ok: true,
        token,
        payload: { id: row.id, company_id: row.company_id, username: row.username, email: row.email, role: row.role }
      });
    }
  );
});

app.get("/api/me", auth, (req, res) => res.json({ ok: true, payload: req.user }));

// =====================
// DEV: LIST COMPANIES + ALERTS
// =====================
app.get("/api/dev/companies", auth, devOnly, (req, res) => {
  const now = nowMs();

  db.all(
    `
    SELECT
      c.id,
      c.company_key,
      c.name,
      c.cnpj,
      c.email,
      c.phone,
      c.notes,
      c.created_at,
      c.expires_at,
      (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) as users_total,
      (SELECT COUNT(*) FROM tickets t WHERE t.company_id = c.id) as tickets_total
    FROM companies c
    ORDER BY c.expires_at ASC
  `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });

      const companies = (rows || []).map((c) => {
        const exp = Number(c.expires_at || 0);
        const days_left = exp ? Math.ceil((exp - now) / MS_DAY) : null;
        const expired = exp && exp < now;
        const expiring_soon = !expired && days_left !== null && days_left <= 7;
        return { ...c, days_left, expired, expiring_soon };
      });

      const alerts = {
        expired: companies.filter(x => x.expired).length,
        expiring_soon: companies.filter(x => x.expiring_soon).length
      };

      return res.json({ ok: true, companies, alerts });
    }
  );
});

// DEV CREATE COMPANY
app.post("/api/dev/companies/create", auth, devOnly, (req, res) => {
  let key = String(req.body?.company_key || "").trim().toUpperCase();
  if (!key) key = genCompanyKey(10);

  const name = safeText(req.body?.name, 120);
  const cnpj = safeText(req.body?.cnpj, 40);
  const email = normalizeLogin(req.body?.email);
  const phone = safeText(req.body?.phone, 50);
  const notes = safeText(req.body?.notes, 500);

  if (!name) return res.status(400).json({ ok: false, message: "Nome da empresa é obrigatório." });
  if (!cnpj || !isCNPJValid(cnpj)) return res.status(400).json({ ok: false, message: "CNPJ inválido (14 dígitos)." });

  const created = nowMs();
  const expires_at = addDays(created, COMPANY_DAYS);

  db.run(
    `INSERT INTO companies (company_key, name, cnpj, email, phone, notes, created_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [key, name, onlyDigits(cnpj), email, phone, notes, created, expires_at],
    function (err) {
      if (err) {
        const msg = String(err.message || "");
        if (msg.includes("UNIQUE")) return res.status(409).json({ ok: false, message: "Chave já existe, tente outra." });
        return res.status(500).json({ ok: false, message: "Erro ao criar empresa." });
      }
      return res.json({
        ok: true,
        message: "✅ Empresa criada!",
        company: { id: this.lastID, company_key: key, name, cnpj: onlyDigits(cnpj), email, phone, notes, created_at: created, expires_at }
      });
    }
  );
});

// ✅ DEV: RENOVAR CONTRATO (+31 DIAS)
app.post("/api/dev/companies/:id/extend", auth, devOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const days = parseInt(req.body?.days || COMPANY_DAYS, 10);

  if (!id) return res.status(400).json({ ok: false, message: "ID inválido." });
  if (!days || days < 1 || days > 365) return res.status(400).json({ ok: false, message: "Dias inválidos." });

  db.get(`SELECT id, expires_at FROM companies WHERE id=?`, [id], (err, c) => {
    if (err || !c) return res.status(404).json({ ok: false, message: "Empresa não encontrada." });

    const currentExp = Number(c.expires_at || 0);
    const base = currentExp > nowMs() ? currentExp : nowMs(); // se já venceu, renova a partir de HOJE
    const newExp = addDays(base, days);

    db.run(
      `UPDATE companies SET expires_at=? WHERE id=?`,
      [newExp, id],
      (err2) => {
        if (err2) return res.status(500).json({ ok: false, message: "Erro ao renovar contrato." });
        return res.json({ ok: true, message: `✅ Contrato renovado +${days} dias.`, expires_at: newExp });
      }
    );
  });
});

// =====================
// TICKETS
// =====================
app.post("/api/tickets/create", auth, (req, res) => {
  const u = req.user;
  if (u.role !== "client" && u.role !== "dev") return res.status(403).json({ ok: false, message: "Somente cliente abre chamado." });

  const title = safeText(req.body?.title, 120);
  const description = safeText(req.body?.description, 4000);
  const scan = req.body?.scan || null;

  if (!title || !description) return res.status(400).json({ ok: false, message: "Preencha título e descrição." });

  let scan_json = null;
  try { scan_json = scan ? JSON.stringify(scan).slice(0, 150000) : null; } catch { scan_json = null; }

  const created = nowMs();

  db.run(
    `INSERT INTO tickets (company_id, user_id, title, description, status, scan_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [u.company_id, u.id, title, description, "OPEN", scan_json, created, created],
    function (err) {
      if (err) return res.status(500).json({ ok: false, message: "Erro ao criar chamado." });
      return res.json({ ok: true, ticket_id: this.lastID });
    }
  );
});

app.get("/api/tickets/my", auth, (req, res) => {
  const u = req.user;
  db.all(`SELECT * FROM tickets WHERE user_id=? ORDER BY updated_at DESC`, [u.id], (err, rows) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
    return res.json({ ok: true, tickets: rows || [] });
  });
});

// operador normal
app.get("/api/operator/tickets/open", auth, (req, res) => {
  const u = req.user;
  if (u.role !== "operator" && u.role !== "dev") return res.status(403).json({ ok: false, message: "Acesso negado." });

  const params = [];
  let where = `WHERE t.status != 'RESOLVED'`;
  if (u.role !== "dev") { where += ` AND t.company_id = ?`; params.push(u.company_id); }

  db.all(
    `
    SELECT t.*, c.username as client_username, c.email as client_email
    FROM tickets t
    LEFT JOIN users c ON c.id = t.user_id
    ${where}
    ORDER BY t.created_at DESC
    `,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });

      const tickets = (rows || []).map(t => {
        let scan = null;
        try { scan = t.scan_json ? JSON.parse(t.scan_json) : null; } catch { scan = null; }
        return { ...t, scan };
      });

      return res.json({ ok: true, tickets });
    }
  );
});

app.get("/api/tickets/:id", auth, (req, res) => {
  const id = parseInt(req.params.id, 10);

  db.get(
    `
    SELECT t.*, c.username as client_username, c.email as client_email
    FROM tickets t
    LEFT JOIN users c ON c.id = t.user_id
    WHERE t.id=?
    `,
    [id],
    (err, t) => {
      if (err || !t) return res.status(404).json({ ok: false, message: "Chamado não encontrado." });

      let scan = null;
      try { scan = t.scan_json ? JSON.parse(t.scan_json) : null; } catch { scan = null; }

      return res.json({ ok: true, ticket: { ...t, scan } });
    }
  );
});

// =====================
// SOCKET.IO (sinalização remoto - base)
// =====================
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

io.on("connection", (socket) => {
  socket.on("joinTicket", ({ ticketId }) => socket.join(`ticket_${ticketId}`));

  socket.on("signalOffer", ({ ticketId, offer }) => {
    socket.to(`ticket_${ticketId}`).emit("signalOffer", { ticketId, offer });
  });

  socket.on("signalAnswer", ({ ticketId, answer }) => {
    socket.to(`ticket_${ticketId}`).emit("signalAnswer", { ticketId, answer });
  });

  socket.on("signalIce", ({ ticketId, candidate }) => {
    socket.to(`ticket_${ticketId}`).emit("signalIce", { ticketId, candidate });
  });
});

server.listen(PORT, () => console.log("✅ Server ON na porta", PORT));
