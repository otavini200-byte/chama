console.log("✅ app.js carregou");

// ✅ API BASE (Render)
const API_BASE =
  location.hostname.includes("github.io") || location.protocol === "file:"
    ? "https://chama-3fxc.onrender.com"
    : "";


function $(id){ return document.getElementById(id); }

function setMsg(id, text){
  const el = $(id);
  if(el) el.textContent = text || "";
}

function togglePass(id){
  const el = $(id);
  if(!el) return;
  el.type = el.type === "password" ? "text" : "password";
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

const State = {
  me: null,
  tickets: [],
  ticketFilter: "ALL",
  selectedTicketId: null
};

async function api(path, opts = {}){
  const token = Storage.getToken();
  const headers = Object.assign(
    { "Content-Type":"application/json" },
    opts.headers || {},
    token ? { "Authorization":"Bearer " + token } : {}
  );
  const r = await fetch(path, Object.assign({}, opts, { headers }));
  const data = await r.json().catch(()=>({ ok:false, message:"Resposta inválida" }));
  return { ok: r.ok && data.ok !== false, status: r.status, data };
}

function showAuth(){
  $("authWrap")?.classList.remove("hidden");
  $("appWrap")?.classList.add("hidden");
}
function showApp(){
  $("authWrap")?.classList.add("hidden");
  $("appWrap")?.classList.remove("hidden");
}

function hideAuthScreens(){
  ["screenLogin","screenSignup","screenForgot"].forEach(id => $(id)?.classList.add("hidden"));
}
function showAuthScreen(id){
  hideAuthScreens();
  $(id)?.classList.remove("hidden");
}

function setActiveNav(page){
  document.querySelectorAll(".navItem").forEach(b => {
    b.classList.toggle("active", b.dataset.page === page);
  });
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $("page_" + page)?.classList.remove("hidden");
}

function statusBadge(status){
  if(status === "OPEN") return `<span class="badge open">Aberto</span>`;
  if(status === "IN_PROGRESS") return `<span class="badge prog">Andamento</span>`;
  if(status === "RESOLVED") return `<span class="badge res">Resolvido</span>`;
  return `<span class="badge">—</span>`;
}
function remoteBadge(rs){
  if(rs === "ALLOWED") return `<span class="badge remote">Remoto: Permitido</span>`;
  if(rs === "ACTIVE") return `<span class="badge remote">Remoto: Ativo</span>`;
  if(rs === "CLOSED") return `<span class="badge remote">Remoto: Encerrado</span>`;
  return `<span class="badge remote">Remoto: —</span>`;
}
function fmtDate(ms){
  try{
    const d = new Date(ms);
    return d.toLocaleString("pt-BR");
  }catch{ return "—"; }
}

async function bootMe(){
  const res = await api("/api/me", { method:"GET" });
  if(!res.ok){
    Storage.clear();
    showAuth();
    showAuthScreen("screenLogin");
    return false;
  }
  State.me = res.data.payload;

  // topo/sidebar
  $("sbSub").textContent = State.me.role === "dev" ? "DEV" : (State.me.role === "operator" ? "Operador" : "Cliente");
  $("sbUserName").textContent = State.me.username;
  $("sbUserEmail").textContent = State.me.email;
  $("helloName").textContent = "Olá, " + State.me.username;
  $("helloSub").textContent = State.me.role === "client" ? "Painel do Cliente" : "Painel";

  // perfil
  $("p_user").textContent = State.me.username;
  $("p_email").textContent = State.me.email;
  $("p_role").textContent = State.me.role;
  $("p_company").textContent = State.me.company_key || "—";

  return true;
}

async function loadTickets(){
  const res = await api("/api/tickets/my", { method:"GET" });
  if(!res.ok){
    return;
  }
  State.tickets = res.data.tickets || [];
  renderHome();
  renderTicketsList();
}

function applyFilter(list){
  if(State.ticketFilter === "ALL") return list;
  return list.filter(t => t.status === State.ticketFilter);
}

function renderHome(){
  const tickets = State.tickets.slice();
  const open = tickets.filter(t => t.status === "OPEN").length;
  const prog = tickets.filter(t => t.status === "IN_PROGRESS").length;
  const res = tickets.filter(t => t.status === "RESOLVED").length;

  $("kpi_open").textContent = String(open);
  $("kpi_prog").textContent = String(prog);
  $("kpi_res").textContent = String(res);

  if(tickets.length){
    const t = tickets[0];
    $("lastTicketMeta").textContent = `#${t.id} • ${fmtDate(t.created_at)}`;
    $("lastTicketBody").innerHTML = `
      <div class="msgBox">
        <b>${escapeHtml(t.title)}</b>
        <div class="badges" style="margin-top:8px">
          ${statusBadge(t.status)}
          ${remoteBadge(t.remote_status)}
          <span class="badge">${escapeHtml(t.priority || "")}</span>
          <span class="badge">${escapeHtml(t.category || "")}</span>
        </div>
        <div style="margin-top:10px;color:rgba(255,255,255,.78);font-size:12px;line-height:1.35">
          ${escapeHtml((t.description||"").slice(0, 220))}${(t.description||"").length>220?"…":""}
        </div>
      </div>
    `;
  }else{
    $("lastTicketMeta").textContent = "—";
    $("lastTicketBody").innerHTML = `<span class="mutedSmall">Nenhum chamado ainda.</span>`;
  }
}

function renderTicketsList(){
  const box = $("ticketsList");
  const listAll = State.tickets.slice();
  const list = applyFilter(listAll);

  $("ticketsCount").textContent = `${list.length} chamado(s)`;

  const q = ($("globalSearch")?.value || "").trim().toLowerCase();
  const filtered = q
    ? list.filter(t => (t.title||"").toLowerCase().includes(q) || String(t.id).includes(q))
    : list;

  if(!filtered.length){
    box.innerHTML = `<div class="panelBody"><span class="mutedSmall">Nenhum chamado encontrado.</span></div>`;
    return;
  }

  const html = filtered.map(t => {
    return `
      <div class="ticketRow" data-id="${t.id}">
        <div class="ticketMeta">
          <b>#${t.id} • ${escapeHtml(t.title)}</b>
          <span class="mutedSmall">${escapeHtml(t.category)} • ${escapeHtml(t.priority)} • ${fmtDate(t.updated_at)}</span>
        </div>
        <div class="badges">
          ${statusBadge(t.status)}
          ${remoteBadge(t.remote_status)}
        </div>
      </div>
    `;
  }).join("");

  box.innerHTML = `<div class="panelBody" style="display:flex;flex-direction:column;gap:10px">${html}</div>`;

  box.querySelectorAll(".ticketRow").forEach(row => {
    row.addEventListener("click", async () => {
      const id = parseInt(row.dataset.id, 10);
      State.selectedTicketId = id;
      await renderTicketDetail(id);
    });
  });
}

async function renderTicketDetail(id){
  const box = $("ticketDetail");
  box.innerHTML = `
    <div class="panelHead">
      <b>Detalhes</b>
      <span class="mutedSmall">Carregando…</span>
    </div>
    <div class="panelBody"><span class="mutedSmall">Buscando informações…</span></div>
  `;

  const res = await api("/api/tickets/" + id, { method:"GET" });
  if(!res.ok){
    box.innerHTML = `
      <div class="panelHead"><b>Detalhes</b><span class="mutedSmall">Erro</span></div>
      <div class="panelBody"><span class="mutedSmall">Não foi possível carregar.</span></div>
    `;
    return;
  }
  const t = res.data.ticket;

  const canCloseRemote = (t.remote_status !== "CLOSED");
  const closeBtn = canCloseRemote
    ? `<button class="btn ghost" id="btnCloseRemote">Encerrar acesso remoto</button>`
    : `<button class="btn ghost" disabled>Remoto encerrado</button>`;

  box.innerHTML = `
    <div class="panelHead">
      <b>#${t.id}</b>
      <span class="mutedSmall">${fmtDate(t.created_at)}</span>
    </div>
    <div class="panelBody">
      <div class="msgBox">
        <b>${escapeHtml(t.title)}</b>
        <div class="badges" style="margin-top:10px">
          ${statusBadge(t.status)}
          ${remoteBadge(t.remote_status)}
          <span class="badge">${escapeHtml(t.priority)}</span>
          <span class="badge">${escapeHtml(t.category)}</span>
        </div>
        <div style="margin-top:10px;color:rgba(255,255,255,.78);font-size:12px;line-height:1.35">
          ${escapeHtml(t.description)}
        </div>
      </div>

      <p class="msg" id="detail_msg"></p>
      ${closeBtn}
    </div>
  `;

  const btn = $("btnCloseRemote");
  if(btn){
    btn.addEventListener("click", async () => {
      $("detail_msg").textContent = "Encerrando...";
      const r2 = await api("/api/remote/" + t.id + "/close", { method:"POST", body: "{}" });
      if(!r2.ok){
        $("detail_msg").textContent = "❌ Falha ao encerrar.";
        return;
      }
      $("detail_msg").textContent = "✅ Acesso remoto encerrado.";
      await loadTickets();
      await renderTicketDetail(t.id);
    });
  }
}

async function createTicket(){
  setMsg("ticket_msg", "Enviando...");

  const title = ($("t_title")?.value || "").trim();
  const category = $("t_category")?.value || "";
  const priority = $("t_priority")?.value || "";
  const description = ($("t_desc")?.value || "").trim();
  const consent = !!$("t_consent")?.checked;

  if(!consent){
    setMsg("ticket_msg", "❌ Marque a autorização de acesso remoto.");
    return;
  }
  if(!title || !category || !priority || !description){
    setMsg("ticket_msg", "❌ Preencha todos os campos.");
    return;
  }

  const res = await api("/api/tickets/create", {
    method:"POST",
    body: JSON.stringify({ title, category, priority, description })
  });

  if(!res.ok){
    setMsg("ticket_msg", "❌ " + (res.data.message || "Falha ao criar chamado"));
    return;
  }

  setMsg("ticket_msg", `✅ Chamado #${res.data.ticket_id} criado! Remoto: Permitido.`);
  $("t_title").value = "";
  $("t_desc").value = "";
  $("t_priority").value = "Média";
  $("t_category").value = "Sistema";

  // vai pra lista e abre o detalhe do novo ticket
  await loadTickets();
  setActiveNav("myTickets");
  State.ticketFilter = "ALL";
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
  document.querySelector('.chip[data-filter="ALL"]')?.classList.add("active");
  await renderTicketDetail(res.data.ticket_id);
}

function logout(){
  Storage.clear();
  location.reload();
}

// ===== Signup/Login/Forgot =====
const API_AUTH = {
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

    const company_key = ($("su_key")?.value || "").trim();
    const username = ($("su_user")?.value || "").trim().toLowerCase();
    const email = ($("su_email")?.value || "").trim().toLowerCase();
    const password = $("su_pass")?.value || "";
    const confirm = $("su_confirm")?.value || "";
    const role = $("su_role")?.value || "client";

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
          const el = $(id);
          if(el) el.value = "";
        });
        const hint = $("su_hint");
        if(hint){
          hint.textContent = "Digite para verificar…";
          hint.style.color = "rgba(255,255,255,.42)";
        }
        setMsg("signup_msg","");
        showAuthScreen("screenLogin");
      }, 800);

    }catch{
      setMsg("signup_msg", "❌ Servidor offline");
    }
  },

  async login(){
    setMsg("login_msg", "Conectando...");

    const login = ($("login_login")?.value || "").trim().toLowerCase();
    const password = $("login_pass")?.value || "";
    const remember = !!$("login_remember")?.checked;

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
      await bootApp();

    }catch{
      setMsg("login_msg", "❌ Servidor offline");
    }
  },

  async forgot(){
    setMsg("forgot_msg", "Enviando...");

    const email = ($("fg_email")?.value || "").trim().toLowerCase();
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

async function bootApp(){
  const ok = await bootMe();
  if(!ok) return;

  showApp();
  setActiveNav("home");

  // carrega tickets e dashboard
  await loadTickets();
}

function escapeHtml(str){
  return String(str || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

document.addEventListener("DOMContentLoaded", async () => {
  // Auth nav
  $("btnGoSignup")?.addEventListener("click", () => showAuthScreen("screenSignup"));
  $("btnForgot")?.addEventListener("click", () => showAuthScreen("screenForgot"));
  $("btnBackFromSignup")?.addEventListener("click", () => showAuthScreen("screenLogin"));
  $("btnBackFromForgot")?.addEventListener("click", () => showAuthScreen("screenLogin"));

  // Auth actions
  $("btnLogin")?.addEventListener("click", API_AUTH.login);
  $("btnSignup")?.addEventListener("click", API_AUTH.signup);
  $("btnSendForgot")?.addEventListener("click", API_AUTH.forgot);

  $("btnEyeLogin")?.addEventListener("click", (e)=>{ e.preventDefault(); togglePass("login_pass"); });
  $("btnEyeSuPass")?.addEventListener("click", (e)=>{ e.preventDefault(); togglePass("su_pass"); });
  $("btnEyeSuConfirm")?.addEventListener("click", (e)=>{ e.preventDefault(); togglePass("su_confirm"); });

  $("su_user")?.addEventListener("input", API_AUTH.checkUsername);

  // App nav
  document.querySelectorAll(".navItem").forEach(btn => {
    btn.addEventListener("click", async () => {
      const page = btn.dataset.page;
      setActiveNav(page);
      if(page === "home") renderHome();
      if(page === "myTickets") renderTicketsList();
    });
  });

  // Filters
  document.querySelectorAll(".chip").forEach(ch => {
    ch.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach(x => x.classList.remove("active"));
      ch.classList.add("active");
      State.ticketFilter = ch.dataset.filter;
      renderTicketsList();
    });
  });

  // Search
  $("globalSearch")?.addEventListener("input", () => {
    renderTicketsList();
  });

  // Create ticket
  $("btnCreateTicket")?.addEventListener("click", createTicket);

  // Logout
  $("btnLogout2")?.addEventListener("click", logout);
  $("btnLogout3")?.addEventListener("click", logout);

  // initial
  showAuth();
  showAuthScreen("screenLogin");

  // auto login
  const token = Storage.getToken();
  if(token){
    await bootApp();
  }
});

