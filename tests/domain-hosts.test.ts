import assert from "node:assert/strict";
import * as fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { domainHostsScript } from "../src/cli/domain-hosts.ts";

test("IPv6 보완은 다른 hosts 항목과 Portless 블록을 보존하고 중복 기록하지 않는다", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "jira-hosts-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const file = path.join(home, "hosts");
  for (const platform of ["darwin", "win32"]) {
    const original =
      "127.0.0.1 localhost\r\n# ==== portless ====\r\n127.0.0.1 fast-jira.local\r\n# ==== end ====\r\n";
    await writeFile(file, original);
    let writes = 0;
    const process = {
      platform,
      env: { SystemRoot: "C:\\Windows" },
      argv: ["node", "--check"],
      exitCode: 0,
    };
    const run = () =>
      runInNewContext(domainHostsScript, {
        process,
        require: (name: string) =>
          name === "node:path"
            ? path
            : {
                readFileSync: (target: string) => {
                  assert.ok(target.endsWith("hosts"));
                  return fs.readFileSync(file, "utf8");
                },
                writeFileSync: (_target: string, content: string) => {
                  writes++;
                  fs.writeFileSync(file, content);
                },
              },
      });
    run();
    assert.equal(process.exitCode, 1);
    assert.equal(writes, 0);
    process.argv = ["node"];
    run();
    assert.equal(
      await readFile(file, "utf8"),
      original + "::1 fast-jira.local # Fast Jira IPv6\r\n",
    );
    run();
    assert.equal(writes, 1);
    process.argv = ["node", "--check"];
    run();
    assert.equal(process.exitCode, 0);
  }
});
