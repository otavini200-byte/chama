function qs(name){
  const url = new URL(location.href);
  return url.searchParams.get(name) || "";
}

function togglePass(id){
  const el = document.getElementById(id);
  el.type = el.type === "password" ? "text" : "password";
}

function setPill(text, ok=true){
  const pill = document.getElementById("statePill");
  pill.textContent = text;
  pill.style.borderColor = ok ? "rgba(46,229,157,.40)" : "rgba(255,75,146,.40)";
  pill.style.background = ok ? "rgba(46,229,157,.10)" : "rgba(255,75,146,.10)";
}

async function verify(){
  const token = qs("token");
  if(!token){
    setPill("Token inválido ❌", false);
    return;
  }

  try{
    const r = await fetch(`/api/reset/verify?token=${encodeURIComponent(token)}`);
    const data = await r.json();
    if(!data.ok){
      setPill("Token inválido ou expirado ❌", false);
      return;
    }
    setPill("Token OK ✅ Agora crie sua nova senha", true);
  }catch{
    setPill("Servidor offline ❌", false);
  }
}

async function confirmReset(){
  const token = qs("token");
  const password = document.getElementById("r_pass").value;
  const confirm = document.getElementById("r_confirm").value;

  const msg = document.getElementById("r_msg");
  msg.textContent = "Salvando...";

  try{
    const r = await fetch("/api/reset/confirm", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ token, password, confirm })
    });

    const data = await r.json();
    if(!data.ok){
      msg.textContent = "❌ " + (data.message || "Falha");
      return;
    }

    msg.textContent = "✅ Senha atualizada! Voltando pro login...";
    setTimeout(()=>location.href="/", 1000);

  }catch{
    msg.textContent = "❌ Servidor offline";
  }
}

function goHome(){
  location.href="/";
}

verify();
