const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DB_PATH = path.join(__dirname, "db.sqlite");
const db = new sqlite3.Database(DB_PATH);

const JWT_SECRET = "TROQUE_ESSA_CHAVE_SUPER_SECRETA";

// cria tabela e usuário admin padrão
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
    if (err) return console.error(err);
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

// LOGIN
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

// ROTA PROTEGIDA (teste)
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

const PORT = 3333;
app.listen(PORT, () => console.log("✅ Server ON: http://localhost:" + PORT));
