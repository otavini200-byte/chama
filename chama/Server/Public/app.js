console.log("✅ app.js carregou MESMO");

function hideAllScreens(){
  ["screenLogin","screenSignup","screenForgot","screenDash"].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.classList.add("hidden");
  });
}

function showScreen(id){
  hideAllScreens();
  const el = document.getElementById(id);
  if(el) el.classList.remove("hidden");
}

function togglePass(id){
  const el = document.getElementById(id);
  if(!el) return;
  el.type = el.type === "password" ? "text" : "password";
}

function setMsg(id, text){
  const el = document.getElementById(id);
  if(el) el.textContent = text || "";
}

const Storage = {
  setToken(token, remember){
    if(remember) localStorage.setItem("token", token);
    else sessionStorage.setItem("token", token);
  },
  getToken(){
    return localStorage.getItem("token") || sessionStorage.getItem("token") || "";
  },
  clear(){
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
  }
};

const API = {
  async checkUsername(){
    const u = (document.getElementById("su_user")?.value || "").trim().toLowerCase();
    const hint = document.getElementById("su_hint");
    if(!hint) return;

    if(!u){
      hint.textContent = "Digite para verificar…";
      hint.style.color = "rgba(255,255,255,.42)";
      return;
    }

    hint.textContent = "verificando…";
    hint.style.color = "rgba(255,255,255,.42)";

    try{
      const r = await fetch("/api/check-username", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ username: u })
      });
      const data = await r.json();

      if(data.ok && data.available){
        hint.textContent = "disponível ✅";
        hint.style.color = "rgba(46,229,157,.95)";
      }else{
        hint.textContent = "indisponível ❌";
        hint.style.color = "rgba(255,75,146,.95)";
      }
    }catch{
      hint.textContent = "erro";
      hint.style.color = "rgba(255,75,146,.95)";
    }
  },

  async signup(){
    setMsg("signup_msg", "Criando conta...");

    const company_key = (document.getElementById("su_key")?.value || "").trim();
    const username = (document.getElementById("su_user")?.value || "").trim().toLowerCase();
    const email = (document.getElementById("su_email")?.value || "").trim().toLowerCase();
    const password = document.getElementById("su_pass")?.value || "";
    const confirm = document.getElementById("su_confirm")?.value || "";
    const role = document.getElementById("su_role")?.value || "client";

    try{
      const r = await fetch("/api/signup", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ company_key, username, email, password, confirm, role })
      });

      const data = await r.json();
      if(!data.ok){
        setMsg("signup_msg", "❌ " + (data.message || "Falha ao criar conta"));
        return;
      }

      setMsg("signup_msg", "✅ Conta criada! Voltando pro login...");

      setTimeout(()=>{
        ["su_key","su_user","su_email","su_pass","su_confirm"].forEach(id=>{
          const el = document.getElementById(id);
          if(el) el.value = "";
        });
        const hint = document.getElementById("su_hint");
        if(hint){
          hint.textContent = "Digite para verificar…";
          hint.style.color = "rgba(255,255,255,.42)";
        }
        setMsg("signup_msg","");
        showScreen("screenLogin");
      }, 800);

    }catch{
      setMsg("signup_msg", "❌ Servidor offline");
    }
  },

  async login(){
    setMsg("login_msg", "Conectando...");

    const login = (document.getElementById("login_login")?.value || "").trim().toLowerCase();
    const password = document.getElementById("login_pass")?.value || "";
    const remember = !!document.getElementById("login_remember")?.checked;

    try{
      const r = await fetch("/api/login", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ login, password })
      });

      const data = await r.json();
      if(!data.ok){
        setMsg("login_msg", "❌ " + (data.message || "Falha no login"));
        return;
      }

      Storage.setToken(data.token, remember);
      setMsg("login_msg", "✅ Login OK!");
      await API.bootDash();

    }catch{
      setMsg("login_msg", "❌ Servidor offline");
    }
  },

  async bootDash(){
    showScreen("screenDash");
    const token = Storage.getToken();

    try{
      const r = await fetch("/api/me", {
        headers:{ "Authorization":"Bearer " + token }
      });

      const data = await r.json();
      if(!data.ok){
        Storage.clear();
        showScreen("screenLogin");
        return;
      }

      document.getElementById("dash_me").textContent =
        `${data.payload.username} • ${data.payload.email}`;

      document.getElementById("dash_role").textContent =
        (data.payload.role === "operator" ? "Operador" : (data.payload.role === "dev" ? "DEV" : "Cliente"));
    }catch{
      Storage.clear();
      showScreen("screenLogin");
    }
  },

  logout(){
    Storage.clear();
    location.reload();
  },

  async forgot(){
    setMsg("forgot_msg", "Enviando...");

    const email = (document.getElementById("fg_email")?.value || "").trim().toLowerCase();
    if(!email){
      setMsg("forgot_msg","❌ Digite seu email.");
      return;
    }

    try{
      const r = await fetch("/api/forgot/send", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ email })
      });

      const data = await r.json();
      if(!data.ok){
        setMsg("forgot_msg","❌ " + (data.message || "Falha ao enviar"));
        return;
      }

      setMsg("forgot_msg","✅ Link enviado pro seu email! Verifique a caixa de entrada.");
    }catch{
      setMsg("forgot_msg","❌ Servidor offline");
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnGoSignup")?.addEventListener("click", () => showScreen("screenSignup"));
  document.getElementById("btnForgot")?.addEventListener("click", () => showScreen("screenForgot"));
  document.getElementById("btnBackFromSignup")?.addEventListener("click", () => showScreen("screenLogin"));
  document.getElementById("btnBackFromForgot")?.addEventListener("click", () => showScreen("screenLogin"));

  document.getElementById("btnLogin")?.addEventListener("click", API.login);
  document.getElementById("btnSignup")?.addEventListener("click", API.signup);
  document.getElementById("btnSendForgot")?.addEventListener("click", API.forgot);
  document.getElementById("btnLogout")?.addEventListener("click", API.logout);

  document.getElementById("btnEyeLogin")?.addEventListener("click", (e) => { e.preventDefault(); togglePass("login_pass"); });
  document.getElementById("btnEyeSuPass")?.addEventListener("click", (e) => { e.preventDefault(); togglePass("su_pass"); });
  document.getElementById("btnEyeSuConfirm")?.addEventListener("click", (e) => { e.preventDefault(); togglePass("su_confirm"); });

  document.getElementById("su_user")?.addEventListener("input", API.checkUsername);

  showScreen("screenLogin");

  const t = Storage.getToken();
  if(t) API.bootDash();
});
