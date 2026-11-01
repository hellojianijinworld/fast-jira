import { existsSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const state = process.env.FAST_JIRA_TEST_PLUGIN_STATE;
const marketplace = process.env.FAST_JIRA_TEST_MARKETPLACE;
const version = process.env.FAST_JIRA_TEST_VERSION ?? "0.1.1";
if (!state || !marketplace) process.exit(1);
const installed = existsSync(state);
let result = {};
if (args.includes("--help")) result = { help: true };
else if (args[0] === "plugin" && args[1] === "list")
  result = {
    installed: installed
      ? [
          {
            pluginId: "fast-jira@fast-jira-local",
            version,
            enabled: true,
            marketplaceSource: { sourceType: "local", source: marketplace },
          },
        ]
      : [],
  };
else if (
  args[0] === "plugin" &&
  args[1] === "marketplace" &&
  args[2] === "list"
)
  result = {
    marketplaces: installed
      ? [
          {
            name: "fast-jira-local",
            marketplaceSource: { sourceType: "local", source: marketplace },
          },
        ]
      : [],
  };
else if (args[0] === "plugin" && args[1] === "add")
  writeFileSync(state, "installed");
else if (
  !(args[0] === "plugin" && args[1] === "marketplace" && args[2] === "add")
)
  process.exit(1);
console.log(JSON.stringify(result));
