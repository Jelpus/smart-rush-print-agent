const {
  handleOptions,
  readJsonBody,
  requireInternalAuth,
  requireMethod,
  sendError,
  setCors,
} = require("../../src/api/http");
const { buildDesktopPackage } = require("../../src/api/desktopDistribution");

module.exports = async function handler(request, response) {
  setCors(response);
  if (handleOptions(request, response)) return;

  try {
    requireMethod(request, ["POST"]);
    requireInternalAuth(request);

    const body = await readJsonBody(request);
    const result = await buildDesktopPackage({
      platform: body.platform,
      tenantId: body.tenant_id || body.tenantId,
      branchId: body.branch_id || body.branchId,
      agentName: body.agent_name || body.agentName,
      agentCode: body.agent_code || body.agentCode,
    });

    response.statusCode = 200;
    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    response.end(result.zip);
  } catch (error) {
    sendError(response, error);
  }
};
