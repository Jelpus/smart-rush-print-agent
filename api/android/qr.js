const {
  handleOptions,
  queryParam,
  readJsonBody,
  requireInternalAuth,
  requireMethod,
  sendError,
  sendJson,
  setCors,
} = require("../../src/api/http");
const { createAndroidActivation } = require("../../src/api/androidDistribution");

module.exports = async function handler(request, response) {
  setCors(response);
  if (handleOptions(request, response)) return;

  try {
    requireMethod(request, ["POST"]);
    requireInternalAuth(request);

    const body = await readJsonBody(request);
    const activation = await createAndroidActivation({
      tenantId: body.tenant_id || body.tenantId,
      branchId: body.branch_id || body.branchId,
      agentName: body.agent_name || body.agentName,
      agentCode: body.agent_code || body.agentCode,
      expiresMinutes: body.expires_minutes || body.expiresMinutes,
    });

    const format = queryParam(request, "format");
    if (format === "png") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "image/png");
      response.setHeader("Content-Disposition", `inline; filename="${activation.branch.id}-android-activation.png"`);
      response.end(activation.qrPng);
      return;
    }

    if (format === "html") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Content-Disposition", `inline; filename="${activation.branch.id}-android-activation.html"`);
      response.end(activation.html);
      return;
    }

    sendJson(response, 200, {
      platform: activation.platform,
      branch: activation.branch,
      activationId: activation.activationId,
      expiresAt: activation.expiresAt,
      agentName: activation.agentName,
      agentCode: activation.agentCode,
      payload: activation.payload,
      qrText: activation.qrText,
      qrDataUrl: activation.qrDataUrl,
      html: activation.html,
    });
  } catch (error) {
    sendError(response, error);
  }
};
