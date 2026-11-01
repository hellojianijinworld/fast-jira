import { rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { runInstallationRepair } from "./installation-repair.ts";

const [home, id] = process.argv.slice(2);
if (!home || !isAbsolute(home) || !id || !/^[a-f0-9-]{36}$/.test(id))
  process.exitCode = 1;
else
  try {
    await runInstallationRepair(home, id);
  } finally {
    await rm(join(home, `.repair-${id}`), { recursive: true, force: true });
  }
