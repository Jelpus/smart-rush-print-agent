const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { config } = require("../src/config");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const GRADLE_PATH = path.join(PROJECT_ROOT, "android-agent", "app", "build.gradle.kts");
const DEFAULT_APK_PATH = path.join(
  PROJECT_ROOT,
  "android-agent",
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk",
);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function requireConfig() {
  if (!config.supabaseUrl) throw new Error("SUPABASE_URL is required");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }
}

function readAndroidVersion() {
  const text = fs.readFileSync(GRADLE_PATH, "utf8");
  const versionCode = Number.parseInt(text.match(/versionCode\s*=\s*(\d+)/)?.[1] || "", 10);
  const versionName = text.match(/versionName\s*=\s*"([^"]+)"/)?.[1] || "";

  if (!Number.isInteger(versionCode) || versionCode <= 0) {
    throw new Error(`Could not read versionCode from ${GRADLE_PATH}`);
  }
  if (!versionName) {
    throw new Error(`Could not read versionName from ${GRADLE_PATH}`);
  }

  return { versionCode, versionName };
}

function contentTypeFor(filePath) {
  if (filePath.toLowerCase().endsWith(".apk")) return "application/vnd.android.package-archive";
  return "application/octet-stream";
}

function cleanPathPart(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  requireConfig();
  const args = parseArgs(process.argv.slice(2));
  const { versionCode, versionName } = readAndroidVersion();
  const bucket = String(args.bucket || process.env.ANDROID_APK_BUCKET || "apk").trim();
  const channel = String(args.channel || process.env.ANDROID_RELEASE_CHANNEL || "stable").trim();
  const apkPath = path.resolve(args.apk || DEFAULT_APK_PATH);
  const notes = String(args.notes || process.env.ANDROID_RELEASE_NOTES || "").trim();
  const apkName = `SmartRush-Print-Agent-Android-v${cleanPathPart(versionName)}-${versionCode}.apk`;
  const storagePath = String(
    args.path || `android/${cleanPathPart(channel)}/${versionCode}/${apkName}`,
  ).replace(/^\/+/, "");

  if (!fs.existsSync(apkPath)) {
    throw new Error(`APK not found: ${apkPath}. Build it first with android-agent/gradlew assembleDebug.`);
  }

  const supabase = createClient(config.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const apk = fs.readFileSync(apkPath);
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, apk, {
      contentType: contentTypeFor(apkPath),
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  const apkUrl = publicUrlData.publicUrl;

  const release = {
    platform: "android",
    channel,
    version_code: versionCode,
    version_name: versionName,
    apk_url: apkUrl,
    release_notes: notes || null,
    is_active: true,
    published_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("print_agent_releases")
    .upsert(release, {
      onConflict: "platform,channel,version_code",
    })
    .select()
    .single();

  if (error) throw error;

  console.log(
    JSON.stringify(
      {
        ok: true,
        bucket,
        storagePath,
        apkPath,
        apkUrl,
        release: data,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
