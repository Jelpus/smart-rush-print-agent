const { createClient } = require("@supabase/supabase-js");
const { config } = require("../../src/config");
const {
  handleOptions,
  httpError,
  queryParam,
  readJsonBody,
  requireInternalAuth,
  requireMethod,
  sendError,
  sendJson,
  setCors,
} = require("../../src/api/http");

function supabaseAdmin() {
  if (!config.supabaseUrl) throw httpError(500, "missing_supabase_url", "SUPABASE_URL is not configured");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw httpError(500, "missing_service_role", "SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createClient(config.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requestInput(request) {
  if (request.method === "GET") {
    return {
      tenantId: queryParam(request, "tenant_id") || queryParam(request, "tenantId"),
      branchId: queryParam(request, "branch_id") || queryParam(request, "branchId"),
    };
  }

  const body = await readJsonBody(request);
  return {
    tenantId: body.tenant_id || body.tenantId,
    branchId: body.branch_id || body.branchId,
  };
}

module.exports = async function handler(request, response) {
  setCors(response);
  if (handleOptions(request, response)) return;

  try {
    requireMethod(request, ["GET", "POST"]);
    requireInternalAuth(request);

    const { tenantId, branchId } = await requestInput(request);
    if (!branchId) throw httpError(400, "missing_branch_id", "branchId is required");

    const supabase = supabaseAdmin();

    let agentsQuery = supabase
      .from("print_agents")
      .select("id,tenant_id,branch_id,name,agent_code,platform,is_active,last_seen_at,last_agent_name,created_at,updated_at")
      .eq("branch_id", branchId)
      .order("last_seen_at", { ascending: false, nullsFirst: false });

    if (tenantId) agentsQuery = agentsQuery.eq("tenant_id", tenantId);

    const { data: agents, error: agentsError } = await agentsQuery;
    if (agentsError) throw agentsError;

    let jobsQuery = supabase
      .from("print_jobs")
      .select("id,job_type,status,attempts,max_attempts,last_error,created_at,printed_at,failed_at")
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (tenantId) jobsQuery = jobsQuery.eq("tenant_id", tenantId);

    const { data: recentJobs, error: jobsError } = await jobsQuery;
    if (jobsError) throw jobsError;

    sendJson(response, 200, {
      tenantId: tenantId || agents?.[0]?.tenant_id || null,
      branchId,
      agents: agents || [],
      recentJobs: recentJobs || [],
    });
  } catch (error) {
    sendError(response, error);
  }
};
