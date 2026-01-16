const SERVER = "https://chama-3fxc.onrender.com";
const msg = document.getElementById("msg");

document.getElementById("toggle").addEventListener("click", (e) => {
  e.preventDefault();
  const p = document.getElementById("password");
  p.type = p.type === "password" ? "text" : "password";
});

document.getElementById("btnLogin").addEventListener("click", login);

async function login(){
  msg.textContent = "Conectando...";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  try{
    const r = await fetch(`${SERVER}/api/login`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await r.json();
    if(!data.ok){
      msg.textContent = "❌ " + (data.message || "Falha no login");
      return;
    }

    msg.textContent = "✅ Login OK! (Servidor Render)";
    // depois: abrir dashboard do agent online + ID
  }catch{
    msg.textContent = "❌ Servidor offline (Render)";
  }
}
