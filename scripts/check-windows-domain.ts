import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureLocalDomain,
  verifyAddress,
} from "../src/cli/local-domain.ts";

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
  // CI는 대화형 화면이 없어 일회성 관리자 환경의 컴퓨터 인증서 저장소를 사용한다.
  const trust = async (state: string) => {
    const result = spawnSync(
      "certutil.exe",
      ["-addstore", "Root", join(state, "windows-cert.pem")],
      { stdio: "inherit", timeout: 30000 },
    );
    assert.equal(result.status, 0);
  };
  const result = await configureLocalDomain(home, port, true, instance, {
    trust,
    verify: async (state, expected) => {
      const valid = await verifyAddress(state, expected);
      if (!valid) {
        const curl = spawnSync(
          "curl.exe",
          [
            "--disable",
            "--verbose",
            "--noproxy",
            "fast-jira.local",
            "--cacert",
            join(state, "windows-cert.pem"),
            "--max-time",
            "10",
            "https://fast-jira.local/api/health",
          ],
          { encoding: "utf8", timeout: 15000 },
        );
        console.log("HTTPS 확인 결과", {
          status: curl.status,
          stdout: curl.stdout,
          stderr: curl.stderr,
        });
        const hosts = await readFile(
          join(
            process.env.SystemRoot ?? "C:/Windows",
            "System32/drivers/etc/hosts",
          ),
          "utf8",
        );
        console.log(
          "Fast Jira hosts",
          hosts.split(/\r?\n/).filter((line) => line.includes("fast-jira")),
        );
      }
      return valid;
    },
  });
  assert.equal(result.url, "https://fast-jira.local", result.message);
  const certificate = new X509Certificate(
    await readFile(join(home, "config/portless/windows-cert.pem")),
  );
  assert.equal(certificate.ca, false);
  assert.equal(certificate.issuer, certificate.subject);
  assert.equal(certificate.checkHost("fast-jira.local"), "fast-jira.local");
  assert.equal(certificate.checkHost("another.local"), undefined);
  const again = await configureLocalDomain(home, port, true, instance, {
    trust,
  });
  assert.equal(again.url, result.url);
  console.log(
    "Windows: hosts·HTTPS 프록시·인증서 신뢰·실제 응답·재실행 통과. UAC·현재 사용자 인증서 승인 UI는 미검증.",
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
  const certificateFile = join(home, "config/portless/windows-cert.pem");
  const certificate = await readFile(certificateFile)
    .then((bytes) => new X509Certificate(bytes))
    .catch(() => null);
  if (certificate)
    spawnSync(
      "certutil.exe",
      ["-delstore", "Root", certificate.fingerprint.replaceAll(":", "")],
      { stdio: "ignore", timeout: 30000 },
    );
  server.kill();
  await once(server, "exit");
  await rm(home, { recursive: true, force: true });
}
