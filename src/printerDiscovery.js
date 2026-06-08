const { config } = require("./config");
const logger = require("./logger");
const {
  getArpEntries,
  isPortOpen,
  normalizeMac,
  scanOpenPort,
  warmArpTable,
} = require("./network");

const cachedPrinters = new Map();

async function findIpByMac(mac) {
  const wantedMac = normalizeMac(mac);
  if (!wantedMac) {
    throw new Error(`Invalid printer MAC address: ${mac}`);
  }

  let entries = await getArpEntries();
  let match = entries.find((entry) => entry.mac === wantedMac);
  if (match) return match.ip;

  logger.info("Printer MAC not found in ARP cache, scanning local subnet", { mac: wantedMac });
  await warmArpTable({
    pingTimeoutMs: config.discoveryPingTimeoutMs,
    concurrency: config.discoveryConcurrency,
  });

  entries = await getArpEntries();
  match = entries.find((entry) => entry.mac === wantedMac);
  if (!match) {
    throw new Error(`No local IP found for printer MAC ${wantedMac}`);
  }

  return match.ip;
}

function cacheKey({ branchPrinter, ip, mac, port }) {
  if (branchPrinter?.id) return `printer:${branchPrinter.id}`;
  if (mac) return `mac:${normalizeMac(mac)}:${port}`;
  if (ip) return `ip:${ip}:${port}`;
  return `scan:${port}`;
}

function getConnection(branchPrinter) {
  const connection = branchPrinter?.connection || {};
  if (connection.type && connection.type !== "network") {
    throw new Error(`Unsupported printer connection type: ${connection.type}`);
  }

  const port = Number.parseInt(connection.port || config.printerPort, 10);
  if (Number.isNaN(port)) {
    throw new Error(`Invalid printer port for ${branchPrinter?.name || "printer"}`);
  }

  return {
    ip: connection.ip || "",
    mac: connection.mac || "",
    port,
  };
}

async function resolvePrinter({ branchPrinter } = {}) {
  const connection = getConnection(branchPrinter);
  const port = connection.port;
  const timeoutMs = config.printerConnectTimeoutMs;
  const connectionIp = connection.ip;
  const mac = connection.mac || config.defaultPrinterMac;
  const key = cacheKey({ branchPrinter, ip: connectionIp, mac, port });

  const cachedPrinter = cachedPrinters.get(key);
  if (cachedPrinter) {
    if (await isPortOpen(cachedPrinter.ip, cachedPrinter.port, timeoutMs)) {
      return cachedPrinter;
    }
    cachedPrinters.delete(key);
  }

  if (connectionIp && (await isPortOpen(connectionIp, port, timeoutMs))) {
    const printer = {
      id: branchPrinter?.id || "",
      name: branchPrinter?.name || "",
      ip: connectionIp,
      port,
      mac: normalizeMac(mac),
    };
    cachedPrinters.set(key, printer);
    return printer;
  }

  if (!connectionIp && config.defaultPrinterIp && (await isPortOpen(config.defaultPrinterIp, port, timeoutMs))) {
    const printer = {
      id: branchPrinter?.id || "",
      name: branchPrinter?.name || "",
      ip: config.defaultPrinterIp,
      port,
      mac: normalizeMac(mac),
    };
    cachedPrinters.set(key, printer);
    return printer;
  }

  if (mac) {
    const ip = await findIpByMac(mac);
    if (!(await isPortOpen(ip, port, timeoutMs))) {
      throw new Error(`Printer found at ${ip}, but port ${port} is closed`);
    }

    const printer = {
      id: branchPrinter?.id || "",
      name: branchPrinter?.name || "",
      ip,
      port,
      mac: normalizeMac(mac),
    };
    cachedPrinters.set(key, printer);
    return printer;
  }

  logger.warn("No printer IP or MAC configured; scanning for open printer port", { port });
  const openIps = await scanOpenPort({
    port,
    timeoutMs,
    concurrency: config.discoveryConcurrency,
  });

  if (openIps.length === 0) {
    throw new Error(`No device with port ${port} open was found in the local subnet`);
  }

  if (openIps.length > 1) {
    throw new Error(`Multiple devices with port ${port} open: ${openIps.join(", ")}`);
  }

  const printer = {
    id: branchPrinter?.id || "",
    name: branchPrinter?.name || "",
    ip: openIps[0],
    port,
    mac: "",
  };
  cachedPrinters.set(key, printer);
  return printer;
}

async function discoverPrinters() {
  const openIps = await scanOpenPort({
    port: config.printerPort,
    timeoutMs: config.printerConnectTimeoutMs,
    concurrency: config.discoveryConcurrency,
  });

  let arpEntries = [];
  try {
    arpEntries = await getArpEntries();
  } catch {
    arpEntries = [];
  }

  return openIps.map((ip) => ({
    ip,
    port: config.printerPort,
    mac: arpEntries.find((entry) => entry.ip === ip)?.mac || "",
  }));
}

module.exports = {
  discoverPrinters,
  resolvePrinter,
};
