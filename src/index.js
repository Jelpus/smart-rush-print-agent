const { config, validateConfigForSupabase } = require("./config");
const logger = require("./logger");
const { checkForUpdate } = require("./autoUpdater");
const { createSupabaseClient } = require("./supabaseClient");
const { discoverPrinters } = require("./printerDiscovery");
const { processPendingJobs } = require("./jobProcessor");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDiscover() {
  const printers = await discoverPrinters();
  if (printers.length === 0) {
    logger.warn("No printers found with the configured port open", { port: config.printerPort });
    return;
  }

  for (const printer of printers) {
    logger.info("Printer candidate found", printer);
  }
}

async function runWorker({ once = false } = {}) {
  validateConfigForSupabase();
  const supabase = createSupabaseClient();

  logger.info("SmartRush print service started", {
    table: config.tableName,
    branchId: config.branchId,
    agentId: config.agentId,
    intervalMs: config.pollIntervalMs,
    once,
  });

  while (true) {
    try {
      const count = await processPendingJobs(supabase);
      if (count > 0) {
        logger.info("Polling cycle finished", { jobs: count });
      }
    } catch (error) {
      logger.error("Polling cycle failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (once) break;
    await delay(config.pollIntervalMs);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--no-update")) {
    try {
      const updated = await checkForUpdate();
      if (updated) {
        logger.info("Restarting after update");
        process.exit(42);
      }
    } catch (error) {
      logger.error("Auto-update failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (args.has("--discover")) {
    await runDiscover();
    return;
  }

  await runWorker({ once: args.has("--once") });
}

if (require.main === module) {
  process.on("SIGINT", () => {
    logger.info("SmartRush print service stopped");
    process.exit(0);
  });

  main().catch((error) => {
    logger.error("Fatal error", { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}

module.exports = {
  main,
  runDiscover,
  runWorker,
};
