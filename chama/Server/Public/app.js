window.UI = {
  show(screenId){
    const screens = ["screenLogin","screenSignup","screenForgot","screenDash"];
    screens.forEach(id => document.getElementById(id).classList.add("hidden"));
    document.getElementById(screenId).classList.remove("hidden");
  },

  togglePass(id){
    const el = document.getElementById(id);
    el.type = el.type === "password" ? "text" : "password";
  },

  setMsg(id, text){
    document.getElementById(id).textContent = text || "";
  }
};

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

window.API = {
  async checkUsername(){
    const u = document.getElementById("su_user").value.trim().toLowerCase();
    const hint = document.getElementById("su_hint");

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
    UI.setMsg("signup_msg", "Criando conta...");

    const company_key = document.getElementById("su_key").value.trim();
    const username = document.getElementById("su_user").value.trim().toLowerCase();
    const email = document.getElementById("su_email").value.trim().toLowerCase();
    const password = document.getElementById("su_pass").value;
    const confirm = document.getElementById("su_confirm").value;
    const role = document.getElementById("su_role").value;

    try{
      const r = await fetch("/api/signup", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ company_key, username, email, password, confirm, role })
      });

      const data = await r.json();

      if(!data.ok){
        UI.setMsg("signup_msg", "❌ " + (data.message || "Falha ao criar conta"));
        return;
      }

      UI.setMsg("signup_msg", "✅ Conta criada! Voltando pro login...");

      setTimeout(()=>{
        document.getElementById("su_key").value = "";
        document.getElementById("su_user").value = "";
        document.getElementById("su_email").value = "";
        document.getElementById("su_pass").value = "";
        document.getElementById("su_confirm").value = "";
        document.getElementById("su_hint").textContent = "Digite para verificar…";
        UI.setMsg("signup_msg","");
        UI.show("screenLogin");
      }, 900);

    }catch{
      UI.setMsg("signup_msg", "❌ Servidor offline");
    }
  },

  async login(){
    UI.setMsg("login_msg", "Conectando...");

    const login = document.getElementById("login_login").value.trim().toLowerCase();
    const password = document.getElementById("login_pass").value;
    const remember = document.getElementById("login_remember").checked;

    try{
      const r = await fetch("/api/login", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ login, password })
      });

      const data = await r.json();

      if(!data.ok){
        UI.setMsg("login_msg", "❌ " + (data.message || "Falha no login"));
        return;
      }

      Storage.setToken(data.token, remember);
      UI.setMsg("login_msg", "✅ Login OK!");
      await API.bootDash();

    }catch{
      UI.setMsg("login_msg", "❌ Servidor offline");
    }
  },

  async bootDash(){
    UI.show("screenDash");
    const token = Storage.getToken();

    try{
      const r = await fetch("/api/me", {
        headers:{ "Authorization":"Bearer " + token }
      });
      const data = await r.json();

      if(!data.ok){
        Storage.clear();
        UI.show("screenLogin");
        return;
      }

      document.getElementById("dash_me").textContent =
        `${data.payload.username} • ${data.payload.email}`;

      document.getElementById("dash_role").textContent =
        (data.payload.role === "operator" ? "Operador" : "Cliente");

    }catch{
      Storage.clear();
      UI.show("screenLogin");
    }
  },

  logout(){
    Storage.clear();
    location.reload();
  },

  async forgot(){
    UI.setMsg("forgot_msg", "Enviando...");

    const email = document.getElementById("fg_email").value.trim().toLowerCase();
    if(!email){
      UI.setMsg("forgot_msg","❌ Digite seu email.");
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
        UI.setMsg("forgot_msg","❌ " + (data.message || "Falha ao enviar"));
        return;
      }

      UI.setMsg("forgot_msg","✅ Link enviado pro seu email! (confere a caixa de entrada)");
    }catch{
      UI.setMsg("forgot_msg","❌ Servidor offline");
    }
  }
};

// ✅ tela inicial
UI.show("screenLogin");

// ✅ auto-login se já tiver token
(function(){
  const t = Storage.getToken();
  if(t) API.bootDash();
})();
