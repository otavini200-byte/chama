const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();

// ✅ CORS liberado para funcionar no GitHub Pages + qualquer domínio
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json());

// ✅ Servir o painel do técnico quando abrir a URL do Render no navegador
app.use(express.static(path.join(__dirname, "Public")));

// ✅ Banco SQLite local
const DB_PATH = path.join(__dirname, "db.sqlite");
const db = new sqlite3.Database(DB_PATH);

// ✅ JWT secret (Render -> Environment Variables)
const JWT_SECRET = process.env.JWT_SECRET || "DEV_SECRET_CHANGE_ME";

// ✅ Cria tabela e usuário admin padrão
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'technician'
    )
  `);

  db.get(`SELECT * FROM users WHERE email = ?`, ["admin@local"], async (err, row) => {
    if (err) return console.error("DB error:", err);
    if (!row) {
      const hash = await bcrypt.hash("admin123", 10);
      db.run(
        `INSERT INTO users (email, password_hash, role) VALUES (?,?,?)`,
        ["admin@local", hash, "admin"]
      );
      console.log("✅ Usuário criado: admin@local | senha: admin123");
    }
  });
});

// ✅ Rota de saúde (pra testar rapidão)
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "remote-desk-server", time: new Date().toISOString() });
});

// ✅ LOGIN
app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, message: "Dados inválidos." });

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ ok: false, message: "Erro no servidor." });
    if (!user) return res.status(401).json({ ok: false, message: "Usuário ou senha inválidos." });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ ok: false, message: "Usuário ou senha inválidos." });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    res.json({ ok: true, token, user: { email: user.email, role: user.role } });
  });
});

// ✅ Rota protegida (teste)
app.get("/api/me", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.replace("Bearer ", "");
  if (!token) return res.status(401).json({ ok: false });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({ ok: true, payload });
  } catch {
    return res.status(401).json({ ok: false });
  }
});

// ✅ PORT compatível com Render (obrigatório)
const PORT = process.env.PORT || 3333;
app.listen(PORT, "0.0.0.0", () => console.log("✅ Server ON na porta " + PORT));


