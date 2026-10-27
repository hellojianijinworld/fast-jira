import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configureLocalDomain, npmScript } from "../src/cli/local-domain.ts";

test("도메인 동의를 하지 않으면 도구 설치와 시스템 설정을 시도하지 않는다", async () => {
  const result = await configureLocalDomain(
    "/tmp/unused",
    4173,
    false,
    "instance",
    {
      run: async () => assert.fail("명령 실행 금지"),
      verify: async () => assert.fail("조회 금지"),
      major: 26,
    },
  );
  assert.equal(result.url, "http://localhost:4173");
});
test("동의한 도메인 연결이 검증된 경우에만 기본 주소로 사용한다", async () => {
  const commands: string[][] = [];
  const result = await configureLocalDomain(
    "/tmp/example",
    4184,
    true,
    "instance",
    {
      run: async (_name, args) => {
        commands.push(args);
      },
      verify: async () => true,
      major: 26,
    },
  );
  assert.equal(result.url, "https://fast-jira.local");
  assert.ok(commands.some((args) => args.includes("portless@0.15.11")));
  assert.ok(
    commands.some(
      (args) =>
        args.includes("alias") &&
        args.includes("fast-jira") &&
        args.includes("4184"),
    ),
  );
  assert.ok(
    commands.every(
      (args) => !args.includes("--lan") && !args.includes("service"),
    ),
  );
});
test("설정 거부·실패·낮은 Node 버전은 기존 서비스 주소를 제공한다", async () => {
  for (const major of [22, 26]) {
    const result = await configureLocalDomain(
      "/tmp/example",
      4184,
      true,
      "instance",
      {
        run: async () => {
          throw new Error("denied");
        },
        verify: async () => false,
        major,
      },
    );
    assert.equal(result.url, "http://localhost:4184");
    assert.ok(result.message);
  }
});

test("Homebrew npm 심볼릭 링크와 표준 설치의 npm 스크립트를 찾는다", {
  skip: process.platform === "win32",
}, async (t) => {
  const home = await mkdtemp(join(tmpdir(), "jira-npm-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const bin = join(home, "node/bin"),
    global = join(home, "global/npm-cli.js");
  await mkdir(bin, { recursive: true });
  await mkdir(join(home, "global"));
  await writeFile(global, "// fake npm");
  await symlink(global, join(bin, "npm"));
  assert.equal(npmScript(join(bin, "node")), await realpath(global));
  const standard = join(bin, "node_modules/npm/bin/npm-cli.js");
  await mkdir(join(bin, "node_modules/npm/bin"), { recursive: true });
  await writeFile(standard, "// fake npm");
  assert.equal(npmScript(join(bin, "node")), await realpath(standard));
  assert.equal(npmScript(join(home, "missing/node")), undefined);
});
