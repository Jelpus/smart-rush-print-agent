const { config, validateConfigForSupabase } = require("../src/config");
const fs = require("node:fs");
const path = require("node:path");
const { createSupabaseClient } = require("../src/supabaseClient");
const { fetchAgentPrinters } = require("../src/printerRepository");
const { isPortOpen } = require("../src/network");
const { cupsPrinterExists, windowsPrinterExists } = require("../src/localPrinters");

async function main() {
  validateConfigForSupabase();
  const supabase = createSupabaseClient();
  const printers = await fetchAgentPrinters(supabase);
  const versionPath = path.resolve(__dirname, "..", ".update-version");
  const installedVersion = fs.existsSync(versionPath)
    ? fs.readFileSync(versionPath, "utf8").trim()
    : "unknown";

  console.log("SmartRush Print Agent check");
  console.log(`Supabase: ${config.supabaseUrl}`);
  console.log(`Agent ID: ${config.agentId}`);
  console.log(`Installed version: ${installedVersion}`);
  console.log(`Printers found: ${printers.length}`);

  if (printers.length === 0) {
    throw new Error("No active printers were returned for this agent token");
  }

  for (const printer of printers) {
    const connection = printer.connection || {};
    const type = connection.type || "network";
    const ip = connection.ip || "";
    const port = Number.parseInt(connection.port || config.printerPort, 10);
    const mac = connection.mac || "";
    const printerName = connection.printer_name || "";
    const label = `${printer.name} (${printer.role})`;
    console.log(`- ${label}`);
    console.log(`  type: ${type}`);
    console.log(`  ip: ${ip || "<empty>"}`);
    console.log(`  port: ${port}`);
    console.log(`  mac: ${mac || "<empty>"}`);
    console.log(`  printer_name: ${printerName || "<empty>"}`);

    if (type === "network" && ip) {
      const open = await isPortOpen(ip, port, config.printerConnectTimeoutMs);
      console.log(`  local port check: ${open ? "open" : "closed/unreachable"}`);
    } else if (["windows_spooler", "cups", "local_spooler"].includes(type)) {
      if (process.platform === "win32") {
        const exists = await windowsPrinterExists(printerName);
        console.log(`  windows printer check: ${exists ? "found" : "not found"}`);
      } else {
        const exists = await cupsPrinterExists(printerName);
        console.log(`  cups printer check: ${exists ? "found" : "not found"}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(`Check failed: ${error.message}`);
  process.exit(1);
});
