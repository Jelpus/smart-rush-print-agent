const fs = require("node:fs");
const path = require("node:path");
const { handleOptions, sendError, sendJson, setCors } = require("../../src/api/http");

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function baseManifest() {
  const manifestPath = path.resolve(process.cwd(), "android-agent", "update.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      versionCode: 0,
      versionName: "",
      apkUrl: "",
      releaseNotes: "",
    };
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

module.exports = async function handler(request, response) {
  setCors(response);
  if (handleOptions(request, response)) return;

  try {
    const manifest = baseManifest();
    const body = {
      versionCode: intEnv("ANDROID_VERSION_CODE", manifest.versionCode || 0),
      versionName: process.env.ANDROID_VERSION_NAME || manifest.versionName || "",
      apkUrl: process.env.ANDROID_APK_URL || manifest.apkUrl || "",
      releaseNotes: process.env.ANDROID_RELEASE_NOTES || manifest.releaseNotes || "",
    };

    response.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    sendJson(response, 200, body);
  } catch (error) {
    sendError(response, error);
  }
};
