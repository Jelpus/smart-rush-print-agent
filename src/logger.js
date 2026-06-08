function stamp() {
  return new Date().toISOString();
}

function log(level, message, details) {
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.log(`[${stamp()}] ${level.toUpperCase()} ${message}${suffix}`);
}

module.exports = {
  info: (message, details) => log("info", message, details),
  warn: (message, details) => log("warn", message, details),
  error: (message, details) => log("error", message, details),
};
