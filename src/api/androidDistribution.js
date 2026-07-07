const archiver = require("archiver");
const QRCode = require("qrcode");
const { createClient } = require("@supabase/supabase-js");
const { config } = require("../config");
const { httpError } = require("./http");

function requireActivationConfig() {
  if (!config.supabaseUrl) throw httpError(500, "missing_supabase_url", "SUPABASE_URL is not configured");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw httpError(500, "missing_service_role", "SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  if (!process.env.SUPABASE_ANON_KEY) {
    throw httpError(500, "missing_anon_key", "SUPABASE_ANON_KEY is not configured");
  }
}

function supabaseAdmin() {
  requireActivationConfig();
  return createClient(config.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function asPositiveInt(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw httpError(400, "invalid_expires_minutes", "expiresMinutes must be a positive integer");
  }
  return parsed;
}

function cleanString(value) {
  return String(value || "").trim();
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
  const payload = {
    type: "smartrush-print-agent-activation",
    version: 1,
    platform: "android",
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    activationId: row.activation_id,
    activationSecret: row.activation_secret,
  };

  const updateManifestUrl = cleanString(
    process.env.ANDROID_UPDATE_MANIFEST_URL || process.env.UPDATE_MANIFEST_URL,
  );
  if (updateManifestUrl) payload.androidUpdateManifestUrl = updateManifestUrl;
  return payload;
}

function buildActivationHtml({ row, qrDataUrl }) {
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

async function assertBranchAccess(supabase, { tenantId, branchId }) {
  if (!tenantId) return;
  const { data, error } = await supabase
    .from("branches")
    .select("id,tenant_id")
    .eq("id", branchId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw httpError(404, "branch_not_found", "Branch not found for this tenant");
  }
}

async function createAndroidActivation({ tenantId, branchId, agentName, agentCode, expiresMinutes }) {
  const cleanBranchId = cleanString(branchId);
  if (!cleanBranchId) throw httpError(400, "missing_branch_id", "branchId is required");

  const supabase = supabaseAdmin();
  await assertBranchAccess(supabase, {
    tenantId: cleanString(tenantId),
    branchId: cleanBranchId,
  });

  const { data, error } = await supabase.rpc("create_print_agent_activation", {
    p_branch_id: cleanBranchId,
    p_agent_name: cleanString(agentName) || null,
    p_agent_code: cleanString(agentCode) || null,
    p_expires_minutes: asPositiveInt(expiresMinutes, 30),
  });

  if (error) throw error;
  const row = data?.[0];
  if (!row?.activation_id || !row?.activation_secret) {
    throw httpError(500, "activation_not_created", "Supabase did not return activation credentials");
  }

  const payload = buildActivationPayload(row);
  const qrText = JSON.stringify(payload);
  const qrDataUrl = await QRCode.toDataURL(qrText, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 420,
  });
  const qrPng = await QRCode.toBuffer(qrText, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 640,
    type: "png",
  });
  const html = buildActivationHtml({ row, qrDataUrl });
  const json = {
    ...payload,
    branchName: row.branch_name,
    branchId: row.branch_id,
    tenantId: row.tenant_id,
    expiresAt: row.expires_at,
  };

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
    payload,
    qrText,
    qrDataUrl,
    qrPng,
    html,
    json,
  };
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SmartRush-Print-Service",
    },
  });

  if (!response.ok) {
    throw httpError(502, "apk_download_failed", `APK download failed with HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function clientReadme({ includeApk }) {
  return [
    "SmartRush Print Agent para Android",
    "==================================",
    "",
    "Contenido de este paquete:",
    "",
    includeApk ? "- SmartRush-Print-Agent-Android.apk" : "- APK no incluido en este paquete",
    "- activar-android.html",
    "- activar-android.png",
    "- activar-android.json",
    "",
    "Instalacion",
    "-----------",
    "",
    includeApk
      ? "1. Copia SmartRush-Print-Agent-Android.apk al telefono Android."
      : "1. Instala SmartRush Print Agent desde la URL oficial de descarga.",
    "2. Abre el APK desde el telefono.",
    "3. Si Android pregunta, permite instalar apps de origen desconocido para esta instalacion.",
    "4. Abre SmartRush Print Agent.",
    "5. Pulsa Escanear codigo QR.",
    "6. Escanea el QR de activar-android.html o activar-android.png.",
    "7. La app quedara vinculada a la sucursal.",
    "8. Por seguridad, el agente queda en modo pausado.",
    "9. Para que empiece a reclamar trabajos, pulsa Agente pausado - activar.",
    "",
    "Notas",
    "-----",
    "",
    "- El QR es temporal y de un solo uso.",
    "- Si vence o ya fue usado, genera otro QR desde SmartRush.",
    "- El telefono debe estar en la misma red local que las impresoras para imprimir por TCP 9100.",
    "",
  ].join("\n");
}

async function zipToBuffer(buildArchive) {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks = [];

  archive.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const done = new Promise((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
    archive.on("warning", reject);
  });

  await buildArchive(archive);
  await archive.finalize();
  await done;

  return Buffer.concat(chunks);
}

async function buildAndroidPackage(input) {
  const activation = await createAndroidActivation(input);
  const apkUrl = cleanString(process.env.ANDROID_APK_URL);
  if (!apkUrl) {
    throw httpError(500, "missing_android_apk_url", "ANDROID_APK_URL is required for package downloads");
  }

  const apk = await fetchBuffer(apkUrl);
  const zip = await zipToBuffer(async (archive) => {
    archive.append(apk, { name: "SmartRush-Print-Agent-Android.apk" });
    archive.append(activation.html, { name: "activar-android.html" });
    archive.append(activation.qrPng, { name: "activar-android.png" });
    archive.append(`${JSON.stringify(activation.json, null, 2)}\n`, { name: "activar-android.json" });
    archive.append(clientReadme({ includeApk: true }), { name: "README-cliente.txt" });
  });

  return {
    activation,
    fileName: `${activation.branch.id}-android.zip`,
    zip,
  };
}

module.exports = {
  buildAndroidPackage,
  createAndroidActivation,
};
