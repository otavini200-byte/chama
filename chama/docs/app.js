// ✅ SUA API DO RENDER
const API = "https://chama-3fxc.onrender.com";

const msg = document.getElementById("msg");
const toggle = document.getElementById("toggle");

toggle.addEventListener("click", (e) => {
  e.preventDefault();
  const p = document.getElementById("password");
  p.type = p.type === "password" ? "text" : "password";
});

function setToken(token){
  const remember = document.getElementById("remember").checked;
  if (remember) localStorage.setItem("token", token);
  else sessionStorage.setItem("token", token);
}

function clearToken(){
  localStorage.removeItem("token");
  sessionStorage.removeItem("token");
}

async function login(){
  msg.textContent = "Conectando...";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  try{
    const r = await fetch(`${API}/api/login`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await r.json();
    if(!data.ok){
      msg.textContent = "❌ " + (data.message || "Falha no login");
      return;
    }

    setToken(data.token);
    msg.textContent = "✅ Login OK (Render)!";
    document.getElementById("app").classList.remove("hidden");
  }catch(err){
    msg.textContent = "❌ API offline (confere Render)";
  }
}

function logout(){
  clearToken();
  location.reload();
}
