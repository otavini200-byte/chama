const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json());

// ✅ pasta Public (P MAIÚSCULO)
const STATIC_DIR = path.join(__dirname, "Public");
app.use(express.static(STATIC_DIR));
app.get("/", (req, res) => res.sendFile(path.join(STATIC_DIR, "index.html")));

// ✅ banco
const DB_PATH = path.join(__dirname, "db.sqlite");
const db = new sqlite3.Database(DB_PATH);

// ✅ configs
const JWT_SECRET = process.env.JWT_SECRET || "DEV_SECRET_CHANGE_ME";
const APP_URL = process.env.APP_URL || "https://chama-3fxc.onrender.com";

// ✅ SMTP
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

function hasMailerConfig() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && FROM_EMAIL);
}
function createTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

function normalizeKey(k) {
  return String(k || "").trim().toUpperCase();
}
function normalizeUsername(u) {
  return String(u || "").trim().toLowerCase();
}
function normalizeLogin(x) {
  return String(x || "").trim().toLowerCase();
}
function safeText(x, max = 2000) {
  return String(x || "").trim().slice(0, max);
}

function auth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return res.status(401).json({ ok: false, message: "Sem token." });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ ok: false, message: "Token inválido." });
  }
}
function devOnly(req, res, next) {
  if (req.user?.role !== "dev") return res.status(403).json({ ok: false, message: "Acesso DEV apenas." });
  next();
}
function operatorOnly(req, res, next) {
  if (req.user?.role !== "operator" && req.user?.role !== "dev") {
    return res.status(403).json({ ok: false, message: "Acesso de operador apenas." });
  }
  next();
}

// ========= DB =========
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_key TEXT UNIQUE,
      created_at INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS company_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_key TEXT UNIQUE,
      active INTEGER DEFAULT 1,
      created_at INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'client', -- client | operator | dev
      is_admin INTEGER DEFAULT 0,
      created_at INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      token TEXT UNIQUE,
      expires_at INTEGER,
      used INTEGER DEFAULT 0
    )
  `);

  // ✅ CHAMADOS
  db.run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      user_id INTEGER,
      title TEXT,
      category TEXT,
      priority TEXT,
      description TEXT,
      status TEXT DEFAULT 'OPEN', -- OPEN | IN_PROGRESS | RESOLVED
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  // ✅ SESSÃO REMOTA (placeholder por enquanto)
  db.run(`
    CREATE TABLE IF NOT EXISTS remote_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER UNIQUE,
      status TEXT DEFAULT 'ALLOWED', -- ALLOWED | ACTIVE | CLOSED
      created_at INTEGER,
      updated_at INTEGER,
      closed_at INTEGER
    )
  `);
});

function createCompanyIfNeeded(company_key) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id FROM companies WHERE company_key=?`, [company_key], (err, row) => {
      if (err) return reject(err);
      if (row) return resolve(row.id);

      db.run(
        `INSERT INTO companies (company_key, created_at) VALUES (?,?)`,
        [company_key, Date.now()],
        function (err2) {
          if (err2) return reject(err2);
          resolve(this.lastID);
        }
      );
    });
  });
}
function isCompanyKeyValid(company_key) {
  return new Promise((resolve) => {
    db.get(
      `SELECT id FROM company_keys WHERE company_key=? AND active=1`,
      [company_key],
      (err, row) => resolve(!err && !!row)
    );
  });
}
function generatePrettyKey() {
  const a = crypto.randomBytes(2).toString("hex").toUpperCase();
  const b = crypto.randomBytes(2).toString("hex").toUpperCase();
  const c = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `${a}-${b}-${c}`;
}
function createNewCompanyKey() {
  const key = generatePrettyKey();
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO company_keys (company_key, active, created_at) VALUES (?,?,?)`,
      [key, 1, Date.now()],
      function (err) {
        if (err) return reject(err);
        resolve(key);
      }
    );
  });
}

/**
 * ✅ SEED DEV "OTAVIO"
 * - Se existir user com email DEV -> vira DEV e ganha username "otavio"
 * - Se já existir um "otavio" que NÃO é o email DEV -> renomeia pra otavio_old_ID
 * - Se não existir email DEV -> cria DEV do zero
 */
async function seedDevAccount() {
  const DEV_USERNAME = "otavio";
  const DEV_EMAIL = "otavini200@gmail.com";
  const DEV_PASSWORD = "26106867";

  const hash = await bcrypt.hash(DEV_PASSWORD, 10);

  db.get(`SELECT * FROM users WHERE email=?`, [DEV_EMAIL], (errEmail, userByEmail) => {
    if (errEmail) return console.log("❌ seedDevAccount erro email:", errEmail);

    db.get(`SELECT * FROM users WHERE username=?`, [DEV_USERNAME], (errUser, userByUsername) => {
      if (errUser) return console.log("❌ seedDevAccount erro username:", errUser);

      const renameOldOtavioIfNeeded = (done) => {
        if (!userByUsername) return done();
        if (userByEmail && userByUsername.id === userByEmail.id) return done();

        const newName = `otavio_old_${userByUsername.id}`;
        db.run(`UPDATE users SET username=? WHERE id=?`, [newName, userByUsername.id], (errRen) => {
          if (errRen) return console.log("❌ Falha ao renomear antigo otavio:", errRen);
          console.log(`✅ Usuário antigo 'otavio' renomeado para '${newName}'`);
          done();
        });
      };

      if (userByEmail) {
        renameOldOtavioIfNeeded(() => {
          db.run(
            `UPDATE users SET username=?, role='dev', is_admin=1, password_hash=? WHERE id=?`,
            [DEV_USERNAME, hash, userByEmail.id],
            (errUp) => {
              if (errUp) return console.log("❌ Falha ao transformar em DEV:", errUp);
              console.log("✅ Conta DEV garantida via EMAIL:", DEV_EMAIL);
            }
          );
        });
        return;
      }

      renameOldOtavioIfNeeded(() => {
        db.run(
          `INSERT INTO users (company_id, username, email, password_hash, role, is_admin, created_at)
           VALUES (NULL,?,?,?,?,?,?)`,
          [DEV_USERNAME, DEV_EMAIL, hash, "dev", 1, Date.now()],
          (errIns) => {
            if (errIns) return console.log("❌ Falha ao criar conta DEV:", errIns);
            console.log("✅ Conta DEV criada do zero:", DEV_USERNAME, DEV_EMAIL);
          }
        );
      });
    });
  });
}

// ========= API =========
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "chama-server", time: new Date().toISOString() });
});

// ✅ DEV: gerar chave válida
app.post("/api/dev/key/new", auth, devOnly, async (req, res) => {
  try {
    const key = await createNewCompanyKey();
    return res.json({ ok: true, company_key: key });
  } catch {
    return res.status(500).json({ ok: false, message: "Falha ao gerar chave." });
  }
});

// ✅ check username
app.post("/api/check-username", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  if (!username) return res.status(400).json({ ok: false, message: "Usuário inválido." });

  db.get(`SELECT id FROM users WHERE username=?`, [username], (err, row) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
    return res.json({ ok: true, available: !row });
  });
});

// ✅ signup (SEM DEV + chave válida + username reservado)
app.post("/api/signup", async (req, res) => {
  try {
    const company_key = normalizeKey(req.body?.company_key);
    const username = normalizeUsername(req.body?.username);
    const email = normalizeLogin(req.body?.email);
    const password = String(req.body?.password || "");
    const confirm = String(req.body?.confirm || "");

    // ✅ username reservado pro DEV
    if (username === "otavio") return res.status(403).json({ ok: false, message: "Usuário reservado." });

    // ✅ bloqueio DEV
    if (String(req.body?.role || "").toLowerCase() === "dev") {
      return res.status(403).json({ ok: false, message: "Nível DEV é exclusivo." });
    }

    // ✅ role permitido
    const role = req.body?.role === "operator" ? "operator" : "client";

    if (!company_key || !username || !email || !password || !confirm) {
      return res.status(400).json({ ok: false, message: "Preencha tudo." });
    }
    if (password.length < 6) return res.status(400).json({ ok: false, message: "Senha mínima: 6 caracteres." });
    if (password !== confirm) return res.status(400).json({ ok: false, message: "As senhas não conferem." });

    const valid = await isCompanyKeyValid(company_key);
    if (!valid) return res.status(403).json({ ok: false, message: "Chave de empresa inválida ou inativa." });

    const companyId = await createCompanyIfNeeded(company_key);

    const userExists = await new Promise((resolve) => {
      db.get(`SELECT id FROM users WHERE username=?`, [username], (err, row) => resolve(!!row));
    });
    if (userExists) return res.status(409).json({ ok: false, message: "Usuário indisponível." });

    const emailExists = await new Promise((resolve) => {
      db.get(`SELECT id FROM users WHERE email=?`, [email], (err, row) => resolve(!!row));
    });
    if (emailExists) return res.status(409).json({ ok: false, message: "Email já cadastrado." });

    const hash = await bcrypt.hash(password, 10);

    db.run(
      `INSERT INTO users (company_id, username, email,
 
         password_hash, role, is_admin, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [companyId, username, email, hash, role, 0, Date.now()],
      function (err) {
        if (err) return res.status(500).json({ ok: false, message: "Erro ao criar conta." });
        return res.json({ ok: true, message: "Conta criada com sucesso!" });
      }
    );
  } catch {
    return res.status(500).json({ ok: false, message: "Erro no servidor." });
  }
});

// ✅ login
app.post("/api/login", (req, res) => {
  const login = normalizeLogin(req.body?.login);
  const password = String(req.body?.password || "");

  if (!login || !password) return res.status(400).json({ ok: false, message: "Digite usuário/email e senha." });

  db.get(
    `SELECT u.*, c.company_key
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     WHERE u.email=? OR u.username=?`,
    [login, login],
    async (err, user) => {
      if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
      if (!user) return res.status(401).json({ ok: false, message: "Login inválido." });

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ ok: false, message: "Senha incorreta." });

      const token = jwt.sign(
        {
          id: user.id,
          company_id: user.company_id || null,
          company_key: user.company_key || "",
          username: user.username,
          email: user.email,
          role: user.role,
          is_admin: !!user.is_admin
        },
        JWT_SECRET,
        { expiresIn: "12h" }
      );

      return res.json({ ok: true, token, user: { username: user.username, email: user.email, role: user.role } });
    }
  );
});

// ✅ me
app.get("/api/me", auth, (req, res) => res.json({ ok: true, payload: req.user }));

// ✅ esqueci senha (email)
app.post("/api/forgot/send", (req, res) => {
  const email = normalizeLogin(req.body?.email);
  if (!email) return res.status(400).json({ ok: false, message: "Digite seu email." });

  db.get(`SELECT id FROM users WHERE email=?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
    if (!user) return res.status(404).json({ ok: false, message: "Email não encontrado." });

    const token = crypto.randomBytes(24).toString("hex");
    const expires = Date.now() + 1000 * 60 * 20;

    db.run(
      `INSERT INTO reset_tokens (user_id, token, expires_at, used) VALUES (?,?,?,0)`,
      [user.id, token, expires],
      async (err2) => {
        if (err2) return res.status(500).json({ ok: false, message: "Erro ao gerar token." });

        const link = `${APP_URL}/reset.html?token=${token}`;

        if (!hasMailerConfig()) {
          console.log("📩 LINK RESET (SEM SMTP):", link);
          return res.json({ ok: true, message: "SMTP não configurado. Veja logs do Render.", debugLink: link });
        }

        try {
          const transport = createTransport();
          await transport.sendMail({
            from: FROM_EMAIL,
            to: email,
            subject: "Recuperação de senha • Chama",
            html: `
              <div style="font-family:Arial,sans-serif;line-height:1.4">
                <h2>Recuperação de senha</h2>
                <p>Clique no botão abaixo para criar uma nova senha. Este link expira em <b>20 minutos</b>.</p>
                <p>
                  <a href="${link}" style="display:inline-block;padding:12px 16px;border-radius:12px;
                     background:#6a4bc9;color:#fff;text-decoration:none;font-weight:700">
                    Redefinir senha
                  </a>
                </p>
                <p>Se você não pediu isso, ignore este email.</p>
              </div>
            `
          });

          return res.json({ ok: true, message: "Email de recuperação enviado!" });
        } catch {
          return res.status(500).json({ ok: false, message: "Falha ao enviar email (SMTP)." });
        }
      }
    );
  });
});

// ✅ reset verify/confirm (para reset.html funcionar)
app.get("/api/reset/verify", (req, res) => {
  const token = String(req.query?.token || "");
  if (!token) return res.status(400).json({ ok: false, message: "Token inválido." });

  db.get(`SELECT * FROM reset_tokens WHERE token=?`, [token], (err, row) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
    if (!row) return res.status(404).json({ ok: false, message: "Token não encontrado." });
    if (row.used) return res.status(410).json({ ok: false, message: "Token já usado." });
    if (Date.now() > row.expires_at) return res.status(410).json({ ok: false, message: "Token expirado." });
    return res.json({ ok: true });
  });
});

app.post("/api/reset/confirm", async (req, res) => {
  const token = String(req.body?.token || "");
  const password = String(req.body?.password || "");
  const confirm = String(req.body?.confirm || "");

  if (!token || !password || !confirm) return res.status(400).json({ ok: false, message: "Dados inválidos." });
  if (password.length < 6) return res.status(400).json({ ok: false, message: "Senha mínima: 6 caracteres." });
  if (password !== confirm) return res.status(400).json({ ok: false, message: "As senhas não conferem." });

  db.get(`SELECT * FROM reset_tokens WHERE token=?`, [token], async (err, row) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
    if (!row) return res.status(404).json({ ok: false, message: "Token inválido." });
    if (row.used) return res.status(410).json({ ok: false, message: "Token já usado." });
    if (Date.now() > row.expires_at) return res.status(410).json({ ok: false, message: "Token expirado." });

    const hash = await bcrypt.hash(password, 10);

    db.run(`UPDATE users SET password_hash=? WHERE id=?`, [hash, row.user_id], (err2) => {
      if (err2) return res.status(500).json({ ok: false, message: "Erro ao atualizar senha." });

      db.run(`UPDATE reset_tokens SET used=1 WHERE token=?`, [token], (err3) => {
        if (err3) return res.status(500).json({ ok: false, message: "Erro ao finalizar reset." });
        return res.json({ ok: true, message: "Senha atualizada com sucesso!" });
      });
    });
  });
});

// ==============================
// ✅ TICKETS (CLIENTE)
// Ao abrir chamado: cria ticket + cria remote_session(ALLOWED)
// ==============================
app.post("/api/tickets/create", auth, async (req, res) => {
  const u = req.user;

  if (!u.company_id) return res.status(403).json({ ok: false, message: "Conta sem empresa." });
  if (u.role !== "client" && u.role !== "dev") {
    // por enquanto só cliente/DEV testa
    return res.status(403).json({ ok: false, message: "Apenas cliente pode abrir chamado." });
  }

  const title = safeText(req.body?.title, 120);
  const category = safeText(req.body?.category, 40);
  const priority = safeText(req.body?.priority, 10);
  const description = safeText(req.body?.description, 4000);

  if (!title || !category || !priority || !description) {
    return res.status(400).json({ ok: false, message: "Preencha título, categoria, prioridade e descrição." });
  }

  const now = Date.now();
  db.run(
    `INSERT INTO tickets (company_id, user_id, title, category, priority, description, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [u.company_id, u.id, title, category, priority, description, "OPEN", now, now],
    function (err) {
      if (err) return res.status(500).json({ ok: false, message: "Erro ao criar chamado." });

      const ticketId = this.lastID;

      // ✅ cria sessão remota automaticamente como PERMITIDO
      db.run(
        `INSERT INTO remote_sessions (ticket_id, status, created_at, updated_at, closed_at)
         VALUES (?,?,?,?,NULL)`,
        [ticketId, "ALLOWED", now, now],
        (err2) => {
          if (err2) return res.status(500).json({ ok: false, message: "Chamado criado, mas falhou sessão remota." });
          return res.json({ ok: true, ticket_id: ticketId, remote_status: "ALLOWED" });
        }
      );
    }
  );
});

// ✅ lista tickets (cliente: só dele | operador: da empresa | dev: todos)
app.get("/api/tickets/my", auth, (req, res) => {
  const u = req.user;

  let where = "";
  let params = [];

  if (u.role === "client") {
    where = `WHERE t.user_id=?`;
    params = [u.id];
  } else if (u.role === "operator") {
    if (!u.company_id) return res.json({ ok: true, tickets: [] });
    where = `WHERE t.company_id=?`;
    params = [u.company_id];
  } else {
    // dev
    where = "";
    params = [];
  }

  db.all(
    `
    SELECT t.*,
           COALESCE(r.status,'ALLOWED') AS remote_status
    FROM tickets t
    LEFT JOIN remote_sessions r ON r.ticket_id = t.id
    ${where}
    ORDER BY t.updated_at DESC
    `,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ ok: false, message: "Erro ao buscar chamados." });
      return res.json({ ok: true, tickets: rows || [] });
    }
  );
});

// ✅ detalhe do ticket (com permissão)
app.get("/api/tickets/:id", auth, (req, res) => {
  const u = req.user;
  const id = parseInt(req.params.id, 10);

  db.get(
    `
    SELECT t.*,
           COALESCE(r.status,'ALLOWED') AS remote_status
    FROM tickets t
    LEFT JOIN remote_sessions r ON r.ticket_id = t.id
    WHERE t.id=?
    `,
    [id],
    (err, t) => {
      if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
      if (!t) return res.status(404).json({ ok: false, message: "Chamado não encontrado." });

      // permissão
      if (u.role === "client" && t.user_id !== u.id) return res.status(403).json({ ok: false, message: "Sem acesso." });
      if (u.role === "operator" && t.company_id !== u.company_id) return res.status(403).json({ ok: false, message: "Sem acesso." });

      return res.json({ ok: true, ticket: t });
    }
  );
});

// ✅ encerrar sessão remota (cliente dono OU operador da empresa OU dev)
app.post("/api/remote/:ticketId/close", auth, (req, res) => {
  const u = req.user;
  const ticketId = parseInt(req.params.ticketId, 10);

  db.get(`SELECT * FROM tickets WHERE id=?`, [ticketId], (err, t) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
    if (!t) return res.status(404).json({ ok: false, message: "Chamado não encontrado." });

    if (u.role === "client" && t.user_id !== u.id) return res.status(403).json({ ok: false, message: "Sem acesso." });
    if (u.role === "operator" && t.company_id !== u.company_id) return res.status(403).json({ ok: false, message: "Sem acesso." });

    const now = Date.now();
    db.run(
      `UPDATE remote_sessions SET status='CLOSED', updated_at=?, closed_at=? WHERE ticket_id=?`,
      [now, now, ticketId],
      (err2) => {
        if (err2) return res.status(500).json({ ok: false, message: "Erro ao encerrar sessão." });

        // também marca ticket como resolved (opcional). Por enquanto não mexo no status do ticket.
        return res.json({ ok: true, remote_status: "CLOSED" });
      }
    );
  });
});

// (opcional) operador marcar como ACTIVE futuramente
app.post("/api/remote/:ticketId/start", auth, operatorOnly, (req, res) => {
  const u = req.user;
  const ticketId = parseInt(req.params.ticketId, 10);

  db.get(`SELECT * FROM tickets WHERE id=?`, [ticketId], (err, t) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
    if (!t) return res.status(404).json({ ok: false, message: "Chamado não encontrado." });
    if (u.role === "operator" && t.company_id !== u.company_id) return res.status(403).json({ ok: false, message: "Sem acesso." });

    const now = Date.now();
    db.run(
      `UPDATE remote_sessions SET status='ACTIVE', updated_at=? WHERE ticket_id=?`,
      [now, ticketId],
      (err2) => {
        if (err2) return res.status(500).json({ ok: false, message: "Erro ao iniciar sessão." });
        return res.json({ ok: true, remote_status: "ACTIVE" });
      }
    );
  });
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, "0.0.0.0", () => {
  console.log("✅ Server ON na porta " + PORT);
  seedDevAccount();
});
