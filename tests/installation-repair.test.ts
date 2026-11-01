import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  launchInstallationRepair,
  readRepairJob,
  runInstallationRepair,
  writeRepairJob,
} from "../src/cli/installation-repair.ts";
import { repairRequest } from "../src/domain/installation-management.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const home = await mkdtemp(join(tmpdir(), "jira 복구-"));
  await mkdir(join(home, "config"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}
const job = () => ({
  id: randomUUID(),
  target: "domain" as const,
  phase: "pending" as const,
  startedAt: Date.now(),
});

test("복구 요청은 지정한 대상과 명시적인 도메인 동의만 받는다", () => {
  assert.deepEqual(repairRequest({ target: "domain", consent: true }), {
    target: "domain",
    consent: true,
  });
  assert.deepEqual(repairRequest({ target: "codex" }), { target: "codex" });
  for (const value of [
    { target: "domain" },
    { target: "shell" },
    { target: "claude", command: "anything" },
    { target: "codex-login", url: "https://elsewhere.example" },
  ])
    assert.throws(() => repairRequest(value));
});

test("복구 작업은 소유한 작업만 실행하고 결과와 비밀값을 분리한다", async (t) => {
  const home = await fixture(t),
    planned = job();
  await writeRepairJob(home, planned);
  let calls = 0;
  await runInstallationRepair(home, randomUUID(), async () => {
    calls++;
  });
  assert.equal(calls, 0);
  await runInstallationRepair(home, planned.id, async (target) => {
    assert.equal(target, "domain");
    calls++;
    throw new Error("TOKEN=private");
  });
  assert.equal(calls, 1);
  assert.equal((await readRepairJob(home))?.phase, "failed");
  assert(
    !(await readFile(join(home, "config/repair-job.json"), "utf8")).includes(
      "TOKEN",
    ),
  );
  await runInstallationRepair(home, planned.id, async () => {
    calls++;
  });
  assert.equal(calls, 1, "완료된 동작 재실행 금지");
});

test("실행 중 작업은 읽기로 덮어쓰지 않고 중단 상태만 보고한다", async (t) => {
  const home = await fixture(t),
    planned = {
      ...job(),
      phase: "running" as const,
      startedAt: Date.now() - 60000,
      pid: 2147483647,
    };
  await writeRepairJob(home, planned);
  const before = await readFile(join(home, "config/repair-job.json"), "utf8");
  const observed = await readRepairJob(home);
  assert.equal(observed?.phase, "interrupted");
  assert.equal((observed as unknown as Record<string, unknown>).pid, undefined);
  assert.equal(
    await readFile(join(home, "config/repair-job.json"), "utf8"),
    before,
  );
});

test("작업 완료는 별도 작업자에서 기록하고 재실행해도 중복 적용하지 않는다", async (t) => {
  const home = await fixture(t),
    planned = job();
  await writeRepairJob(home, planned);
  let calls = 0;
  await runInstallationRepair(home, planned.id, async () => {
    calls++;
  });
  await runInstallationRepair(home, planned.id, async () => {
    calls++;
  });
  assert.equal(calls, 1);
  assert.equal((await readRepairJob(home))?.phase, "complete");
});

test("실제 별도 복구 작업자는 고정 로그인 인자만 전달하고 비밀 환경변수는 제외한다", async (t) => {
  const home = await fixture(t);
  const executable = join(home, "가짜 CLI.mjs"),
    output = join(home, "observed.json");
  await writeFile(
    executable,
    `import {writeFileSync} from "node:fs"; writeFileSync(process.env.REPAIR_TEST_OUT, JSON.stringify({args:process.argv.slice(2),jira:process.env.JIRA_TOKEN,api:process.env.OPENAI_API_KEY}));`,
  );
  const patch = {
    FAST_JIRA_CODEX_BIN: executable,
    REPAIR_TEST_OUT: output,
    JIRA_TOKEN: "do-not-inherit",
    OPENAI_API_KEY: "do-not-inherit",
  };
  const before = Object.fromEntries(
    Object.keys(patch).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, patch);
  t.after(async () => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const planned = await launchInstallationRepair(
    home,
    "codex-login",
    fileURLToPath(new URL("../dist/cli/repair-main.js", import.meta.url)),
  );
  let observed = await readRepairJob(home);
  const until = Date.now() + 10000;
  while (
    observed?.phase !== "complete" &&
    observed?.phase !== "failed" &&
    Date.now() < until
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    observed = await readRepairJob(home);
  }
  assert.equal(observed?.id, planned.id);
  assert.equal(observed?.phase, "complete");
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), {
    args: ["login"],
  });
});
