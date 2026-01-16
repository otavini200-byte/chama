const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow(){
  const win = new BrowserWindow({
    width: 430,
    height: 680,
    resizable: false,
    backgroundColor: "#0b0d12",
    title: "Remote Desk • Agent",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile(path.join(__dirname, "login.html"));
}

app.whenReady().then(createWindow);
