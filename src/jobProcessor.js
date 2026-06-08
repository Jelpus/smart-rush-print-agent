const { config } = require("./config");
const logger = require("./logger");
const { printRawCups, printRawNetwork, printRawWindowsSpooler } = require("./printerClient");
const { resolvePrinter } = require("./printerDiscovery");
const { getPrinterForJob } = require("./printerRepository");
const { renderTicket } = require("./ticketRenderer");

async function claimPrintJobs(supabase) {
  const { data, error } = await supabase.rpc(config.claimFunctionName, {
    p_agent_token: config.printAgentToken,
    p_agent_name: config.agentId,
    p_limit: config.batchSize,
  });

  if (error) throw error;
  return data || [];
}

async function markPrinted(supabase, jobId) {
  const { error } = await supabase.rpc(config.completeFunctionName, {
    p_agent_token: config.printAgentToken,
    p_job_id: jobId,
  });

  if (error) throw error;
}

async function markFailedOrRetry(supabase, job, errorMessage) {
  const { data, error } = await supabase.rpc(config.failFunctionName, {
    p_agent_token: config.printAgentToken,
    p_job_id: job.id,
    p_error: errorMessage,
    p_retry_delay_seconds: Math.ceil(config.retryDelayMs / 1000),
  });

  if (error) throw error;
  return Boolean(data?.[0]?.final_failure);
}

async function processJob(supabase, job) {
  try {
    const branchPrinter = await getPrinterForJob(supabase, job);
    const ticket = renderTicket(job.payload);
    const connection = branchPrinter.connection || {};
    const connectionType = connection.type || "network";
    let printedTo = branchPrinter.name || connectionType;

    if (connectionType === "network") {
      const printer = await resolvePrinter({ branchPrinter });
      await printRawNetwork(printer, ticket);
      printedTo = printer.name || `${printer.ip}:${printer.port}`;
    } else if (["windows_spooler", "cups", "local_spooler"].includes(connectionType)) {
      if (process.platform === "win32") {
        await printRawWindowsSpooler({ printerName: connection.printer_name }, ticket);
      } else {
        await printRawCups({ printerName: connection.printer_name }, ticket);
      }
      printedTo = connection.printer_name || branchPrinter.name;
    } else {
      throw new Error(`Unsupported printer connection type: ${connectionType}`);
    }

    await markPrinted(supabase, job.id);
    logger.info("Print job completed", {
      id: job.id,
      printer: printedTo,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finalFailure = await markFailedOrRetry(supabase, job, message);
    logger.error(finalFailure ? "Print job failed permanently" : "Print job failed, retry scheduled", {
      id: job.id,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      error: message,
    });
  }
}

async function processPendingJobs(supabase) {
  const jobs = await claimPrintJobs(supabase);
  if (jobs.length === 0) return 0;

  for (const job of jobs) {
    await processJob(supabase, job);
  }

  return jobs.length;
}

module.exports = {
  processPendingJobs,
};
