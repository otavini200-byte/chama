function setMsg(text){
  document.getElementById("reset_msg").textContent = text || "";
}

function getToken(){
  const url = new URL(location.href);
  return url.searchParams.get("token") || "";
}

async function verifyToken(token){
  const r = await fetch("/api/reset/verify?token=" + encodeURIComponent(token));
  return await r.json();
}

async function confirmReset(token, password, confirm){
  const r = await fetch("/api/reset/confirm", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ token, password, confirm })
  });
  return await r.json();
}

document.addEventListener("DOMContentLoaded", async () => {
  const token = getToken();
  if(!token){
    setMsg("❌ Token inválido.");
    return;
  }

  try{
    const v = await verifyToken(token);
    if(!v.ok){
      setMsg("❌ Token inválido/expirado.");
      return;
    }
    setMsg("✅ Token válido. Digite a nova senha.");
  }catch{
    setMsg("❌ Servidor offline.");
    return;
  }

  document.getElementById("btnReset").addEventListener("click", async () => {
    const pass = document.getElementById("rp_pass").value || "";
    const conf = document.getElementById("rp_confirm").value || "";

    setMsg("Atualizando...");

    try{
      const data = await confirmReset(token, pass, conf);
      if(!data.ok){
        setMsg("❌ " + (data.message || "Erro."));
        return;
      }
      setMsg("✅ Senha atualizada! Pode voltar pro login.");
    }catch{
      setMsg("❌ Servidor offline.");
    }
  });
});
