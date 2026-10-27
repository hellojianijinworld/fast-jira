import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";

const args = [
  "--import",
  "tsx",
  "--import",
  "./tests/support/runtime-fetch.ts",
  "src/server/main.ts",
];
const credentials = {
  ...process.env,
  JIRA_SITE: "example.atlassian.net",
  JIRA_EMAIL: "test@example.com",
  JIRA_API_TOKEN: "fake-runtime-token",
};

test("실행 진입점은 인증 실패에도 화면을 제공하고 잘못된 포트만 거부한다", async (t) => {
  for (const env of [{ ...credentials, PORT: "invalid" }]) {
    const failed = spawnSync(process.execPath, args, {
      env,
      encoding: "utf8",
      timeout: 15000,
    });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /JIRA_EMAIL|PORT/);
    assert.ok(
      !failed.stdout.includes("fake-runtime-token") &&
        !failed.stderr.includes("fake-runtime-token"),
    );
  }
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  for (const env of [
    credentials,
    { ...credentials, JIRA_EMAIL: "" },
    { ...credentials, JIRA_API_TOKEN: "invalid-token" },
  ]) {
    const child = spawn(process.execPath, args, {
      env: { ...env, PORT: String(address.port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      errors = "";
    child.stderr.on("data", (chunk) => {
      errors += String(chunk);
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await once(child, "close");
      }
    });
    const signal = AbortSignal.timeout(15000);
    while (!output.includes("Fast Jira API:")) {
      const [chunk] = await once(child.stdout, "data", { signal });
      output += String(chunk);
    }
    const response: Response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes("Fast Jira"));
    const projects: Response = await fetch(
      `http://127.0.0.1:${address.port}/api/projects`,
    );
    assert.equal(
      projects.status,
      env.JIRA_EMAIL && env.JIRA_API_TOKEN !== "invalid-token" ? 200 : 401,
    );
    child.kill();
    await once(child, "close");
    assert.equal(errors, "");
    assert.ok(!output.includes("fake-runtime-token"));
  }
});
