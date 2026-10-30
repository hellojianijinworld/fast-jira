import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureLocalDomain } from "../src/cli/local-domain.ts";

// Windows CI의 일회성 관리자 계정에서만 실행한다. UAC 클릭 자체는 검사하지 않는다.
assert.equal(process.platform, "win32");
assert.equal(process.env.GITHUB_ACTIONS, "true");
const home = await mkdtemp(join(tmpdir(), "fast-jira-domain-"));
const instance = "windows-ci";
const server = spawn(
  process.execPath,
  [
    "-e",
    `
require('node:http').createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'fast-jira',instance:'windows-ci'}));}).listen(0,'127.0.0.1',function(){console.log(this.address().port);});
`,
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
assert(server.stdout);
const [chunk] = await once(server.stdout, "data");
const port = Number(String(chunk).trim());
assert(Number.isInteger(port) && port > 0);
const env = {
  ...process.env,
  PORTLESS_STATE_DIR: join(home, "config/portless"),
  PORTLESS_PORT: "443",
  PORTLESS_TLD: "local",
  PORTLESS_LAN: "0",
  PORTLESS_HTTPS: "1",
};
const cli = join(home, "tools/node_modules/portless/dist/cli.js");
try {
  const result = await configureLocalDomain(home, port, true, instance);
  assert.equal(result.url, "https://fast-jira.local", result.message);
  const again = await configureLocalDomain(home, port, true, instance);
  assert.equal(again.url, result.url);
  console.log(
    "Windows: hosts·HTTPS 프록시·인증서 신뢰·실제 응답·재실행 통과. UAC 클릭은 미검증.",
  );
} finally {
  for (const args of [
    ["alias", "--remove", "fast-jira"],
    ["hosts", "clean"],
    ["proxy", "stop", "--port", "443"],
  ])
    spawnSync(process.execPath, [cli, ...args], {
      env,
      timeout: 30000,
      stdio: "ignore",
    });
  server.kill();
  await once(server, "exit");
  await rm(home, { recursive: true, force: true });
}
