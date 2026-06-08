const { execFile } = require("node:child_process");
const net = require("node:net");
const os = require("node:os");

function execFileText(file, args, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve(stdout);
    });
  });
}

function normalizeMac(mac) {
  if (!mac) return "";
  const hex = mac.toLowerCase().replace(/[^a-f0-9]/g, "");
  if (hex.length !== 12) return "";
  return hex.match(/.{1,2}/g).join(":");
}

function parseArpTable(output) {
  const entries = [];
  const pattern = /(\d{1,3}(?:\.\d{1,3}){3})\s+([a-fA-F0-9:-]{11,17})\s+\w+/g;
  let match;

  while ((match = pattern.exec(output)) !== null) {
    const mac = normalizeMac(match[2]);
    if (mac) {
      entries.push({ ip: match[1], mac });
    }
  }

  return entries;
}

async function getArpEntries() {
  const output = await execFileText("arp", ["-a"]);
  return parseArpTable(output);
}

function getLocalIpv4Subnets() {
  const interfaces = os.networkInterfaces();
  const subnets = new Set();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family !== "IPv4" || address.internal) continue;
      const parts = address.address.split(".");
      if (parts.length !== 4) continue;
      subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
    }
  }

  return [...subnets];
}

async function pingIp(ip, timeoutMs) {
  try {
    await execFileText("ping", ["-n", "1", "-w", String(timeoutMs), ip], timeoutMs + 600);
    return true;
  } catch {
    return false;
  }
}

async function runPool(items, concurrency, worker) {
  const results = [];
  let nextIndex = 0;

  async function runner() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

async function warmArpTable({ pingTimeoutMs, concurrency }) {
  const subnets = getLocalIpv4Subnets();
  const ips = subnets.flatMap((subnet) =>
    Array.from({ length: 254 }, (_, index) => `${subnet}.${index + 1}`),
  );

  await runPool(ips, concurrency, (ip) => pingIp(ip, pingTimeoutMs));
}

function isPortOpen(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    function finish(result) {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    }

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function scanOpenPort({ port, timeoutMs, concurrency }) {
  const subnets = getLocalIpv4Subnets();
  const ips = subnets.flatMap((subnet) =>
    Array.from({ length: 254 }, (_, index) => `${subnet}.${index + 1}`),
  );

  const open = [];
  await runPool(ips, concurrency, async (ip) => {
    if (await isPortOpen(ip, port, timeoutMs)) {
      open.push(ip);
    }
  });

  return open.sort();
}

module.exports = {
  getArpEntries,
  getLocalIpv4Subnets,
  isPortOpen,
  normalizeMac,
  scanOpenPort,
  warmArpTable,
};
