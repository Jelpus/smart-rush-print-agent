const { config } = require("./config");

function roleForJobType(jobType) {
  const roles = {
    sales_ticket: "receipt",
    invoice: "receipt",
    test_ticket: "receipt",
    kitchen_ticket: "kitchen",
    food_ticket: "kitchen",
    kds_ticket: "kitchen",
    bar_ticket: "bar",
    label_ticket: "label",
    cash_drawer: "cash_drawer",
  };

  return roles[jobType] || "receipt";
}

function targetPrinterIdForJob(job) {
  return job.printer_id || job.meta?.printer_id || "";
}

function targetRoleForJob(job) {
  return job.meta?.target_role || job.meta?.printer_role || roleForJobType(job.job_type);
}

async function fetchAgentPrinters(supabase) {
  const { data, error } = await supabase
    .rpc(config.printersFunctionName, {
      p_agent_token: config.printAgentToken,
    });

  if (error) throw error;
  return data || [];
}

async function getPrinterForJob(supabase, job) {
  const printers = await fetchAgentPrinters(supabase);
  const targetPrinterId = targetPrinterIdForJob(job);

  if (targetPrinterId) {
    const printer = printers.find((item) => item.id === targetPrinterId);
    if (!printer) {
      throw new Error(`No active printer found for printer_id ${targetPrinterId}`);
    }

    return printer;
  }

  const role = targetRoleForJob(job);
  const printer = printers.find((item) => item.role === role);
  if (!printer) {
    if (config.allowEnvPrinterFallback && (config.defaultPrinterIp || config.defaultPrinterMac)) {
      return {
        id: "env-default-printer",
        name: "Default env printer",
        role,
        connection: {
          type: "network",
          ip: config.defaultPrinterIp,
          port: config.printerPort,
          mac: config.defaultPrinterMac,
        },
        settings: {},
      };
    }

    throw new Error(`No active ${role} printer found for this agent branch`);
  }

  return printer;
}

module.exports = {
  fetchAgentPrinters,
  getPrinterForJob,
  roleForJobType,
  targetRoleForJob,
};
