import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { trustLocalCertificate } from "../src/cli/certificate-trust.ts";

test("이미 신뢰되는 도메인은 인증창을 다시 열지 않는다", async () => {
  const calls: string[] = [];
  await trustLocalCertificate("/tmp/state", async (command) => {
    calls.push(command);
  });
  assert.deepEqual(calls, ["/usr/bin/security", "/usr/bin/curl"]);
});

for (const status of [0, -128]) {
  test(`인증서 GUI 결과 ${status}를 확인하고 임시 설치 앱을 제거한다`, async () => {
    let directory = "";
    let source = "";
    const configure = trustLocalCertificate(
      "/tmp/state",
      async (command, args) => {
        if (command === "/usr/bin/security" && args[0] === "verify-cert")
          throw new Error("not trusted");
        if (command === "/usr/bin/osacompile")
          source = await readFile(args[4] ?? "", "utf8");
        if (command === "/usr/bin/open") {
          directory = dirname(args[2] ?? "");
          await writeFile(
            join(directory, "result.json"),
            JSON.stringify({ status }),
          );
        }
      },
    );
    if (status === 0) await configure;
    else await assert.rejects(configure, /인증서 승인/);
    assert.match(source, /SecTrustSettingsSetTrustSettings\(cert, 0,/);
    assert.ok(!source.includes("kSecTrustSettingsPolicyString"));
    assert.match(source, /policy.setObjectForKey\(\$\(2\)/);
    assert.ok(!source.includes("authorizationdb"));
    await assert.rejects(access(directory), { code: "ENOENT" });
  });
}
