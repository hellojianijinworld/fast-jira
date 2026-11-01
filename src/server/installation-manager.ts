import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installationPaths } from "../cli/config.ts";
import { installationTargets } from "../cli/installation-record.ts";
import {
  launchInstallationRepair,
  readRepairJob,
} from "../cli/installation-repair.ts";
import { readServiceConfig, serviceStatus } from "../cli/service.ts";
import {
  type InstallationManagement,
  type RepairJob,
  type RepairTarget,
  repairing,
  repairRequest,
} from "../domain/installation-management.ts";
import { JiraError } from "./jira-client.ts";

export function createInstallationManager(options: {
  supported: boolean;
  read: () => Promise<Omit<InstallationManagement, "supported">>;
  start: (target: RepairTarget) => Promise<RepairJob>;
}) {
  let starting = false;
  return {
    async status(): Promise<InstallationManagement> {
      return { ...(await options.read()), supported: options.supported };
    },
    async repair(input: unknown) {
      let request: ReturnType<typeof repairRequest>;
      try {
        request = repairRequest(input);
      } catch {
        throw new JiraError("복구 대상과 동의를 확인해 주세요.", 400);
      }
      if (!options.supported)
        throw new JiraError(
          "설치된 앱에서 연결을 복구할 수 있어요. AI에게 Fast Jira 설치를 요청해 주세요.",
          409,
        );
      if (starting) throw new JiraError("연결 작업이 진행 중이에요.", 409);
      starting = true;
      try {
        if (repairing((await options.read()).job))
          throw new JiraError("연결 작업이 진행 중이에요.", 409);
        return await options.start(request.target);
      } finally {
        starting = false;
      }
    },
  };
}
export type InstallationManager = ReturnType<typeof createInstallationManager>;
export async function createRuntimeInstallationManager() {
  const home = process.cwd(),
    paths = installationPaths(home);
  const config = await readServiceConfig(paths).catch(() => null);
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const supported =
    resolve(root) === resolve(paths.runtime) &&
    !!config &&
    config.instance === process.env.FAST_JIRA_INSTANCE;
  return createInstallationManager({
    supported,
    async read() {
      const current = await serviceStatus(paths);
      const url = "url" in current ? current.url : "";
      return {
        url,
        domain: url === "https://fast-jira.local",
        platforms: supported
          ? (await installationTargets(home)).map((item) => item.platform)
          : [],
        job: supported ? await readRepairJob(home) : null,
      };
    },
    start: (target) => launchInstallationRepair(home, target),
  });
}
