const { execFile } = require("node:child_process");

function execText(file, args, timeoutMs = 8000) {
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

async function windowsPrinterExists(printerName) {
  if (process.platform !== "win32") return false;
  if (!printerName) return false;

  const escaped = printerName.replaceAll("'", "''");
  try {
    const output = await execText("powershell.exe", [
      "-NoProfile",
      "-Command",
      `if (Get-Printer -Name '${escaped}' -ErrorAction SilentlyContinue) { 'FOUND' }`,
    ]);
    return output.includes("FOUND");
  } catch {
    return false;
  }
}

async function cupsPrinterExists(printerName) {
  if (process.platform !== "darwin" && process.platform !== "linux") return false;
  if (!printerName) return false;

  try {
    const output = await execText("lpstat", ["-p", printerName], 8000);
    return output.includes(`printer ${printerName}`);
  } catch {
    return false;
  }
}

module.exports = {
  cupsPrinterExists,
  windowsPrinterExists,
};
