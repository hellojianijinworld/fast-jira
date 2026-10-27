import { isAbsolute } from "node:path";
import { runReleaseUpdate } from "./release-update.ts";

const [home, id] = process.argv.slice(2);
if (
  process.platform !== "darwin" ||
  !home ||
  !isAbsolute(home) ||
  !id ||
  !/^[a-zA-Z0-9-]{1,80}$/.test(id)
) {
  process.exitCode = 1;
} else await runReleaseUpdate(home, id);
