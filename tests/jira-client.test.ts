import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseIssueKey,
  record,
  requiredString,
} from "../src/domain/validation.ts";
import {
  createJiraClient,
  credentialsFromEnv,
  ensureJiraResponse,
  JiraError,
} from "../src/server/jira-client.ts";

const credentials = {
  site: "example.atlassian.net",
  email: "test@example.com",
  token: "fake-token",
};
test("설정 누락·다른 사이트 URL·잘못된 키를 거부한다", () => {
  assert.throws(() => credentialsFromEnv({}));
  assert.throws(() =>
    credentialsFromEnv({
      JIRA_SITE: "bad.example",
      JIRA_EMAIL: "test",
      JIRA_API_TOKEN: "fake",
    }),
  );
  assert.equal(parseIssueKey("test-12", credentials.site), "TEST-12");
  assert.throws(() =>
    parseIssueKey(
      "https://other.atlassian.net/browse/TEST-1",
      credentials.site,
    ),
  );
  assert.throws(() => parseIssueKey("TEST-1; command", credentials.site));
});
test("가짜 HTTP에서 인증 헤더·사이트 제한과 응답 디코더를 확인한다", async () => {
  let called = 0;
  const client = createJiraClient(credentials, async (url, options) => {
    called++;
    assert.equal(
      String(url),
      "https://example.atlassian.net/rest/api/3/myself",
    );
    assert.equal(
      new Headers(options?.headers).get("Authorization"),
      `Basic ${Buffer.from("test@example.com:fake-token").toString("base64")}`,
    );
    assert.equal(options?.redirect, "error");
    return Response.json({ accountId: "me" });
  });
  assert.equal(
    await client.json("/rest/api/3/myself", (value) =>
      requiredString(record(value).accountId, "accountId"),
    ),
    "me",
  );
  assert.throws(() => client.request("//attacker.example/path"));
  assert.throws(() => client.request("https://attacker.example"));
  assert.equal(called, 1);
});
test("성공 JSON도 예상한 형식이 아니면 거부한다", async () => {
  const client = createJiraClient(credentials, async () =>
    Response.json({ accountId: 42 }),
  );
  await assert.rejects(
    client.json("/rest/api/3/myself", (value) =>
      requiredString(record(value).accountId, "accountId"),
    ),
  );
});
test("Jira 오류를 구조에 따라 읽고 HTTP 상태를 유지한다", async () => {
  await assert.rejects(
    ensureJiraResponse(
      Response.json(
        { errorMessages: ["권한 없음"], errors: { parent: "잘못된 부모" } },
        { status: 403 },
      ),
    ),
    (error) =>
      error instanceof JiraError &&
      error.status === 403 &&
      error.message.includes("잘못된 부모"),
  );
  await assert.rejects(
    ensureJiraResponse(new Response("not json", { status: 502 })),
    (error) => error instanceof JiraError && error.status === 502,
  );
});
