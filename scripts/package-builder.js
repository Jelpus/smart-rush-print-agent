const fs = require("node:fs");
const path = require("node:path");
const { ZipArchive } = require("archiver");
const { createClient } = require("@supabase/supabase-js");
const { execFileSync } = require("node:child_process");
const { config } = require("../src/config");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");

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

function assertPlatform(platform) {
  if (!PLATFORM_CONFIG[platform]) {
    throw new Error(`Platform not supported yet: ${platform}`);
  }
}

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function requireBuildConfig() {
  if (!config.supabaseUrl) throw new Error("SUPABASE_URL is required");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required only on the internal packaging machine");
  }
  if (!process.env.SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_ANON_KEY is required to build client packages");
  }
}

function getSourceVersion() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "local-build";
  }
}

async function createAgentToken({ branchId, agentName, agentCode }) {
  requireBuildConfig();
  const supabase = createClient(config.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const branch = await supabase
    .from("branches")
    .select("id, tenant_id, name")
    .eq("id", branchId)
    .maybeSingle();

  if (branch.error) throw branch.error;
  if (!branch.data) throw new Error(`Branch not found: ${branchId}`);

  const code = agentCode || null;
  const created = await supabase.rpc("create_print_agent", {
    p_tenant_id: branch.data.tenant_id,
    p_branch_id: branch.data.id,
    p_name: agentName || `SmartRush Agent ${branch.data.name || branch.data.id}`,
    p_agent_code: code,
  });

  if (created.error) throw created.error;
  const row = created.data?.[0];
  if (!row?.agent_token) throw new Error("create_print_agent did not return an agent token");

  return {
    branch,
    agentId: row.agent_id,
    agentToken: row.agent_token,
    agentCode: code,
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

function writeRuntimePackageJson(appDir) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
  const runtimePackageJson = {
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
      tar: packageJson.dependencies.tar,
    },
  };

  fs.writeFileSync(
    path.join(appDir, "package.json"),
    `${JSON.stringify(runtimePackageJson, null, 2)}\n`,
    "utf8",
  );
}

function buildPackageDirectory({ platform, envText }) {
  assertPlatform(platform);
  const platformConfig = PLATFORM_CONFIG[platform];
  const packageDir = path.join(DIST_DIR, platformConfig.packageName);
  const appDir = path.join(packageDir, "SmartRushPrintAgent");

  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });

  for (const entry of ["src", "README.md"]) {
    copyRecursive(path.join(PROJECT_ROOT, entry), path.join(appDir, entry));
  }

  fs.mkdirSync(path.join(appDir, "scripts"), { recursive: true });
  for (const script of ["check-agent.js", "send-raw-windows-printer.ps1"]) {
    copyRecursive(
      path.join(PROJECT_ROOT, "scripts", script),
      path.join(appDir, "scripts", script),
    );
  }
  writeRuntimePackageJson(appDir);
  fs.writeFileSync(path.join(appDir, ".env.locale"), envText, "utf8");
  fs.writeFileSync(path.join(appDir, ".update-version"), `${getSourceVersion()}\n`, "utf8");

  for (const file of platformConfig.rootFiles) {
    copyRecursive(path.join(platformConfig.packagingDir, file), path.join(packageDir, file));
  }

  return { packageDir, packageName: platformConfig.packageName };
}

async function zipDirectory({ packageDir, packageName }) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  const zipPath = path.join(DIST_DIR, `${packageName}.zip`);
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

    archive.file(fullPath, {
      name: relativePath.replaceAll("\\", "/"),
      mode: relativePath.endsWith(".command") ? 0o755 : 0o644,
    });
  }

  for (const entry of fs.readdirSync(packageDir)) {
    addEntry(path.join(packageDir, entry), entry);
  }

  await archive.finalize();
  await new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
  });

  return zipPath;
}

async function buildPackage({ platform, branchId, agentName, agentCode }) {
  assertPlatform(platform);
  const platformLabel = PLATFORM_CONFIG[platform].label;
  const createdAgent = await createAgentToken({
    branchId,
    agentName: agentName || `SmartRush Agent ${platformLabel}`,
    agentCode,
  });
  const envText = buildEnvFile({
    agentId: createdAgent.agentId,
    agentToken: createdAgent.agentToken,
  });
  const packageInfo = buildPackageDirectory({ platform, envText });
  packageInfo.packageName = `${branchId}-${platform}`;
  const zipPath = await zipDirectory(packageInfo);

  return {
    zipPath,
    platform,
    branch: createdAgent.branch.data,
    agentId: createdAgent.agentId,
    agentCode: createdAgent.agentCode,
  };
}

module.exports = {
  buildPackage,
  PLATFORM_CONFIG,
};
