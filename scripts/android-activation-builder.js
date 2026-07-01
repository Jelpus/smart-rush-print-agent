const fs = require("node:fs");
const path = require("node:path");
const { ZipArchive } = require("archiver");
const QRCode = require("qrcode");
const { createClient } = require("@supabase/supabase-js");
const { config } = require("../src/config");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");
const ANDROID_APK_PATH = path.join(
  PROJECT_ROOT,
  "android-agent",
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk",
);
const ANDROID_README_PATH = path.join(PROJECT_ROOT, "packaging", "android", "README-cliente.txt");

function requireActivationConfig() {
  if (!config.supabaseUrl) throw new Error("SUPABASE_URL is required");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required only on the internal packaging machine");
  }
  if (!process.env.SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_ANON_KEY is required to build Android activation QR codes");
  }
}

function asPositiveInt(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error("expiresMinutes must be a positive integer");
  }
  return parsed;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  return new Date(value).toLocaleString("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function buildActivationPayload(row) {
  return {
    type: "smartrush-print-agent-activation",
    version: 1,
    platform: "android",
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    activationId: row.activation_id,
    activationSecret: row.activation_secret,
  };
}

function buildHtml({ row, qrDataUrl }) {
  const branchName = row.branch_name || row.branch_id;
  const expiresAt = formatDate(row.expires_at);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SmartRush Android Activation</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #f6f7f9;
      color: #161616;
      font-family: Arial, Helvetica, sans-serif;
      display: grid;
      place-items: center;
      padding: 32px 16px;
    }
    main {
      width: min(560px, 100%);
      background: #fff;
      border: 1px solid #d9dee5;
      border-radius: 8px;
      padding: 28px;
      text-align: center;
      box-shadow: 0 16px 45px rgba(15, 23, 42, 0.10);
    }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { margin: 0; color: #50555c; line-height: 1.45; }
    img {
      width: min(360px, 100%);
      height: auto;
      margin: 24px auto;
      display: block;
      border: 12px solid #fff;
      box-shadow: 0 0 0 1px #d9dee5;
    }
    dl {
      display: grid;
      grid-template-columns: 130px 1fr;
      gap: 8px 12px;
      margin: 20px 0 0;
      text-align: left;
    }
    dt { color: #5b616b; font-weight: 700; }
    dd { margin: 0; overflow-wrap: anywhere; }
    @media print {
      body { background: #fff; padding: 0; }
      main { box-shadow: none; border: 0; }
    }
  </style>
</head>
<body>
  <main>
    <h1>SmartRush Android</h1>
    <p>Escanea este QR desde la app para activar el agente de impresion.</p>
    <img src="${qrDataUrl}" alt="Codigo QR de activacion Android">
    <dl>
      <dt>Sucursal</dt>
      <dd>${escapeHtml(branchName)}</dd>
      <dt>Activation ID</dt>
      <dd>${escapeHtml(row.activation_id)}</dd>
      <dt>Vence</dt>
      <dd>${escapeHtml(expiresAt)}</dd>
    </dl>
  </main>
</body>
</html>`;
}

async function createAndroidActivation({ branchId, agentName, agentCode, expiresMinutes }) {
  requireActivationConfig();
  const cleanBranchId = String(branchId || "").trim();
  if (!cleanBranchId) throw new Error("branchId is required");

  const supabase = createClient(config.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("create_print_agent_activation", {
    p_branch_id: cleanBranchId,
    p_agent_name: agentName || null,
    p_agent_code: agentCode || null,
    p_expires_minutes: asPositiveInt(expiresMinutes, 30),
  });

  if (error) throw error;
  const row = data?.[0];
  if (!row?.activation_id || !row?.activation_secret) {
    throw new Error("create_print_agent_activation did not return activation credentials");
  }

  const qrPayload = buildActivationPayload(row);
  const qrText = JSON.stringify(qrPayload);
  const baseName = `${cleanBranchId}-android-activation`;
  const jsonPath = path.join(DIST_DIR, `${baseName}.json`);
  const pngPath = path.join(DIST_DIR, `${baseName}.png`);
  const htmlPath = path.join(DIST_DIR, `${baseName}.html`);

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        ...qrPayload,
        branchName: row.branch_name,
        branchId: row.branch_id,
        tenantId: row.tenant_id,
        expiresAt: row.expires_at,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await QRCode.toFile(pngPath, qrText, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 640,
  });

  const qrDataUrl = await QRCode.toDataURL(qrText, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 420,
  });
  fs.writeFileSync(htmlPath, buildHtml({ row, qrDataUrl }), "utf8");

  return {
    platform: "android",
    branch: {
      id: row.branch_id,
      tenant_id: row.tenant_id,
      name: row.branch_name,
    },
    activationId: row.activation_id,
    expiresAt: row.expires_at,
    agentName: row.agent_name,
    agentCode: row.agent_code,
    payload: qrPayload,
    jsonPath,
    pngPath,
    htmlPath,
  };
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

async function zipDirectory({ sourceDir, zipPath }) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.rmSync(zipPath, { force: true });

  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.pipe(output);

  function addEntry(fullPath, relativePath) {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(fullPath)) {
        addEntry(path.join(fullPath, entry), path.join(relativePath, entry));
      }
      return;
    }

    archive.file(fullPath, { name: relativePath.replaceAll("\\", "/") });
  }

  for (const entry of fs.readdirSync(sourceDir)) {
    addEntry(path.join(sourceDir, entry), entry);
  }

  await archive.finalize();
  await new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
  });
}

async function buildAndroidPackage({ branchId, agentName, agentCode, expiresMinutes }) {
  if (!fs.existsSync(ANDROID_APK_PATH)) {
    throw new Error("Android APK not found. Build android-agent first with gradlew assembleDebug.");
  }
  if (!fs.existsSync(ANDROID_README_PATH)) {
    throw new Error("Android README template not found");
  }

  const activation = await createAndroidActivation({
    branchId,
    agentName,
    agentCode,
    expiresMinutes,
  });

  const cleanBranchId = String(branchId || "").trim();
  const packageName = `${cleanBranchId}-android`;
  const packageDir = path.join(DIST_DIR, "SmartRush-Print-Agent-Android");
  const zipPath = path.join(DIST_DIR, `${packageName}.zip`);

  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });

  copyFile(ANDROID_APK_PATH, path.join(packageDir, "SmartRush-Print-Agent-Android.apk"));
  copyFile(activation.htmlPath, path.join(packageDir, "activar-android.html"));
  copyFile(activation.pngPath, path.join(packageDir, "activar-android.png"));
  copyFile(ANDROID_README_PATH, path.join(packageDir, "README-cliente.txt"));

  await zipDirectory({ sourceDir: packageDir, zipPath });

  return {
    ...activation,
    packageName,
    packageDir,
    zipPath,
    apkPath: path.join(packageDir, "SmartRush-Print-Agent-Android.apk"),
    clientHtmlPath: path.join(packageDir, "activar-android.html"),
    clientPngPath: path.join(packageDir, "activar-android.png"),
  };
}

async function buildAndroidQrPackage({ branchId, agentName, agentCode, expiresMinutes }) {
  const activation = await createAndroidActivation({
    branchId,
    agentName,
    agentCode,
    expiresMinutes,
  });

  const cleanBranchId = String(branchId || "").trim();
  const packageName = `${cleanBranchId}-android-qr`;
  const packageDir = path.join(DIST_DIR, "SmartRush-Print-Agent-Android-QR");
  const zipPath = path.join(DIST_DIR, `${packageName}.zip`);

  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });

  copyFile(activation.htmlPath, path.join(packageDir, "activar-android.html"));
  copyFile(activation.pngPath, path.join(packageDir, "activar-android.png"));
  copyFile(activation.jsonPath, path.join(packageDir, "activar-android.json"));
  fs.writeFileSync(
    path.join(packageDir, "README-cliente.txt"),
    [
      "SmartRush Print Agent para Android - solo QR",
      "============================================",
      "",
      "Usa este paquete cuando la app Android ya esta instalada y solo necesitas vincularla otra vez.",
      "",
      "Contenido:",
      "",
      "- activar-android.html",
      "- activar-android.png",
      "- activar-android.json",
      "",
      "Pasos:",
      "",
      "1. Abre SmartRush Print Agent en el telefono Android.",
      "2. Pulsa Escanear codigo QR.",
      "3. Escanea el QR de activar-android.html o activar-android.png.",
      "4. La app quedara vinculada a la sucursal.",
      "",
      "El QR es temporal y de un solo uso.",
      "",
    ].join("\n"),
    "utf8",
  );

  await zipDirectory({ sourceDir: packageDir, zipPath });

  return {
    ...activation,
    artifactType: "android-qr",
    packageName,
    packageDir,
    zipPath,
    clientHtmlPath: path.join(packageDir, "activar-android.html"),
    clientPngPath: path.join(packageDir, "activar-android.png"),
    clientJsonPath: path.join(packageDir, "activar-android.json"),
  };
}

module.exports = {
  buildAndroidPackage,
  buildAndroidQrPackage,
  createAndroidActivation,
};
