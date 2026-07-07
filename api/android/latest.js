const { handleOptions, queryParam, sendError, sendJson, setCors } = require("../../src/api/http");
const { getLatestAndroidRelease } = require("../../src/api/androidReleases");

module.exports = async function handler(request, response) {
  setCors(response);
  if (handleOptions(request, response)) return;

  try {
    const release = await getLatestAndroidRelease({
      channel: queryParam(request, "channel"),
    });

    response.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    sendJson(response, 200, {
      versionCode: release.versionCode,
      versionName: release.versionName,
      apkUrl: release.apkUrl,
      releaseNotes: release.releaseNotes,
      channel: release.channel,
      publishedAt: release.publishedAt,
    });
  } catch (error) {
    sendError(response, error);
  }
};
