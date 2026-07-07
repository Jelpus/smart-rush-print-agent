function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendError(response, error) {
  const statusCode = error?.statusCode || 500;
  sendJson(response, statusCode, {
    error: error?.code || "internal_error",
    message: error?.message || "Internal server error",
  });
}

function httpError(statusCode, code, message) {
  const error = new Error(message || code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", process.env.PRINT_SERVICE_ALLOWED_ORIGIN || "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
}

function handleOptions(request, response) {
  setCors(response);
  if (request.method !== "OPTIONS") return false;
  response.statusCode = 204;
  response.end();
  return true;
}

function requireMethod(request, methods) {
  if (!methods.includes(request.method)) {
    throw httpError(405, "method_not_allowed", `Use ${methods.join(" or ")}`);
  }
}

function requireInternalAuth(request) {
  const expected = process.env.PRINT_SERVICE_INTERNAL_TOKEN;
  if (!expected) {
    throw httpError(500, "missing_internal_token", "PRINT_SERVICE_INTERNAL_TOKEN is not configured");
  }

  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token || token !== expected) {
    throw httpError(401, "unauthorized", "Invalid or missing internal token");
  }
}

async function readJsonBody(request) {
  if (Buffer.isBuffer(request.body)) {
    const text = request.body.toString("utf8").trim();
    return text ? JSON.parse(text) : {};
  }
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return request.body ? JSON.parse(request.body) : {};

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

function queryParam(request, name) {
  const host = request.headers.host || "localhost";
  const url = new URL(request.url || "/", `https://${host}`);
  return url.searchParams.get(name);
}

function cleanString(value) {
  return String(value || "").trim();
}

module.exports = {
  cleanString,
  handleOptions,
  httpError,
  queryParam,
  readJsonBody,
  requireInternalAuth,
  requireMethod,
  sendError,
  sendJson,
  setCors,
};
