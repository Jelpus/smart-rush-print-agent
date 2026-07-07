const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createClient } = require("@supabase/supabase-js");
const { config } = require("../config");
const { httpError } = require("./http");

const PROJECT_ROOT = process.cwd();

const PLATFORM_CONFIG = {
  macos: {
    packageName: "SmartRush-Print-Agent-macOS",
    label: "macOS",
    packagingDir: path.join(PROJECT_ROOT, "packaging", "macos"),
    rootFiles: [
      "install-macos.command",
      "uninstall-macos.command",
      "test-connection.command",
      "README-cliente.txt",
    ],
  },
  windows: {
    packageName: "SmartRush-Print-Agent-Windows",
    label: "Windows",
    packagingDir: path.join(PROJECT_ROOT, "packaging", "windows"),
    rootFiles: [
      "install-windows.cmd",
      "install-windows.ps1",
      "uninstall-windows.cmd",
      "uninstall-windows.ps1",
      "test-connection.cmd",
      "test-connection.ps1",
      "README-cliente.txt",
    ],
  },
};

const PLATFORM_ALIASES = {
  darwin: "macos",
  mac: "macos",
  macos: "macos",
  osx: "macos",
  win: "windows",
  windows: "windows",
};

function requireDistributionConfig() {
  if (!config.supabaseUrl) throw httpError(500, "missing_supabase_url", "SUPABASE_URL is not configured");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw httpError(500, "missing_service_role", "SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  if (!process.env.SUPABASE_ANON_KEY) {
    throw httpError(500, "missing_anon_key", "SUPABASE_ANON_KEY is not configured");
  }
}

function supabaseAdmin() {
  requireDistributionConfig();
  return createClient(config.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function cleanString(value) {
  return String(value || "").trim();
}

function normalizePlatform(value) {
  const key = cleanString(value).toLowerCase();
  const platform = PLATFORM_ALIASES[key];
  if (!platform) {
    throw httpError(400, "invalid_platform", "platform must be windows or macos");
  }
  return platform;
}

function getSourceVersion() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

async function getBranch({ supabase, tenantId, branchId }) {
  const cleanBranchId = cleanString(branchId);
  if (!cleanBranchId) throw httpError(400, "missing_branch_id", "branchId is required");

  let query = supabase
    .from("branches")
    .select("id,tenant_id,name")
    .eq("id", cleanBranchId);

  const cleanTenantId = cleanString(tenantId);
  if (cleanTenantId) query = query.eq("tenant_id", cleanTenantId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "branch_not_found", "Branch not found for this tenant");

  return data;
}

async function createDesktopAgent({ tenantId, branchId, platform, agentName, agentCode }) {
  const supabase = supabaseAdmin();
  const branch = await getBranch({ supabase, tenantId, branchId });
  const platformLabel = PLATFORM_CONFIG[platform].label;

  const { data, error } = await supabase.rpc("create_print_agent", {
    p_tenant_id: branch.tenant_id,
    p_branch_id: branch.id,
    p_name: cleanString(agentName) || `SmartRush Agent ${platformLabel}`,
    p_agent_code: cleanString(agentCode) || null,
    p_platform: platform,
  });

  if (error) throw error;
  const row = data?.[0];
  if (!row?.agent_token || !row?.agent_id) {
    throw httpError(500, "agent_not_created", "Supabase did not return desktop agent credentials");
  }

  return {
    branch,
    agentId: row.agent_id,
    agentToken: row.agent_token,
    agentCode: cleanString(agentCode) || null,
  };
}

function buildEnvFile({ agentId, agentToken }) {
  return [
    `SUPABASE_URL=${config.supabaseUrl}`,
    `SUPABASE_ANON_KEY=${process.env.SUPABASE_ANON_KEY}`,
    `PRINT_AGENT_TOKEN=${agentToken}`,
    "",
    "PRINT_JOBS_TABLE=print_jobs",
    "BRANCH_PRINTERS_TABLE=branch_printers",
    "CLAIM_PRINT_JOBS_FUNCTION=claim_print_jobs_for_agent",
    "COMPLETE_PRINT_JOB_FUNCTION=complete_print_job_for_agent",
    "FAIL_PRINT_JOB_FUNCTION=fail_print_job_for_agent",
    "GET_AGENT_PRINTERS_FUNCTION=get_agent_printers",
    "",
    `AGENT_ID=${agentId}`,
    "",
    "POLL_INTERVAL_MS=5000",
    "BATCH_SIZE=5",
    "RETRY_DELAY_MS=30000",
    "ALLOW_ENV_PRINTER_FALLBACK=false",
    "",
    "PRINTER_PORT=9100",
    "PRINTER_CONNECT_TIMEOUT_MS=3000",
    "DISCOVERY_PING_TIMEOUT_MS=120",
    "DISCOVERY_CONCURRENCY=48",
    "",
    "PRINTER_ENCODING=cp858",
    "CUT_AFTER_PRINT=true",
    "FEED_LINES_BEFORE_CUT=6",
    "",
    "AUTO_UPDATE_ENABLED=true",
    "UPDATE_REPO=Jelpus/smart-rush-print-agent",
    "UPDATE_BRANCH=main",
    "",
  ].join("\n");
}

function buildRuntimePackageJson() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
  return `${JSON.stringify(
    {
      name: "smartrush-print-agent",
      version: packageJson.version,
      private: true,
      main: "src/index.js",
      type: "commonjs",
      scripts: {
        start: "node src/index.js",
        "check-agent": "node scripts/check-agent.js",
      },
      dependencies: {
        "@supabase/supabase-js": packageJson.dependencies["@supabase/supabase-js"],
        dotenv: packageJson.dependencies.dotenv,
        "iconv-lite": packageJson.dependencies["iconv-lite"],
        pngjs: packageJson.dependencies.pngjs,
        tar: packageJson.dependencies.tar,
      },
    },
    null,
    2,
  )}\n`;
}

function normalizeZipPath(value) {
  return value.replaceAll("\\", "/");
}

function modeForZipEntry(relativePath) {
  if (relativePath.endsWith(".command")) return 0o755;
  return 0o644;
}

function appendPathRecursive(archive, sourcePath, zipPath) {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(sourcePath).sort()) {
      appendPathRecursive(archive, path.join(sourcePath, entry), path.join(zipPath, entry));
    }
    return;
  }

  const name = normalizeZipPath(zipPath);
  archive.file(sourcePath, {
    name,
    mode: modeForZipEntry(name),
  });
}

async function zipToBuffer(buildArchive) {
  const { ZipArchive } = await import("archiver");
  const archive = new ZipArchive({ zlib: { level: 9 } });
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

function appendDesktopRuntime(archive, { envText, sourceVersion }) {
  const appRoot = "SmartRushPrintAgent";

  appendPathRecursive(archive, path.join(PROJECT_ROOT, "src"), path.join(appRoot, "src"));
  appendPathRecursive(archive, path.join(PROJECT_ROOT, "README.md"), path.join(appRoot, "README.md"));

  for (const script of ["check-agent.js", "send-raw-windows-printer.ps1"]) {
    appendPathRecursive(
      archive,
      path.join(PROJECT_ROOT, "scripts", script),
      path.join(appRoot, "scripts", script),
    );
  }

  archive.append(buildRuntimePackageJson(), { name: `${appRoot}/package.json`, mode: 0o644 });
  archive.append(envText, { name: `${appRoot}/.env.locale`, mode: 0o600 });
  archive.append(`${sourceVersion}\n`, { name: `${appRoot}/.update-version`, mode: 0o644 });
}

async function buildDesktopPackage(input) {
  const platform = normalizePlatform(input?.platform);
  const platformConfig = PLATFORM_CONFIG[platform];
  const createdAgent = await createDesktopAgent({
    tenantId: input?.tenantId,
    branchId: input?.branchId,
    platform,
    agentName: input?.agentName,
    agentCode: input?.agentCode,
  });
  const sourceVersion = getSourceVersion();
  const envText = buildEnvFile({
    agentId: createdAgent.agentId,
    agentToken: createdAgent.agentToken,
  });

  const zip = await zipToBuffer(async (archive) => {
    appendDesktopRuntime(archive, { envText, sourceVersion });

    for (const file of platformConfig.rootFiles) {
      appendPathRecursive(archive, path.join(platformConfig.packagingDir, file), file);
    }
  });

  return {
    platform,
    branch: createdAgent.branch,
    agentId: createdAgent.agentId,
    agentCode: createdAgent.agentCode,
    sourceVersion,
    fileName: `${createdAgent.branch.id}-${platform}.zip`,
    zip,
  };
}

module.exports = {
  PLATFORM_CONFIG,
  buildDesktopPackage,
  normalizePlatform,
};
