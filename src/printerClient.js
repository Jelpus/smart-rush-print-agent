const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { config } = require("./config");

function printRawNetwork({ ip, port }, buffer) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    function finish(error) {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    }

    socket.setTimeout(config.printerConnectTimeoutMs);
    socket.once("timeout", () => finish(new Error(`Printer connection timed out: ${ip}:${port}`)));
    socket.once("error", finish);
    socket.connect(port, ip, () => {
      socket.write(buffer, (error) => {
        if (error) {
          finish(error);
          return;
        }

        socket.end();
      });
    });
    socket.once("close", () => finish());
  });
}

function execFilePromise(file, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve(stdout);
    });
  });
}

async function printRawWindowsSpooler({ printerName }, buffer) {
  if (process.platform !== "win32") {
    throw new Error("windows_spooler printing is only available on Windows");
  }

  if (!printerName) {
    throw new Error("windows_spooler connection requires printer_name");
  }

  const tempFile = path.join(os.tmpdir(), `smartrush-ticket-${Date.now()}-${process.pid}.bin`);
  const scriptPath = path.resolve(__dirname, "..", "scripts", "send-raw-windows-printer.ps1");

  fs.writeFileSync(tempFile, buffer);
  try {
    await execFilePromise("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-PrinterName",
      printerName,
      "-FilePath",
      tempFile,
    ]);
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
}

async function printRawCups({ printerName }, buffer) {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error("cups printing is only available on macOS/Linux");
  }

  if (!printerName) {
    throw new Error("cups connection requires printer_name");
  }

  const tempFile = path.join(os.tmpdir(), `smartrush-ticket-${Date.now()}-${process.pid}.bin`);
  fs.writeFileSync(tempFile, buffer);
  try {
    await execFilePromise("lp", ["-d", printerName, "-o", "raw", tempFile]);
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
}

module.exports = {
  printRawCups,
  printRawNetwork,
  printRawWindowsSpooler,
};
