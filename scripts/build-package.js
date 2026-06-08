const { buildPackage, PLATFORM_CONFIG } = require("./package-builder");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    args[arg.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.platform || !PLATFORM_CONFIG[args.platform]) {
    throw new Error(`Use --platform ${Object.keys(PLATFORM_CONFIG).join("|")}`);
  }
  if (!args.branchId) {
    throw new Error("Use --branchId <uuid>");
  }

  const result = await buildPackage({
    platform: args.platform,
    branchId: args.branchId,
    agentName: args.agentName,
    agentCode: args.agentCode,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
