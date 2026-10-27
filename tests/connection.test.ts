import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseEnv } from "node:util";
import { createConnection } from "../src/server/connection.ts";
import { saveCredentials } from "../src/server/environment.ts";
import { createHttpServer } from "../src/server/http.ts";

test("미인증 화면에서 토큰을 검증·저장하면 재시작 없이 연결되고 실패한 키는 기존 설정을 보존한다", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fast-jira-connection-"));
  const path = join(directory, ".env");
  await writeFile(
    path,
    "# 유지\nPORT=4173\nJIRA_API_TOKEN=old-token\nJIRA_RELATED_FIELDS=디자인 담당자\n",
  );
  let jiraCalls = 0;
  const connection = createConnection({
    credentials: null,
    defaults: { site: "example.atlassian.net", email: "test@example.com" },
    persist: (credentials) => saveCredentials(credentials, path),
    fetcher: async (input, options) => {
      jiraCalls++;
      assert.ok(
        !options?.method || options.method === "GET",
        "실제 Jira 쓰기를 하지 않는다",
      );
      const authorization = new Headers(options?.headers).get("Authorization");
      if (
        authorization !==
        `Basic ${Buffer.from("test@example.com:good-token").toString("base64")}`
      )
        return Response.json({}, { status: 401 });
      return new URL(String(input)).pathname.endsWith("/myself")
        ? Response.json({ accountId: "my-account", displayName: "나" })
        : Response.json({ values: [], isLast: true });
    },
  });
  assert.equal(connection.settings().tokenConfigured, false);
  const server = createHttpServer(connection.service, undefined, connection);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true });
  });
  const save = (token: string, origin = base) =>
    fetch(`${base}/api/connection`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: "example.atlassian.net",
        email: "test@example.com",
        token,
      }),
    });
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(`${base}/api/projects`)).status, 401);
  assert.equal(jiraCalls, 0);
  assert.equal(
    (await save("good-token", "https://attacker.example")).status,
    403,
  );
  assert.equal(jiraCalls, 0);
  assert.equal((await save("bad-token")).status, 401);
  assert.match(await readFile(path, "utf8"), /JIRA_API_TOKEN=old-token/);
  assert.equal((await save("token\nPORT=1")).status, 400);
  const saved = await save("good-token");
  assert.equal(saved.status, 200);
  assert.ok(!(await saved.text()).includes("good-token"));
  const text = await readFile(path, "utf8");
  const env = parseEnv(text);
  assert.equal(env.JIRA_API_TOKEN, "good-token");
  assert.equal(env.JIRA_SITE, "example.atlassian.net");
  assert.equal(env.PORT, "4173");
  assert.equal(env.JIRA_RELATED_FIELDS, "디자인 담당자");
  assert.ok(text.startsWith("# 유지\n"));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await fetch(`${base}/api/projects`)).status, 200);
  assert.equal((await save("bad-token")).status, 401);
  assert.equal((await fetch(`${base}/api/projects`)).status, 200);
  assert.equal(
    parseEnv(await readFile(path, "utf8")).JIRA_API_TOKEN,
    "good-token",
  );
  const settings = await fetch(`${base}/api/connection`);
  assert.deepEqual(await settings.json(), {
    site: "example.atlassian.net",
    email: "test@example.com",
    tokenConfigured: true,
  });
});

test("인증 대기·확인·실패·완료 상태는 개인정보와 Jira 추가 조회 없이 확인한다", async (t) => {
  let begin!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const connection = createConnection({
    credentials: null,
    defaults: { site: "", email: "" },
    persist: async () => {},
    fetcher: async (_input, init) => {
      calls++;
      if (calls === 1) {
        begin();
        await pending;
        return Response.json(
          { errorMessages: ["private-token"] },
          { status: 401 },
        );
      }
      assert.equal(init?.method ?? "GET", "GET");
      return Response.json({
        accountId: "fixture-user",
        displayName: "검사 계정",
      });
    },
  });
  const server = createHttpServer(connection.service, undefined, connection);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    finish();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const state = async () => {
    const response = await fetch(`${base}/api/connection/status`);
    assert.equal(response.status, 200);
    return response.json();
  };
  const save = () =>
    fetch(`${base}/api/connection`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({
        site: "example.atlassian.net",
        email: "fixture@example.com",
        token: "private-token",
      }),
    });
  assert.deepEqual(await state(), { state: "waiting" });
  assert.equal(calls, 0);
  const saving = save();
  await started;
  assert.deepEqual(await state(), { state: "checking" });
  finish();
  const failed = await saving;
  assert.equal(failed.status, 401);
  assert.ok(!(await failed.text()).includes("private-token"));
  assert.deepEqual(await state(), { state: "failed" });
  assert.equal(calls, 1);
  assert.equal((await save()).status, 200);
  assert.deepEqual(await state(), { state: "connected" });
  assert.equal(calls, 2);
});

test("저장된 토큰은 검증하지 않고 연결 성공으로 표시하지 않는다", () => {
  const connection = createConnection({
    credentials: {
      site: "example.atlassian.net",
      email: "fixture@example.com",
      token: "saved-token",
    },
    defaults: { site: "", email: "" },
    fetcher: async () => {
      throw new Error("상태 확인은 Jira를 호출하면 안 된다");
    },
  });
  assert.deepEqual(connection.status(), { state: "unverified" });
});
