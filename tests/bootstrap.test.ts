import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  bootstrapScripts,
  nodeArchiveNames,
} from "../scripts/bootstrap/generate.ts";

const execute = promisify(execFile);
const hash = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const base = {
  version: "0.1.1",
  commit: "a".repeat(40),
  node: "24.22.2",
  installerSha256: "b".repeat(64),
};
function sums(patch: Record<string, string> = {}) {
  return nodeArchiveNames(base.node)
    .map((name) => `${patch[name] ?? "c".repeat(64)}  ${name}`)
    .join("\n");
}

test("설치기 생성은 빠진 Node 아키텍처 체크섬과 잘못된 배포 정보를 거부한다", async () => {
  await assert.rejects(bootstrapScripts(base, ""), /체크섬/);
  await assert.rejects(
    bootstrapScripts({ ...base, node: "24;run" }, sums()),
    /버전/,
  );
  await assert.rejects(
    bootstrapScripts({ ...base, installerSha256: "wrong" }, sums()),
    /체크섬/,
  );
});

test("Node 없는 Shell 설치기는 검증한 런타임을 준비하고 같은 실행에서 플랫폼과 경로를 전달한다", {
  skip: process.platform === "win32",
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "jira bootstrap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "한글 개인 폴더");
  const bin = join(root, "bin");
  const nodeName = "node-v24.22.2-darwin-arm64";
  await mkdir(join(root, nodeName, "bin"), { recursive: true });
  await mkdir(bin);
  const calls = join(root, "calls");
  const fakeNode = join(root, nodeName, "bin/node");
  await writeFile(
    fakeNode,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo v24.22.2; else printf "%s\\n" "$@" > "$CALLS"; exit "$HANDOFF_EXIT"; fi\n',
  );
  await chmod(fakeNode, 0o700);
  const archive = join(root, "node.tar.gz");
  await execute("tar", ["-czf", archive, "-C", root, nodeName]);
  const helper = Buffer.from("verified installer");
  await writeFile(join(root, "helper"), helper);
  await writeFile(
    join(bin, "uname"),
    '#!/bin/sh\ncase "$1" in -s) echo Darwin;; -m) echo arm64;; esac\n',
  );
  await writeFile(
    join(bin, "curl"),
    '#!/bin/sh\nfor arg do if [ "$previous" = "--output" ]; then out="$arg"; fi; previous="$arg"; done\ncase "$previous" in *nodejs.org*) cp "$FIXTURE/node.tar.gz" "$out";; *) cp "$FIXTURE/helper" "$out";; esac\nprintf "%s" "$previous"\n',
  );
  for (const name of ["uname", "curl"]) await chmod(join(bin, name), 0o700);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FIXTURE: root,
    CALLS: calls,
    HANDOFF_EXIT: "0",
  };
  const generated = await bootstrapScripts(
    { ...base, installerSha256: hash(helper) },
    sums({
      "node-v24.22.2-darwin-arm64.tar.gz": hash(await readFile(archive)),
    }),
  );
  const script = join(root, "install.sh");
  await writeFile(script, generated.sh);
  await execute(
    "sh",
    [
      script,
      "--platform",
      "codex",
      "--home",
      home,
      "--domain",
      "no",
      "--no-open",
    ],
    { env },
  );
  const args = (await readFile(calls, "utf8")).trim().split("\n");
  assert.equal(args[1], "0.1.1");
  assert.equal(args[2], "a".repeat(40));
  assert.equal(args[4], home);
  assert.deepEqual(args.slice(5), [
    "--platform",
    "codex",
    "--domain",
    "no",
    "--no-open",
  ]);
  assert.equal(
    await readFile(join(home, "tools", nodeName, "bin/node"), "utf8"),
    await readFile(fakeNode, "utf8"),
  );
  await assert.rejects(
    execute("sh", [script, "--platform", "other", "--home", home], { env }),
  );
  await assert.rejects(
    execute("sh", [script, "--platform", "codex", "--home", home], {
      env: { ...env, HANDOFF_EXIT: "17" },
    }),
    (error: unknown) => (error as { code: number }).code === 17,
  );
  const corruptHome = join(root, "corrupt");
  const corrupted = await bootstrapScripts(
    { ...base, installerSha256: hash(helper) },
    sums(),
  );
  await writeFile(script, corrupted.sh);
  await assert.rejects(
    execute("sh", [script, "--platform", "codex", "--home", corruptHome], {
      env,
    }),
  );
  await assert.rejects(
    readFile(join(corruptHome, "tools", nodeName, "bin/node")),
  );
});
