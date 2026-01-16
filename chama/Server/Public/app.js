console.log("✅ app.js carregou");

function $(id){ return document.getElementById(id); }

function hideAuthScreens(){
  ["screenLogin","screenSignup","screenForgot"].forEach(id => $(id)?.classList.add("hidden"));
}
function showAuthScreen(id){
  ["screenLogin","screenSignup","screenForgot"].forEach(x => $(x)?.classList.add("hidden"));
  $(id)?.classList.remove("hidden");
}

function togglePass(id){
  const el = $(id);
  if(!el) return;
  el.type = el.type === "password" ? "text" : "password";
}

function setMsg(id, text){
  const el = $(id);
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

async function api(path, options = {}){
  const token = Storage.getToken();
  const headers = options.headers || {};
  headers["Content-Type"] = "application/json";
  if(token) headers["Authorization"] = "Bearer " + token;

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok !== false, res, data };
}

// ===== APP STATE =====
const State = {
  me: null,
  role: "client",
  filter: "ALL",
  myTickets: [],
  companyTickets: []
};

function setActiveNav(key){
  document.querySelectorAll(".sbItem").forEach(el => {
    el.classList.toggle("active", el.dataset.key === key);
  });
}

function hidePages(){
  ["pageDashboard","pageNewTicket","pageMyTickets","pageCompanyTickets","pageDev","pageProfile"].forEach(id => {
    $(id)?.classList.add("hidden");
  });
}

function showPage(id){
  hidePages();
  $(id)?.classList.remove("hidden");
}

function buildSidebar(){
  const nav = $("sbNav");
  nav.innerHTML = "";

  const base = [
    { key:"dash", icon:"🏠", text:"Início", page:"pageDashboard" },
    { key:"new", icon:"➕", text:"Abrir chamado", page:"pageNewTicket", roles:["client","operator"] },
    { key:"my", icon:"🎫", text:"Meus chamados", page:"pageMyTickets", roles:["client","operator"] },
    { key:"company", icon:"🏢", text:"Chamados da empresa", page:"pageCompanyTickets", roles:["operator"] },
    { key:"dev", icon:"🧪", text:"DEV", page:"pageDev", roles:["dev"] },
    { key:"profile", icon:"👤", text:"Perfil", page:"pageProfile" },
  ];

  const items = base.filter(i => !i.roles || i.roles.includes(State.role));

  items.forEach(item => {
    const btn = document.createElement("div");
    btn.className = "sbItem";
    btn.dataset.key = item.key;

    btn.innerHTML = `
      <div class="sbIcon">${item.icon}</div>
      <div class="sbText">${item.text}</div>
    `;

    btn.addEventListener("click", async () => {
      setActiveNav(item.key);
      showPage(item.page);

      if(item.key === "my") await loadMyTickets();
      if(item.key === "company") await loadCompanyTickets();
      if(item.key === "dash") await refreshDashboard();
      if(item.key === "profile") fillProfile();
    });

    nav.appendChild(btn);
  });

  // ativa dash por padrão
  setActiveNav("dash");
}

function showApp(){
  $("authCard")?.classList.add("hidden");
  $("appShell")?.classList.remove("hidden");
}

function showAuth(){
  $("appShell")?.classList.add("hidden");
  $("authCard")?.classList.remove("hidden");
  showAuthScreen("screenLogin");
}

function badgeStatus(status){
  if(status === "ABERTO") return `<span class="badge open">ABERTO</span>`;
  if(status === "ANDAMENTO") return `<span class="badge doing">ANDAMENTO</span>`;
  if(status === "RESOLVIDO") return `<span class="badge done">RESOLVIDO</span>`;
  return `<span class="badge">${status}</span>`;
}
function badgePriority(p){
  const v = String(p || "").toLowerCase();
  if(v === "alta") return `<span class="badge open">ALTA</span>`;
  if(v === "media") return `<span class="badge doing">MÉDIA</span>`;
  return `<span class="badge done">BAIXA</span>`;
}
function badgeRemote(remote_status){
  const s = remote_status || "allowed";
  if(s === "allowed") return `<span class="badge remote">REMOTO: PERMITIDO</span>`;
  if(s === "active") return `<span class="badge remote">REMOTO: ATIVO</span>`;
  return `<span class="badge remote">REMOTO: ENCERRADO</span>`;
}

function formatDate(ms){
  const d = new Date(ms);
  return d.toLocaleString("pt-BR");
}

// ===== DATA LOADERS =====
async function loadMe(){
  const r = await api("/api/me", { method:"GET" });
  if(!r.ok){
    Storage.clear();
    return null;
  }
  return r.data.payload;
}

function countsFromTickets(list){
  const c = { ABERTO:0, ANDAMENTO:0, RESOLVIDO:0 };
  list.forEach(t => { if(c[t.status] !== undefined) c[t.status]++; });
  return c;
}

async function refreshDashboard(){
  // pega dados do tipo de usuário
  if(State.role === "operator"){
    await loadCompanyTickets();
    const c = countsFromTickets(State.companyTickets);
    $("stOpen").textContent = c.ABERTO;
    $("stDoing").textContent = c.ANDAMENTO;
    $("stDone").textContent = c.RESOLVIDO;

    const last = State.companyTickets[0];
    if(last){
      $("lastTicketSub").textContent = `#${last.id} • ${formatDate(last.created_at)}`;
      $("lastTicketBox").innerHTML = `
        <b>${last.title}</b>
        <div class="sub">${last.requester || "—"} • ${last.category}</div>
        <div class="sub">${badgeStatus(last.status)} ${badgePriority(last.priority)} ${badgeRemote(last.remote_status)}</div>
      `;
    }else{
      $("lastTicketSub").textContent = "—";
      $("lastTicketBox").innerHTML = `<span class="mutedMini">Nenhum chamado ainda.</span>`;
    }
    return;
  }

  await loadMyTickets();
  const c = countsFromTickets(State.myTickets);
  $("stOpen").textContent = c.ABERTO;
  $("stDoing").textContent = c.ANDAMENTO;
  $("stDone").textContent = c.RESOLVIDO;

  const last = State.myTickets[0];
  if(last){
    $("lastTicketSub").textContent = `#${last.id} • ${formatDate(last.created_at)}`;
    $("lastTicketBox").innerHTML = `
      <b>${last.title}</b>
      <div class="sub">${last.category}</div>
      <div class="sub">${badgeStatus(last.status)} ${badgePriority(last.priority)} ${badgeRemote(last.remote_status)}</div>
    `;
  }else{
    $("lastTicketSub").textContent = "—";
    $("lastTicketBox").innerHTML = `<span class="mutedMini">Nenhum chamado ainda.</span>`;
  }
}

async function loadMyTickets(){
  const r = await api("/api/tickets/my", { method:"GET" });
  if(!r.ok){
    $("ticketList").innerHTML = `<div class="pillSoft">Erro ao buscar chamados.</div>`;
    return;
  }
  State.myTickets = r.data.tickets || [];
  renderTicketList(State.myTickets, $("ticketList"));
}

async function loadCompanyTickets(){
  const r = await api("/api/tickets/company", { method:"GET" });
  if(!r.ok){
    $("companyTicketList").innerHTML = `<div class="pillSoft">Erro ao buscar chamados.</div>`;
    return;
  }
  State.companyTickets = r.data.tickets || [];
  renderCompanyTicketList(State.companyTickets, $("companyTicketList"));
}

function applyFilter(list){
  const f = State.filter;
  if(f === "ALL") return list;

  return list.filter(t => t.status === f);
}

function applySearch(list){
  const q = ($("searchInput")?.value || "").trim().toLowerCase();
  if(!q) return list;

  return list.filter(t =>
    String(t.title || "").toLowerCase().includes(q) ||
    String(t.category || "").toLowerCase().includes(q) ||
    String(t.description || "").toLowerCase().includes(q) ||
    String(t.id || "").includes(q)
  );
}

function renderTicketList(list, el){
  const filtered = applySearch(applyFilter(list));
  if(!filtered.length){
    el.innerHTML = `<div class="pillSoft">Nenhum chamado encontrado.</div>`;
    return;
  }

  el.innerHTML = filtered.map(t => `
    <div class="ticket">
      <div>
        <b>#${t.id} • ${t.title}</b>
        <div class="sub">${t.category} • ${formatDate(t.created_at)}</div>
        <div class="sub">Acesso remoto já permitido neste chamado ✅</div>
      </div>
      <div class="badges">
        ${badgeStatus(t.status)}
        ${badgePriority(t.priority)}
        ${badgeRemote(t.remote_status)}
      </div>
    </div>
  `).join("");
}

function renderCompanyTicketList(list, el){
  const filtered = applySearch(list);
  if(!filtered.length){
    el.innerHTML = `<div class="pillSoft">Nenhum chamado encontrado.</div>`;
    return;
  }

  el.innerHTML = filtered.map(t => `
    <div class="ticket">
      <div>
        <b>#${t.id} • ${t.title}</b>
        <div class="sub">${t.requester || "—"} • ${t.category} • ${formatDate(t.created_at)}</div>
        <div class="sub">${t.requester_email || ""}</div>
      </div>
      <div class="badges">
        ${badgeStatus(t.status)}
        ${badgePriority(t.priority)}
        ${badgeRemote(t.remote_status)}
      </div>
    </div>
  `).join("");
}

function fillProfile(){
  $("pfUser").textContent = State.me?.username || "—";
  $("pfEmail").textContent = State.me?.email || "—";
  $("pfCompany").textContent = State.me?.company_key || "—";
  $("profileRole").textContent = State.role.toUpperCase();
}

// ===== ACTIONS =====
async function createTicket(){
  setMsg("newTicketMsg", "Enviando...");

  const title = ($("t_title").value || "").trim();
  const category = $("t_category").value || "Sistema";
  const priority = $("t_priority").value || "media";
  const description = ($("t_desc").value || "").trim();

  if(!title || !description){
    setMsg("newTicketMsg", "❌ Preencha título e descrição.");
    return;
  }

  const r = await api("/api/tickets/create", {
    method:"POST",
    body: JSON.stringify({ title, category, priority, description })
  });

  if(!r.ok){
    setMsg("newTicketMsg", "❌ " + (r.data.message || "Erro ao criar chamado"));
    return;
  }

  setMsg("newTicketMsg", "✅ Chamado criado! Acesso remoto já permitido ✅");

  // limpa
  $("t_title").value = "";
  $("t_desc").value = "";
  $("t_priority").value = "media";
  $("t_category").value = "Sistema";

  // vai pra lista
  setTimeout(async () => {
    setMsg("newTicketMsg", "");
    setActiveNav("my");
    showPage("pageMyTickets");
    await loadMyTickets();
    await refreshDashboard();
  }, 700);
}

async function devGenKey(){
  setMsg("devMsg", "Gerando...");
  $("keyOut").textContent = "—";

  const r = await api("/api/dev/key/new", { method:"POST", body: JSON.stringify({}) });
  if(!r.ok){
    setMsg("devMsg", "❌ " + (r.data.message || "Falha"));
    return;
  }

  $("keyOut").textContent = r.data.company_key;
  setMsg("devMsg", "✅ Chave gerada!");
}

// ===== AUTH =====
const AUTH = {
  async checkUsername(){
    const u = ($("su_user")?.value || "").trim().toLowerCase();
    const hint = $("su_hint");
    if(!hint) return;

    if(!u){
      hint.textContent = "Digite para verificar…";
      hint.style.color = "rgba(255,255,255,.42)";
      return;
    }

    hint.textContent = "verificando…";
    hint.style.color = "rgba(255,255,255,.42)";

    try{
      const res = await fetch("/api/check-username", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ username: u })
      });
      const data = await res.json();

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

    const company_key = ($("su_key").value || "").trim();
    const username = ($("su_user").value || "").trim().toLowerCase();
    const email = ($("su_email").value || "").trim().toLowerCase();
    const password = $("su_pass").value || "";
    const confirm = $("su_confirm").value || "";
    const role = $("su_role").value || "client";

    try{
      const res = await fetch("/api/signup", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ company_key, username, email, password, confirm, role })
      });

      const data = await res.json();
      if(!data.ok){
        setMsg("signup_msg", "❌ " + (data.message || "Falha ao criar conta"));
        return;
      }

      setMsg("signup_msg", "✅ Conta criada! Voltando pro login...");

      setTimeout(()=>{
        ["su_key","su_user","su_email","su_pass","su_confirm"].forEach(id => { if($(id)) $(id).value = ""; });
        setMsg("signup_msg","");
        showAuthScreen("screenLogin");
      }, 800);

    }catch{
      setMsg("signup_msg", "❌ Servidor offline");
    }
  },

  async login(){
    setMsg("login_msg", "Conectando...");

    const login = ($("login_login").value || "").trim().toLowerCase();
    const password = $("login_pass").value || "";
    const remember = !!$("login_remember")?.checked;

    try{
      const res = await fetch("/api/login", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ login, password })
      });

      const data = await res.json();
      if(!data.ok){
        setMsg("login_msg", "❌ " + (data.message || "Falha no login"));
        return;
      }

      Storage.setToken(data.token, remember);
      setMsg("login_msg", "✅ Login OK!");
      await bootApp();

    }catch{
      setMsg("login_msg", "❌ Servidor offline");
    }
  },

  async forgot(){
    setMsg("forgot_msg", "Enviando...");

    const email = ($("fg_email").value || "").trim().toLowerCase();
    if(!email){
      setMsg("forgot_msg","❌ Digite seu email.");
      return;
    }

    try{
      const res = await fetch("/api/forgot/send", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ email })
      });

      const data = await res.json();
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

async function bootApp(){
  const me = await loadMe();
  if(!me){
    showAuth();
    return;
  }

  State.me = me;
  State.role = me.role || "client";

  $("sbRole").textContent = State.role.toUpperCase();
  $("sbUser").textContent = `${me.username} • ${me.email}`;
  $("helloTxt").textContent = `Olá, ${me.username}`;

  showApp();
  buildSidebar();
  showPage("pageDashboard");

  // perfil inicial
  fillProfile();

  // dash
  await refreshDashboard();

  // tabs
  $("ticketTabs")?.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", async () => {
      $("ticketTabs").querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      State.filter = btn.dataset.filter;
      renderTicketList(State.myTickets, $("ticketList"));
    });
  });

  // search
  $("searchInput")?.addEventListener("input", () => {
    if(!State.me) return;
    if(!$("pageMyTickets").classList.contains("hidden")){
      renderTicketList(State.myTickets, $("ticketList"));
    }else if(!$("pageCompanyTickets").classList.contains("hidden")){
      renderCompanyTicketList(State.companyTickets, $("companyTicketList"));
    }
  });
}

function logout(){
  Storage.clear();
  location.reload();
}

// ===== INIT =====
document.addEventListener("DOMContentLoaded", async () => {
  $("btnGoSignup")?.addEventListener("click", () => showAuthScreen("screenSignup"));
  $("btnForgot")?.addEventListener("click", () => showAuthScreen("screenForgot"));
  $("btnBackFromSignup")?.addEventListener("click", () => showAuthScreen("screenLogin"));
  $("btnBackFromForgot")?.addEventListener("click", () => showAuthScreen("screenLogin"));

  $("btnLogin")?.addEventListener("click", AUTH.login);
  $("btnSignup")?.addEventListener("click", AUTH.signup);
  $("btnSendForgot")?.addEventListener("click", AUTH.forgot);

  $("btnEyeLogin")?.addEventListener("click", (e) => { e.preventDefault(); togglePass("login_pass"); });
  $("btnEyeSuPass")?.addEventListener("click", (e) => { e.preventDefault(); togglePass("su_pass"); });
  $("btnEyeSuConfirm")?.addEventListener("click", (e) => { e.preventDefault(); togglePass("su_confirm"); });

  $("su_user")?.addEventListener("input", AUTH.checkUsername);

  $("btnLogout")?.addEventListener("click", logout);

  $("btnCreateTicket")?.addEventListener("click", createTicket);
  $("btnGenKey")?.addEventListener("click", devGenKey);

  // se já tem token, entra direto
  const t = Storage.getToken();
  if(t) await bootApp();
});
