const express = require("express");
const cors = require("cors");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

/**
 * ✅ CONFIG
 */
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "CHAMA_SECRET_DEV_ONLY";
const DB_PATH = path.join(__dirname, "db.sqlite");
const COMPANY_DAYS = 31;
const MS_DAY = 24 * 60 * 60 * 1000;

/**
 * ✅ STATIC (Public com P maiúsculo)
 */
app.use(express.static(path.join(__dirname, "Public")));

/**
 * ✅ DB
 */
const db = new sqlite3.Database(DB_PATH);

// ---------- helpers ----------
function nowMs() { return Date.now(); }
function addDays(ms, days) { return ms + days * MS_DAY; }

function safeText(v, max = 4000) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}
function normalizeLogin(v) {
  return safeText(v, 120).toLowerCase();
}
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

function genCompanyKey(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

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

        // ✅ bloqueia conta de empresa vencida (não bloqueia DEV)
        if (row.role !== "dev" && row.company_id) {
          if (row.company_expires_at && Number(row.company_expires_at) < nowMs()) {
            return res.status(403).json({
              ok: false,
              message: "Empresa vencida. Fale com o administrador para renovar."
            });
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

// ---------- create tables ----------
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_key TEXT UNIQUE,
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

  db.run(`
    CREATE TABLE IF NOT EXISTS remote_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER UNIQUE,
      status TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      closed_at INTEGER
    )
  `);

  // ✅ migrations safe
  db.run(`ALTER TABLE companies ADD COLUMN expires_at INTEGER`, () => {});
  db.run(`ALTER TABLE tickets ADD COLUMN scan_json TEXT`, () => {});
  db.run(`ALTER TABLE tickets ADD COLUMN assigned_operator_id INTEGER`, () => {});
  db.run(`ALTER TABLE tickets ADD COLUMN claimed_at INTEGER`, () => {});
  db.run(`ALTER TABLE tickets ADD COLUMN resolved_at INTEGER`, () => {});

  // ✅ se existe empresa sem expires_at, seta +31 dias
  db.all(`SELECT id, created_at, expires_at FROM companies`, [], (err, rows) => {
    if (err || !rows) return;
    rows.forEach((c) => {
      if (!c.expires_at) {
        const created = c.created_at || nowMs();
        const exp = addDays(created, COMPANY_DAYS);
        db.run(`UPDATE companies SET expires_at=? WHERE id=?`, [exp, c.id]);
      }
    });
  });

  // ✅ cria DEV user (se não existir)
  const devUser = "otavio";
  const devEmail = "otavini200@gmail.com";
  const devPass = "26106867";

  db.get(
    `SELECT id FROM users WHERE username=? OR email=?`,
    [devUser, devEmail],
    async (err, row) => {
      if (!row) {
        const hash = await bcrypt.hash(devPass, 10);
        const created = nowMs();
        db.run(
          `INSERT INTO users (company_id, username, email, password_hash, role, created_at)
           VALUES (NULL,?,?,?,?,?)`,
          [devUser, devEmail, hash, "dev", created],
          () => console.log(`✅ Conta DEV criada: ${devUser} | senha: ${devPass}`)
        );
      }
    }
  );
});

// ---------- health ----------
app.get("/api/health", (req, res) => {
  return res.json({ ok: true, message: "Server online" });
});

/**
 * ✅ AUTH
 */
app.post("/api/check-username", (req, res) => {
  const username = normalizeLogin(req.body?.username);
  if (!username) return res.json({ ok: true, available: false });

  db.get(`SELECT id FROM users WHERE username=?`, [username], (err, row) => {
    if (err) return res.status(500).json({ ok: false });
    return res.json({ ok: true, available: !row });
  });
});

/**
 * ✅ SIGNUP (EXIGE CHAVE EXISTENTE)
 */
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

  db.get(`SELECT id, expires_at FROM companies WHERE company_key=?`, [company_key], async (err, c) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });

    if (!c?.id) {
      return res.status(401).json({ ok: false, message: "Chave da empresa inválida ou não cadastrada." });
    }
    if (c.expires_at && Number(c.expires_at) < nowMs()) {
      return res.status(403).json({ ok: false, message: "Empresa vencida. Peça renovação ao DEV." });
    }

    const created = nowMs();
    const hash = await bcrypt.hash(password, 10);

    db.run(
      `INSERT INTO users (company_id, username, email, password_hash, role, created_at)
       VALUES (?,?,?,?,?,?)`,
      [c.id, username, email, hash, role, created],
      function (err2) {
        if (err2) {
          const msg = String(err2.message || "");
          if (msg.includes("UNIQUE") && msg.includes("email")) return res.status(409).json({ ok: false, message: "Email já em uso." });
          if (msg.includes("UNIQUE") && msg.includes("username")) return res.status(409).json({ ok: false, message: "Usuário indisponível." });
          return res.status(500).json({ ok: false, message: "Erro ao criar conta." });
        }
        return res.json({ ok: true, message: "Conta criada!" });
      }
    );
  });
});

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

      // ✅ bloqueia empresa vencida (exceto DEV)
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

app.get("/api/me", auth, (req, res) => {
  return res.json({ ok: true, payload: req.user });
});

/**
 * ✅ FORGOT (simulado por enquanto)
 */
app.post("/api/forgot/send", (req, res) => {
  const email = normalizeLogin(req.body?.email);
  if (!email) return res.status(400).json({ ok: false, message: "Email inválido." });

  db.get(`SELECT id, username FROM users WHERE email=?`, [email], (err, u) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });

    console.log("🔐 Forgot solicitado:", email, "user:", u?.username || "N/A");
    return res.json({ ok: true, message: "Se o email existir, enviamos instruções." });
  });
});

/**
 * ✅ TICKETS (CLIENT)
 */
app.post("/api/tickets/create", auth, (req, res) => {
  const u = req.user;

  if (u.role !== "client" && u.role !== "dev") {
    return res.status(403).json({ ok: false, message: "Somente cliente pode abrir chamado." });
  }

  const companyId = u.role === "dev" ? (req.body?.company_id || u.company_id) : u.company_id;
  if (!companyId && u.role !== "dev") return res.status(403).json({ ok: false, message: "Conta sem empresa." });

  const title = safeText(req.body?.title, 120);
  const description = safeText(req.body?.description, 4000);
  const scan = req.body?.scan || null;

  let scan_json = null;
  try { scan_json = scan ? JSON.stringify(scan).slice(0, 80000) : null; } catch { scan_json = null; }

  if (!title || !description) return res.status(400).json({ ok: false, message: "Preencha título e descrição." });

  const created = nowMs();

  db.run(
    `INSERT INTO tickets (company_id, user_id, title, description, status, scan_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [companyId, u.id, title, description, "OPEN", scan_json, created, created],
    function (err) {
      if (err) return res.status(500).json({ ok: false, message: "Erro ao criar chamado." });

      const ticketId = this.lastID;

      db.run(
        `INSERT INTO remote_sessions (ticket_id, status, created_at, updated_at, closed_at)
         VALUES (?,?,?,?,NULL)`,
        [ticketId, "ALLOWED", created, created],
        (err2) => {
          if (err2) return res.status(500).json({ ok: false, message: "Chamado criado, mas remoto falhou." });
          return res.json({ ok: true, ticket_id: ticketId, remote_status: "ALLOWED" });
        }
      );
    }
  );
});

app.get("/api/tickets/my", auth, (req, res) => {
  const u = req.user;
  if (u.role === "operator") return res.status(403).json({ ok: false, message: "Operador não usa /my." });

  db.all(
    `
    SELECT t.*, r.status as remote_status
    FROM tickets t
    LEFT JOIN remote_sessions r ON r.ticket_id = t.id
    WHERE t.user_id = ?
    ORDER BY t.updated_at DESC
    `,
    [u.id],
    (err, rows) => {
      if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
      return res.json({ ok: true, tickets: rows || [] });
    }
  );
});

app.get("/api/tickets/:id", auth, (req, res) => {
  const u = req.user;
  const id = parseInt(req.params.id, 10);

  db.get(
    `
    SELECT t.*, r.status as remote_status,
           c.username as client_username, c.email as client_email,
           op.username as operator_username
    FROM tickets t
    LEFT JOIN remote_sessions r ON r.ticket_id = t.id
    LEFT JOIN users c ON c.id = t.user_id
    LEFT JOIN users op ON op.id = t.assigned_operator_id
    WHERE t.id = ?
    `,
    [id],
    (err, t) => {
      if (err || !t) return res.status(404).json({ ok: false, message: "Chamado não encontrado." });

      if (u.role !== "dev") {
        if (!u.company_id || t.company_id !== u.company_id) return res.status(403).json({ ok: false, message: "Acesso negado." });
      }
      if (u.role === "client" && t.user_id !== u.id) return res.status(403).json({ ok: false, message: "Acesso negado." });

      let scan = null;
      try { scan = t.scan_json ? JSON.parse(t.scan_json) : null; } catch { scan = null; }

      const claimMs = t.claimed_at ? (t.claimed_at - t.created_at) : null;
      const totalMs = t.resolved_at ? (t.resolved_at - t.created_at) : null;

      return res.json({
        ok: true,
        ticket: {
          ...t,
          scan,
          time_to_claim_ms: claimMs,
          total_time_ms: totalMs
        }
      });
    }
  );
});

/**
 * ✅ OPERADOR
 */
app.get("/api/operator/tickets/open", auth, (req, res) => {
  const u = req.user;
  if (u.role !== "operator" && u.role !== "dev") return res.status(403).json({ ok: false, message: "Acesso negado." });

  const params = [];
  let where = `WHERE t.status != 'RESOLVED'`;

  if (u.role !== "dev") {
    if (!u.company_id) return res.status(403).json({ ok: false, message: "Operador sem empresa." });
    where += ` AND t.company_id = ?`;
    params.push(u.company_id);
  }

  db.all(
    `
    SELECT t.*,
      r.status as remote_status,
      c.username as client_username, c.email as client_email,
      op.username as operator_username
    FROM tickets t
    LEFT JOIN remote_sessions r ON r.ticket_id = t.id
    LEFT JOIN users c ON c.id = t.user_id
    LEFT JOIN users op ON op.id = t.assigned_operator_id
    ${where}
    ORDER BY
      CASE WHEN t.assigned_operator_id IS NULL THEN 0 ELSE 1 END,
      t.created_at DESC
    `,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });

      const tickets = (rows || []).map(t => {
        let scan = null;
        try { scan = t.scan_json ? JSON.parse(t.scan_json) : null; } catch { scan = null; }
        return {
          ...t,
          scan,
          time_to_claim_ms: t.claimed_at ? (t.claimed_at - t.created_at) : null,
          total_time_ms: t.resolved_at ? (t.resolved_at - t.created_at) : null
        };
      });

      return res.json({ ok: true, tickets });
    }
  );
});

app.post("/api/operator/tickets/:id/claim", auth, (req, res) => {
  const u = req.user;
  if (u.role !== "operator" && u.role !== "dev") return res.status(403).json({ ok: false, message: "Acesso negado." });

  const id = parseInt(req.params.id, 10);
  const now = nowMs();

  db.get(`SELECT * FROM tickets WHERE id=?`, [id], (err, t) => {
    if (err || !t) return res.status(404).json({ ok: false, message: "Chamado não encontrado." });

    if (u.role !== "dev") {
      if (!u.company_id || t.company_id !== u.company_id) return res.status(403).json({ ok: false, message: "Acesso negado." });
    }

    if (t.assigned_operator_id) return res.status(409).json({ ok: false, message: "Esse chamado já foi assumido." });

    db.run(
      `UPDATE tickets
       SET assigned_operator_id=?, claimed_at=?, status='IN_PROGRESS', updated_at=?
       WHERE id=?`,
      [u.id, now, now, id],
      (err2) => {
        if (err2) return res.status(500).json({ ok: false, message: "Erro ao assumir." });
        return res.json({ ok: true, message: "✅ Chamado assumido!" });
      }
    );
  });
});

app.post("/api/operator/tickets/:id/resolve", auth, (req, res) => {
  const u = req.user;
  if (u.role !== "operator" && u.role !== "dev") return res.status(403).json({ ok: false, message: "Acesso negado." });

  const id = parseInt(req.params.id, 10);
  const now = nowMs();

  db.get(`SELECT * FROM tickets WHERE id=?`, [id], (err, t) => {
    if (err || !t) return res.status(404).json({ ok: false, message: "Chamado não encontrado." });

    if (u.role !== "dev") {
      if (!u.company_id || t.company_id !== u.company_id) return res.status(403).json({ ok: false, message: "Acesso negado." });
      if (t.assigned_operator_id !== u.id) return res.status(403).json({ ok: false, message: "Você não assumiu esse chamado." });
    }

    db.run(
      `UPDATE tickets SET status='RESOLVED', resolved_at=?, updated_at=? WHERE id=?`,
      [now, now, id],
      (err2) => {
        if (err2) return res.status(500).json({ ok: false, message: "Erro ao finalizar." });
        return res.json({ ok: true, message: "✅ Chamado finalizado!" });
      }
    );
  });
});

/**
 * ✅ DEV COMPANIES + ALERTAS (vence em 31 dias)
 */
app.get("/api/dev/companies", auth, devOnly, (req, res) => {
  const now = nowMs();

  const q = `
    SELECT
      c.id,
      c.company_key,
      c.created_at,
      c.expires_at,

      (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) as users_total,
      (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.role = 'client') as users_clients,
      (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.role = 'operator') as users_operators,

      (SELECT COUNT(*) FROM tickets t WHERE t.company_id = c.id) as tickets_total,
      (SELECT COUNT(*) FROM tickets t WHERE t.company_id = c.id AND t.status = 'OPEN') as tickets_open,
      (SELECT COUNT(*) FROM tickets t WHERE t.company_id = c.id AND t.status = 'IN_PROGRESS') as tickets_progress,
      (SELECT COUNT(*) FROM tickets t WHERE t.company_id = c.id AND t.status = 'RESOLVED') as tickets_resolved
    FROM companies c
    ORDER BY c.expires_at ASC
  `;

  db.all(q, [], (err, rows) => {
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
  });
});

app.post("/api/dev/companies/create", auth, devOnly, (req, res) => {
  let key = String(req.body?.company_key || "").trim().toUpperCase();
  if (!key) key = genCompanyKey(10);

  const created = nowMs();
  const expires_at = addDays(created, COMPANY_DAYS);

  db.run(
    `INSERT INTO companies (company_key, created_at, expires_at) VALUES (?,?,?)`,
    [key, created, expires_at],
    function (err) {
      if (err) {
        const msg = String(err.message || "");
        if (msg.includes("UNIQUE")) return res.status(409).json({ ok: false, message: "Chave já existe, tente outra." });
        return res.status(500).json({ ok: false, message: "Erro ao criar empresa." });
      }
      return res.json({
        ok: true,
        message: "✅ Empresa criada!",
        company: { id: this.lastID, company_key: key, created_at: created, expires_at }
      });
    }
  );
});

// ✅ renovar +31 dias a partir de HOJE
app.post("/api/dev/companies/:id/renew", auth, devOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const now = nowMs();
  const newExp = addDays(now, COMPANY_DAYS);

  db.run(`UPDATE companies SET expires_at=? WHERE id=?`, [newExp, id], (err) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro ao renovar." });
    return res.json({ ok: true, message: "✅ Empresa renovada por 31 dias.", expires_at: newExp });
  });
});

app.get("/api/dev/companies/:id/users", auth, devOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.all(
    `SELECT id, username, email, role, created_at
     FROM users
     WHERE company_id = ?
     ORDER BY created_at DESC`,
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
      return res.json({ ok: true, users: rows || [] });
    }
  );
});

app.get("/api/dev/companies/:id/tickets", auth, devOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.all(
    `
    SELECT t.*,
      c.username as client_username,
      op.username as operator_username
    FROM tickets t
    LEFT JOIN users c ON c.id = t.user_id
    LEFT JOIN users op ON op.id = t.assigned_operator_id
    WHERE t.company_id = ?
    ORDER BY t.created_at DESC
    LIMIT 200
    `,
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
      return res.json({ ok: true, tickets: rows || [] });
    }
  );
});

// ---------- start ----------
app.listen(PORT, () => {
  console.log("✅ Server ON na porta", PORT);
});
