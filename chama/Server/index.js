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

// ✅ Serve telas do painel
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ✅ Banco
const DB_PATH = path.join(__dirname, "db.sqlite");
const db = new sqlite3.Database(DB_PATH);

// ✅ Secrets / Config
const JWT_SECRET = process.env.JWT_SECRET || "DEV_SECRET_CHANGE_ME";
const APP_URL = process.env.APP_URL || "https://chama-3fxc.onrender.com";

// ✅ SMTP (opcional)
// Configure no Render -> Environment Variables:
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL
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

// ========= HELPERS =========
function normalizeKey(k) {
  return String(k || "").trim().toUpperCase();
}
function normalizeUsername(u) {
  return String(u || "").trim().toLowerCase();
}
function normalizeLogin(x) {
  return String(x || "").trim().toLowerCase();
}

// ========= AUTH =========
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

// ========= DB SCHEMA =========
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_key TEXT UNIQUE,
      created_at INTEGER
    )
  `);

  // ✅ Importante: username e email são ÚNICOS no sistema inteiro (login sem chave)
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'client',
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
});

function getCompanyIdByKey(company_key) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id FROM companies WHERE company_key=?`, [company_key], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.id : null);
    });
  });
}

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

// ========= API =========
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "chama-server", time: new Date().toISOString() });
});

// ✅ Check username (disponível)
app.post("/api/check-username", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  if (!username) return res.status(400).json({ ok: false, message: "Usuário inválido." });

  db.get(`SELECT id FROM users WHERE username=?`, [username], (err, row) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
    return res.json({ ok: true, available: !row });
  });
});

// ✅ Signup (chave só aqui)
app.post("/api/signup", async (req, res) => {
  try {
    const company_key = normalizeKey(req.body?.company_key);
    const username = normalizeUsername(req.body?.username);
    const email = normalizeLogin(req.body?.email);
    const password = String(req.body?.password || "");
    const confirm = String(req.body?.confirm || "");
    const role = req.body?.role === "operator" ? "operator" : "client";

    if (!company_key || !username || !email || !password || !confirm) {
      return res.status(400).json({ ok: false, message: "Preencha tudo." });
    }

    if (password.length < 6) {
      return res.status(400).json({ ok: false, message: "Senha mínima: 6 caracteres." });
    }

    if (password !== confirm) {
      return res.status(400).json({ ok: false, message: "As senhas não conferem." });
    }

    // cria empresa se não existir
    const companyId = await createCompanyIfNeeded(company_key);

    // username único
    const userExists = await new Promise((resolve) => {
      db.get(`SELECT id FROM users WHERE username=?`, [username], (err, row) => resolve(!!row));
    });
    if (userExists) return res.status(409).json({ ok: false, message: "Usuário indisponível." });

    // email único
    const emailExists = await new Promise((resolve) => {
      db.get(`SELECT id FROM users WHERE email=?`, [email], (err, row) => resolve(!!row));
    });
    if (emailExists) return res.status(409).json({ ok: false, message: "Email já cadastrado." });

    const hash = await bcrypt.hash(password, 10);

    db.run(
      `INSERT INTO users (company_id, username, email, password_hash, role, created_at)
       VALUES (?,?,?,?,?,?)`,
      [companyId, username, email, hash, role, Date.now()],
      function (err) {
        if (err) return res.status(500).json({ ok: false, message: "Erro ao criar conta." });
        return res.json({ ok: true, message: "Conta criada com sucesso!" });
      }
    );
  } catch {
    return res.status(500).json({ ok: false, message: "Erro no servidor." });
  }
});

// ✅ Login (SEM chave): login pode ser email ou usuário
app.post("/api/login", (req, res) => {
  const login = normalizeLogin(req.body?.login);
  const password = String(req.body?.password || "");

  if (!login || !password) {
    return res.status(400).json({ ok: false, message: "Digite usuário/email e senha." });
  }

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
          company_id: user.company_id,
          company_key: user.company_key || "",
          username: user.username,
          email: user.email,
          role: user.role
        },
        JWT_SECRET,
        { expiresIn: "12h" }
      );

      return res.json({
        ok: true,
        token,
        user: { username: user.username, email: user.email, role: user.role }
      });
    }
  );
});

// ✅ Me
app.get("/api/me", auth, (req, res) => {
  res.json({ ok: true, payload: req.user });
});

// ✅ Forgot password: envia link pelo email (ou retorna debugLink nos logs se não tiver SMTP)
app.post("/api/forgot/send", (req, res) => {
  const email = normalizeLogin(req.body?.email);

  if (!email) return res.status(400).json({ ok: false, message: "Digite seu email." });

  db.get(`SELECT id, email FROM users WHERE email=?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
    if (!user) return res.status(404).json({ ok: false, message: "Email não encontrado." });

    const token = crypto.randomBytes(24).toString("hex");
    const expires = Date.now() + 1000 * 60 * 20; // 20 min

    db.run(
      `INSERT INTO reset_tokens (user_id, token, expires_at, used) VALUES (?,?,?,0)`,
      [user.id, token, expires],
      async (err2) => {
        if (err2) return res.status(500).json({ ok: false, message: "Erro ao gerar token." });

        const link = `${APP_URL}/reset.html?token=${token}`;

        // ✅ sem SMTP: imprime no LOG e também devolve debugLink
        if (!hasMailerConfig()) {
          console.log("📩 LINK RESET (SEM SMTP):", link);
          return res.json({
            ok: true,
            message: "Link gerado! (SMTP não configurado) — veja os logs do Render.",
            debugLink: link
          });
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
                  <a href="${link}"
                     style="display:inline-block;padding:12px 16px;border-radius:12px;
                     background:#6a4bc9;color:#fff;text-decoration:none;font-weight:700">
                    Redefinir senha
                  </a>
                </p>
                <p>Se você não pediu isso, ignore este email.</p>
              </div>
            `
          });

          return res.json({ ok: true, m
