const { contextBridge } = require("electron");
const { exec } = require("child_process");

function runPS(command) {
  return new Promise((resolve) => {
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${command}"`;
    exec(cmd, { windowsHide: true, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, out: "", err: String(err.message || err) });
      if (stderr && String(stderr).trim()) {
        // powershell às vezes escreve coisas no stderr sem ser erro real
      }
      resolve({ ok: true, out: String(stdout || "").trim(), err: "" });
    });
  });
}

async function scanWindows() {
  // ✅ OS / CPU / RAM / Uptime
  const os = await runPS("(Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture,LastBootUpTime | ConvertTo-Json -Compress)");
  const cpu = await runPS("(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed | ConvertTo-Json -Compress)");
  const mem = await runPS("(Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum | Select-Object Sum | ConvertTo-Json -Compress)");

  // ✅ Discos
  const disks = await runPS("(Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress)");

  // ✅ IP / Adaptadores
  const ip = await runPS("(Get-NetIPConfiguration | Select-Object InterfaceAlias,IPv4Address,DnsServer,Ipv4DefaultGateway | ConvertTo-Json -Compress)");

  // ✅ Internet / DNS / Port test
  const pingGoogle = await runPS("(Test-Connection 8.8.8.8 -Count 1 | Select-Object Address,ResponseTime,StatusCode | ConvertTo-Json -Compress)");
  const dnsTest = await runPS("(Resolve-DnsName google.com -ErrorAction SilentlyContinue | Select-Object Name,IPAddress | ConvertTo-Json -Compress)");
  const port80 = await runPS("(Test-NetConnection google.com -Port 80 | Select-Object ComputerName,RemotePort,TcpTestSucceeded,PingSucceeded | ConvertTo-Json -Compress)");
  const port443 = await runPS("(Test-NetConnection google.com -Port 443 | Select-Object ComputerName,RemotePort,TcpTestSucceeded,PingSucceeded | ConvertTo-Json -Compress)");

  // ✅ Conexões abertas (TCP)
  const conns = await runPS("(Get-NetTCPConnection | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess | Sort-Object State | Select-Object -First 120 | ConvertTo-Json -Compress)");

  // ✅ Portas escutando (LISTEN)
  const listening = await runPS("(Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | Sort-Object LocalPort | Select-Object -First 120 | ConvertTo-Json -Compress)");

  function parseJsonSafe(txt){
    try { return JSON.parse(txt); } catch { return null; }
  }

  const out = {
    at: Date.now(),
    os: parseJsonSafe(os.out),
    cpu: parseJsonSafe(cpu.out),
    memory: parseJsonSafe(mem.out),
    disks: parseJsonSafe(disks.out),
    ipconfig: parseJsonSafe(ip.out),

    net: {
      pingGoogle: parseJsonSafe(pingGoogle.out),
      dnsTest: parseJsonSafe(dnsTest.out),
      port80: parseJsonSafe(port80.out),
      port443: parseJsonSafe(port443.out),
    },

    tcp: {
      connections: parseJsonSafe(conns.out),
      listening: parseJsonSafe(listening.out)
    }
  };

  return { ok: true, scan: out };
}

contextBridge.exposeInMainWorld("CHAMA", {
  scan: async () => {
    return await scanWindows();
  }
});
