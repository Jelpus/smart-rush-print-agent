const dotenv = require("dotenv");
const fs = require("node:fs");
const os = require("node:os");

for (const path of [".env", ".env.local", ".env.locale"]) {
  if (fs.existsSync(path)) {
    dotenv.config({ path, override: true, quiet: true });
  }
}

function intEnv(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) return defaultValue;

  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`${name} must be an integer`);
  }

  return value;
}

function boolEnv(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  return ["1", "true", "yes", "y", "on"].includes(raw.toLowerCase());
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

const config = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  printAgentToken: process.env.PRINT_AGENT_TOKEN,
  tableName: process.env.PRINT_JOBS_TABLE || "print_jobs",
  printersTableName: process.env.BRANCH_PRINTERS_TABLE || "branch_printers",
  claimFunctionName: process.env.CLAIM_PRINT_JOBS_FUNCTION || "claim_print_jobs_for_agent",
  completeFunctionName: process.env.COMPLETE_PRINT_JOB_FUNCTION || "complete_print_job_for_agent",
  failFunctionName: process.env.FAIL_PRINT_JOB_FUNCTION || "fail_print_job_for_agent",
  printersFunctionName: process.env.GET_AGENT_PRINTERS_FUNCTION || "get_agent_printers",
  branchId: process.env.BRANCH_ID,
  agentId: process.env.AGENT_ID || `${os.hostname()}-${process.pid}`,
  pollIntervalMs: intEnv("POLL_INTERVAL_MS", 5000),
  batchSize: intEnv("BATCH_SIZE", 5),
  retryDelayMs: intEnv("RETRY_DELAY_MS", 30000),
  allowEnvPrinterFallback: boolEnv("ALLOW_ENV_PRINTER_FALLBACK", false),
  defaultPrinterMac: process.env.DEFAULT_PRINTER_MAC || "",
  defaultPrinterIp: process.env.DEFAULT_PRINTER_IP || "",
  printerPort: intEnv("PRINTER_PORT", 9100),
  printerConnectTimeoutMs: intEnv("PRINTER_CONNECT_TIMEOUT_MS", 3000),
  discoveryPingTimeoutMs: intEnv("DISCOVERY_PING_TIMEOUT_MS", 120),
  discoveryConcurrency: intEnv("DISCOVERY_CONCURRENCY", 48),
  printerEncoding: process.env.PRINTER_ENCODING || "cp858",
  cutAfterPrint: boolEnv("CUT_AFTER_PRINT", true),
  feedLinesBeforeCut: intEnv("FEED_LINES_BEFORE_CUT", 6),
  autoUpdateEnabled: boolEnv("AUTO_UPDATE_ENABLED", true),
  updateRepo: process.env.UPDATE_REPO || "Jelpus/smart-rush-print-agent",
  updateBranch: process.env.UPDATE_BRANCH || "main",
  updateGithubToken: process.env.UPDATE_GITHUB_TOKEN || "",
};

function validateConfigForSupabase() {
  requiredEnv("SUPABASE_URL");
  if (!process.env.SUPABASE_ANON_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is required");
  }
  requiredEnv("PRINT_AGENT_TOKEN");
}

module.exports = {
  config,
  validateConfigForSupabase,
};
