import assert from "node:assert/strict";
import { test } from "node:test";
import { configureLocalDomain } from "../src/cli/local-domain.ts";

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
