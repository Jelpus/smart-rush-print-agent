const http = require("node:http");
const https = require("node:https");
const { PNG } = require("pngjs");

const ESC = 0x1b;
const GS = 0x1d;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_LOGO_WIDTH = 192;
const MAX_LOGO_HEIGHT = 96;
const LOGO_CACHE = new Map();
const PREP_JOB_TYPES = new Set(["bar_ticket", "kitchen_ticket", "food_ticket", "kds_ticket"]);

function command(...bytes) {
  return Buffer.from(bytes);
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  if (["null", "undefined", "nan"].includes(text.toLowerCase())) return "";
  return text;
}

function logoUrlForPayload(payload) {
  if (!payload || typeof payload !== "object") return "";

  return cleanText(
    payload.business?.brand_logo_url ||
      payload.business?.brandLogoUrl ||
      payload.tenant_business_settings?.brand_logo_url ||
      payload.tenantBusinessSettings?.brandLogoUrl ||
      payload.brand_logo_url ||
      payload.brandLogoUrl,
  );
}

function shouldRenderLogo(payload, options = {}) {
  if (!payload || typeof payload !== "object") return false;
  if (PREP_JOB_TYPES.has(options.jobType)) return false;
  return Boolean(logoUrlForPayload(payload));
}

async function loadTicketLogo(payload, options = {}) {
  if (!shouldRenderLogo(payload, options)) return null;

  const logoUrl = logoUrlForPayload(payload);
  if (LOGO_CACHE.has(logoUrl)) return LOGO_CACHE.get(logoUrl);

  const image = await fetchImage(logoUrl);
  const logo = renderPngLogo(image);
  if (LOGO_CACHE.size >= 25) {
    LOGO_CACHE.delete(LOGO_CACHE.keys().next().value);
  }
  LOGO_CACHE.set(logoUrl, logo);
  return logo;
}

function fetchImage(value, redirects = 3) {
  if (value.startsWith("data:image/png;base64,")) {
    return Promise.resolve(Buffer.from(value.slice("data:image/png;base64,".length), "base64"));
  }

  const url = new URL(value);
  const client = url.protocol === "https:" ? https : url.protocol === "http:" ? http : null;
  if (!client) {
    return Promise.reject(new Error(`Unsupported logo URL protocol: ${url.protocol}`));
  }

  return new Promise((resolve, reject) => {
    const request = client.get(url, { timeout: 8000 }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location && redirects > 0) {
        response.resume();
        const nextUrl = new URL(location, url).toString();
        fetchImage(nextUrl, redirects - 1).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Logo download failed with HTTP ${status}`));
        return;
      }

      const chunks = [];
      let total = 0;
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > MAX_LOGO_BYTES) {
          request.destroy(new Error("Logo image is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });

    request.on("timeout", () => request.destroy(new Error("Logo download timed out")));
    request.on("error", reject);
  });
}

function renderPngLogo(buffer, options = {}) {
  const png = PNG.sync.read(buffer);
  const bounds = contentBounds(png);
  if (!bounds) return null;

  const maxWidth = options.maxWidth || MAX_LOGO_WIDTH;
  const maxHeight = options.maxHeight || MAX_LOGO_HEIGHT;
  const sourceWidth = bounds.right - bounds.left + 1;
  const sourceHeight = bounds.bottom - bounds.top + 1;
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const rowBytes = Math.ceil(width / 8);
  const raster = Buffer.alloc(rowBytes * height);

  for (let y = 0; y < height; y += 1) {
    const sourceY = bounds.top + Math.min(sourceHeight - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sourceX = bounds.left + Math.min(sourceWidth - 1, Math.floor(x / scale));
      if (isInk(png, sourceX, sourceY, 190)) {
        raster[y * rowBytes + Math.floor(x / 8)] |= 0x80 >> (x % 8);
      }
    }
  }

  const xL = rowBytes & 0xff;
  const xH = (rowBytes >> 8) & 0xff;
  const yL = height & 0xff;
  const yH = (height >> 8) & 0xff;

  return Buffer.concat([
    command(ESC, 0x61, 0x01),
    command(GS, 0x76, 0x30, 0x00, xL, xH, yL, yH),
    raster,
    Buffer.from("\n"),
    command(ESC, 0x61, 0x00),
  ]);
}

function contentBounds(png) {
  let left = png.width;
  let right = -1;
  let top = png.height;
  let bottom = -1;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (!isInk(png, x, y, 245)) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) return null;
  return { left, right, top, bottom };
}

function isInk(png, x, y, threshold) {
  const offset = (y * png.width + x) * 4;
  const alpha = png.data[offset + 3];
  if (alpha < 32) return false;

  const alphaRatio = alpha / 255;
  const red = png.data[offset] * alphaRatio + 255 * (1 - alphaRatio);
  const green = png.data[offset + 1] * alphaRatio + 255 * (1 - alphaRatio);
  const blue = png.data[offset + 2] * alphaRatio + 255 * (1 - alphaRatio);
  const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;

  return luminance < threshold;
}

module.exports = {
  loadTicketLogo,
  logoUrlForPayload,
  renderPngLogo,
  shouldRenderLogo,
};
