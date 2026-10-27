import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  installationPaths,
  nodeSupported,
  parseServiceConfig,
  servicePlist,
} from "../src/cli/config.ts";
import { stageRuntime } from "../src/cli/runtime.ts";
import { removeService } from "../src/cli/service.ts";

test("설치 경로는 플랫폼과 무관한 개인 설정을 분리하고 launchd 레이블은 경로마다 구분한다", () => {
  const first = installationPaths("/tmp/fast jira", "/Users/test");
  const second = installationPaths("/tmp/other", "/Users/test");
  assert.equal(first.runtime, "/tmp/fast jira/runtime");
  assert.equal(first.config, "/tmp/fast jira/config/service.json");
  assert.ok(first.plist.startsWith("/Users/test/Library/LaunchAgents/"));
  assert.notEqual(first.label, second.label);
  assert.equal(nodeSupported("22.11.0"), false);
  assert.equal(nodeSupported("22.12.0"), true);
  assert.equal(nodeSupported("24.0.0"), true);
});

test("설치 설정과 plist는 잘못된 포트를 거부하고 공백·XML 특수문자가 포함된 경로를 보존한다", () => {
  const paths = installationPaths("/tmp/Jira & <work>", "/Users/test");
  const config = parseServiceConfig({
    version: 1,
    port: 4174,
    instance: "test-instance",
    node: "/tmp/Node & Runtime/node",
  });
  const plist = servicePlist(paths, config);
  assert.match(plist, /Jira &amp; &lt;work&gt;/);
  assert.match(plist, /Node &amp; Runtime/);
  assert.match(plist, /<key>PORT<\/key><string>4174<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.throws(() => parseServiceConfig({ ...config, port: 0 }));
  assert.throws(() => parseServiceConfig({ ...config, node: "node" }));
  assert.throws(() => parseServiceConfig({ ...config, version: 2 }));
});

test("실행본 준비는 개인 파일을 제외하고 잘못된 배포본은 기존 실행본을 건드리지 않는다", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fast-jira-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const home = join(root, "private");
  await mkdir(home);
  await writeFile(join(home, ".env"), "PRIVATE=keep");
  await mkdir(join(home, "runtime"));
  await writeFile(join(home, "runtime", "old"), "keep");
  await assert.rejects(stageRuntime(source, home));
  assert.equal(await readFile(join(home, "runtime", "old"), "utf8"), "keep");
  for (const path of ["dist/server", "dist/cli", "dist/client"])
    await mkdir(join(source, path), { recursive: true });
  await writeFile(join(source, "dist/server/main.js"), "server");
  await writeFile(join(source, "dist/cli/main.js"), "cli");
  await writeFile(join(source, "dist/client/index.html"), "screen");
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({ name: "fast-jira", version: "0.1.0", type: "module" }),
  );
  await writeFile(join(source, "LICENSE"), "MIT License");
  await writeFile(join(source, ".env"), "DO_NOT_COPY=secret");
  const staged = await stageRuntime(source, home);
  assert.equal(
    await readFile(join(staged, "dist/client/index.html"), "utf8"),
    "screen",
  );
  assert.equal(await readFile(join(staged, "LICENSE"), "utf8"), "MIT License");
  await assert.rejects(readFile(join(staged, ".env")));
  assert.equal(await readFile(join(home, ".env"), "utf8"), "PRIVATE=keep");
  assert.equal(await readFile(join(home, "runtime", "old"), "utf8"), "keep");
});

test("서비스 설치 기록이 없는 경로의 runtime은 제거하지 않는다", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "fast-jira-unmanaged-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = installationPaths(home);
  await mkdir(paths.runtime);
  await writeFile(join(paths.runtime, "unrelated"), "keep");
  await removeService(paths);
  assert.equal(
    await readFile(join(paths.runtime, "unrelated"), "utf8"),
    "keep",
  );
});
