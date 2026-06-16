const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { buildPackage } = require("./package-builder");
const { buildAndroidPackage } = require("./android-activation-builder");

const PORT = Number.parseInt(process.env.PACKAGE_UI_PORT || "4310", 10);
const DIST_DIR = path.resolve(__dirname, "..", "dist");

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function page() {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SmartRush Package Builder</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #f4f6f8;
      color: #151515;
      font-family: Arial, Helvetica, sans-serif;
      display: grid;
      place-items: start center;
      padding: 32px 16px;
    }
    main {
      width: min(720px, 100%);
      background: white;
      border: 1px solid #d9dee5;
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 16px 45px rgba(15, 23, 42, 0.10);
    }
    h1 { margin: 0 0 6px; font-size: 22px; }
    p { margin: 0 0 18px; color: #555; line-height: 1.45; }
    label { display: block; font-weight: 700; margin: 16px 0 6px; }
    input, select {
      width: 100%;
      border: 1px solid #c8d0d9;
      border-radius: 6px;
      padding: 10px 12px;
      font: inherit;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    button {
      margin-top: 18px;
      border: 0;
      border-radius: 6px;
      background: #151515;
      color: white;
      cursor: pointer;
      font-weight: 800;
      padding: 11px 14px;
    }
    button:disabled { opacity: .6; cursor: wait; }
    .result {
      margin-top: 18px;
      border-radius: 6px;
      padding: 12px;
      background: #f1f5f9;
      white-space: pre-wrap;
      font-family: Consolas, monospace;
      font-size: 13px;
    }
    a { color: #0f5bd7; font-weight: 700; }
    [hidden] { display: none !important; }
    @media (max-width: 640px) { .row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>SmartRush Package Builder</h1>
    <p>Genera un ZIP instalable para Windows, macOS o Android. Cada token se crea nuevo para esa instalacion.</p>

    <form id="form">
      <label for="branchId">Branch ID</label>
      <input id="branchId" name="branchId" required placeholder="89f2ddc1-b077-4503-860c-f1f79c4e2a3e">

      <label for="platform">Instalador</label>
      <select id="platform" name="platform" required>
        <option value="macos">macOS ZIP</option>
        <option value="windows">Windows ZIP</option>
        <option value="android">Android APK + QR</option>
      </select>

      <div id="androidOptions" hidden>
        <label for="expiresMinutes">Vencimiento QR Android en minutos</label>
        <input id="expiresMinutes" name="expiresMinutes" type="number" min="5" max="1440" value="30">
      </div>

      <button id="submit" type="submit">Generar</button>
    </form>

    <div id="result" class="result" hidden></div>
  </main>

  <script>
    const form = document.getElementById("form");
    const button = document.getElementById("submit");
    const result = document.getElementById("result");
    const platform = document.getElementById("platform");
    const androidOptions = document.getElementById("androidOptions");

    function syncAndroidOptions() {
      androidOptions.hidden = platform.value !== "android";
    }

    platform.addEventListener("change", syncAndroidOptions);
    syncAndroidOptions();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      result.hidden = false;
      const payload = Object.fromEntries(new FormData(form).entries());
      result.textContent = "Generando paquete...";

      try {
        const response = await fetch("/api/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Error generando archivo");

        if (data.artifactType === "android-package") {
          result.innerHTML = [
            "ZIP Android generado correctamente.",
            "Sucursal: " + data.branchName,
            "Activation ID: " + data.activationId,
            "Vence: " + new Date(data.expiresAt).toLocaleString(),
            "Archivo: " + data.fileName,
            "",
            '<a href="' + data.downloadUrl + '">Descargar ZIP Android</a>'
          ].join("\\n");
        } else {
          result.innerHTML = [
            "ZIP generado correctamente.",
            "Sucursal: " + data.branchName,
            "Agent ID: " + data.agentId,
            "Version: " + data.sourceVersion,
            "Archivo: " + data.fileName,
            "",
            '<a href="' + data.downloadUrl + '">Descargar ZIP</a>'
          ].join("\\n");
        }
      } catch (error) {
        result.textContent = "Error: " + error.message;
      } finally {
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

async function handleBuild(request, response) {
  const body = await readBody(request);
  const payload = JSON.parse(body || "{}");

  if (payload.platform === "android") {
    const result = await buildAndroidPackage({
      branchId: String(payload.branchId || "").trim(),
      expiresMinutes: payload.expiresMinutes,
    });
    const fileName = path.basename(result.zipPath);

    json(response, 200, {
      artifactType: "android-package",
      fileName,
      downloadUrl: `/download/${encodeURIComponent(fileName)}`,
      branchName: result.branch.name || result.branch.id,
      activationId: result.activationId,
      expiresAt: result.expiresAt,
    });
    return;
  }

  const result = await buildPackage({
    platform: payload.platform,
    branchId: String(payload.branchId || "").trim(),
  });

  const fileName = path.basename(result.zipPath);
  json(response, 200, {
    fileName,
    downloadUrl: `/download/${encodeURIComponent(fileName)}`,
    branchName: result.branch.name || result.branch.id,
    agentId: result.agentId,
    agentCode: result.agentCode,
    sourceVersion: result.sourceVersion,
  });
}

function handleDownload(request, response) {
  const fileName = decodeURIComponent(request.url.split("/download/")[1] || "");
  const safeName = path.basename(fileName);
  const filePath = path.join(DIST_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".zip": "application/zip",
  };
  const ext = path.extname(safeName).toLowerCase();

  response.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${safeName}"`,
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(page());
      return;
    }

    if (request.method === "POST" && request.url === "/api/build") {
      await handleBuild(request, response);
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/download/")) {
      handleDownload(request, response);
      return;
    }

    response.writeHead(404);
    response.end("Not found");
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

function startServer() {
  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`SmartRush Package Builder: ${url}`);
    if (process.env.PACKAGE_UI_NO_OPEN === "true") {
      return;
    }
    if (process.platform === "win32") {
      require("node:child_process").exec(`start ${url}`);
    } else if (process.platform === "darwin") {
      require("node:child_process").exec(`open ${url}`);
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
};
