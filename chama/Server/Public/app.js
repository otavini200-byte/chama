const UI = {
  show(screen){
    const map = {
      login: ["screenLogin","tabLogin"],
      signup: ["screenSignup","tabSignup"],
      forgot: ["screenForgot","tabForgot"],
      dash: ["screenDash", null]
    };

    // hide all
    ["screenLogin","screenSignup","screenForgot","screenDash"].forEach(id=>{
      document.getElementById(id).classList.add("hidden");
    });

    // tabs
    ["tabLogin","tabSignup","tabForgot"].forEach(id=>{
      document.getElementById(id).classList.remove("active");
    });

    // show selected
    document.getElementById(map[screen][0]).classList.remove("hidden");
    if(map[screen][1]) document.getElementById(map[screen][1]).classList.add("active");
  },

  togglePass(id){
    const el = document.getElementById(id);
    el.type = el.type === "password" ? "text" : "password";
  },

  setMsg(id, text){
    const el = document.getElementById(id);
    el.textContent = text || "";
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

const API = {
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
        // limpa campos
        document.getElementById("su_key").value = "";
        document.getElementById("su_user").value = "";
        document.getElementById("su_email").value = "";
        document.getElementById("su_pass").value = "";
        document.getElementById("su_confirm").value = "";
        document.getElementById("su_hint").textContent = "Digite para verificar…";
        UI.show("login");
        UI.setMsg("signup_msg","");
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
    UI.show("dash");
    const token = Storage.getToken();

    try{
      const r = await fetch("/api/me", {
        headers:{ "Authorization":"Bearer " + token }
      });
      const data = await r.json();
      if(!data.ok){
        Storage.clear();
        UI.show("login");
        return;
      }

      document.getElementById("dash_me").textContent =
        `${data.payload.username} • ${data.payload.email}`;

      document.getElementById("dash_role").textContent =
        (data.payload.role === "operator" ? "Operador" : "Cliente");

    }catch{
      Storage.clear();
      UI.show("login");
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

      // Se não tiver SMTP, ele pode devolver debugLink
      if(data.debugLink){
        UI.setMsg("forgot_msg","✅ Link gerado! (sem SMTP). Abra o link no console/Render logs.");
        console.log("DEBUG LINK RESET:", data.debugLink);
      }else{
        UI.setMsg("forgot_msg","✅ Email enviado! Verifique sua caixa de entrada.");
      }
    }catch{
      UI.setMsg("forgot_msg","❌ Servidor offline");
    }
  }
};

// auto-login
(function(){
  const t = Storage.getToken();
  if(t) API.bootDash();
})();
