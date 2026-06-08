const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const tar = require("tar");
const { config } = require("./config");
const logger = require("./logger");

const VERSION_FILE = ".update-version";

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "SmartRush-Print-Agent",
      Accept: "application/vnd.github+json",
    };

    if (config.updateGithubToken) {
      headers.Authorization = `Bearer ${config.updateGithubToken}`;
    }

    https
      .get(url, { headers }, (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`GitHub request failed ${response.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          resolve(JSON.parse(body));
        });
      })
      .on("error", reject);
  });
}

function downloadFile(url, targetPath) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "SmartRush-Print-Agent",
    };

    if (config.updateGithubToken) {
      headers.Authorization = `Bearer ${config.updateGithubToken}`;
    }

    function request(currentUrl) {
      https
        .get(currentUrl, { headers }, (response) => {
          if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            request(response.headers.location);
            return;
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Download failed ${response.statusCode}`));
            return;
          }

          const output = fs.createWriteStream(targetPath);
          response.pipe(output);
          output.on("finish", () => output.close(resolve));
          output.on("error", reject);
        })
        .on("error", reject);
    }

    request(url);
  });
}

function execFilePromise(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, ...options }, (error, stdout, stderr) => {
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

function readCurrentSha(appDir) {
  const versionPath = path.join(appDir, VERSION_FILE);
  if (!fs.existsSync(versionPath)) return "";
  return fs.readFileSync(versionPath, "utf8").trim();
}

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function findExtractedRoot(tempDir) {
  const entries = fs.readdirSync(tempDir)
    .map((entry) => path.join(tempDir, entry))
    .filter((entry) => fs.statSync(entry).isDirectory());

  if (entries.length !== 1) {
    throw new Error("Unexpected update archive layout");
  }

  return entries[0];
}

async function installDependencies(appDir) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await execFilePromise(npm, ["install", "--omit=dev"], {
    cwd: appDir,
    timeout: 120000,
  });
}

async function checkForUpdate() {
  if (!config.autoUpdateEnabled) return false;

  const appDir = path.resolve(__dirname, "..");
  const currentSha = readCurrentSha(appDir);
  const apiUrl = `https://api.github.com/repos/${config.updateRepo}/commits/${config.updateBranch}`;
  const latest = await requestJson(apiUrl);
  const latestSha = latest.sha;

  if (!latestSha) {
    throw new Error("GitHub did not return a latest commit sha");
  }

  if (currentSha === latestSha) {
    return false;
  }

  logger.info("Update found", {
    current: currentSha || "unknown",
    latest: latestSha,
    repo: config.updateRepo,
    branch: config.updateBranch,
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "smartrush-update-"));
  const archivePath = path.join(tempDir, "update.tar.gz");
  const archiveUrl = `https://github.com/${config.updateRepo}/archive/${latestSha}.tar.gz`;

  try {
    await downloadFile(archiveUrl, archivePath);
    await tar.x({ file: archivePath, cwd: tempDir });
    const extractedRoot = findExtractedRoot(tempDir);

    for (const entry of ["src", "scripts", "package.json", "package-lock.json", "README.md"]) {
      const source = path.join(extractedRoot, entry);
      if (fs.existsSync(source)) {
        copyRecursive(source, path.join(appDir, entry));
      }
    }

    fs.writeFileSync(path.join(appDir, VERSION_FILE), `${latestSha}\n`, "utf8");
    await installDependencies(appDir);
    logger.info("Update installed", { latest: latestSha });
    return true;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  checkForUpdate,
  VERSION_FILE,
};
