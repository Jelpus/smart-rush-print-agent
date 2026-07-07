const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { config } = require("../config");

function cleanString(value) {
  return String(value || "").trim();
}

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

function fallbackRelease() {
  const manifest = baseManifest();
  return {
    versionCode: intEnv("ANDROID_VERSION_CODE", manifest.versionCode || 0),
    versionName: process.env.ANDROID_VERSION_NAME || manifest.versionName || "",
    apkUrl: process.env.ANDROID_APK_URL || manifest.apkUrl || "",
    releaseNotes: process.env.ANDROID_RELEASE_NOTES || manifest.releaseNotes || "",
    source: "fallback",
  };
}

function releaseChannel(value) {
  return cleanString(value || process.env.ANDROID_RELEASE_CHANNEL || "stable") || "stable";
}

function canReadSupabase() {
  return Boolean(config.supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function isMissingReleaseTable(error) {
  const message = String(error?.message || "");
  return error?.code === "42P01" || message.includes("print_agent_releases");
}

async function latestReleaseFromSupabase(channel) {
  if (!canReadSupabase()) return null;

  const supabase = createClient(config.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("print_agent_releases")
    .select("version_code,version_name,apk_url,release_notes,channel,published_at")
    .eq("platform", "android")
    .eq("channel", channel)
    .eq("is_active", true)
    .order("version_code", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingReleaseTable(error)) return null;
    throw error;
  }

  if (!data) return null;
  return {
    versionCode: data.version_code,
    versionName: data.version_name,
    apkUrl: data.apk_url,
    releaseNotes: data.release_notes || "",
    channel: data.channel,
    publishedAt: data.published_at,
    source: "supabase",
  };
}

async function getLatestAndroidRelease(options = {}) {
  const channel = releaseChannel(options.channel);
  const release = await latestReleaseFromSupabase(channel);
  if (release) return release;

  const fallback = fallbackRelease();
  return {
    ...fallback,
    channel,
  };
}

module.exports = {
  getLatestAndroidRelease,
  releaseChannel,
};
