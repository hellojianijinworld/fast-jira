import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpServer } from "../src/server/http.ts";
import { createJiraService } from "../src/server/jira-service.ts";

const since = new Date(Date.now() - 3 * 3600000).toISOString();
const options = {
  projects: "AA",
  q: "",
  scope: "all" as const,
  excludeDone: false,
  statuses: "",
  assignees: "",
};
const old = "2026-10-01T00:00:00.000Z";
const fresh = "2026-10-02T00:00:00.000Z";
function setup(issueErrors: object[] = []) {
  const calls: { path: string; body: Record<string, unknown> | null }[] = [];
  const service = createJiraService({
    credentials: {
      site: "example.atlassian.net",
      email: "test@example.com",
      token: "fake",
    },
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ path: url.pathname, body });
      if (url.pathname.endsWith("/field")) return Response.json([]);
      if (url.pathname.endsWith("/bulkfetch")) {
        assert(body);
        const fields = body.fields as string[];
        const issue = {
          id: "101",
          key: "BB-9",
          fields: {
            updated: fresh,
            parent: { key: "BB-1" },
            project: { key: "BB" },
            ...(fields.includes("summary") ? { summary: "이동된 작업" } : {}),
          },
        };
        return Response.json({
          issues: (body.issueIdsOrKeys as string[]).includes("101")
            ? [issue]
            : [],
          issueErrors,
        });
      }
      if (url.pathname.endsWith("/search/jql"))
        return Response.json({ issues: [] });
      throw new Error(url.pathname);
    },
  });
  return { service, calls };
}
test("3시간 전부터 변경을 찾고 프로젝트 밖으로 이동한 기존 ID와 삭제를 대조한다", async () => {
  const { service, calls } = setup();
  const result = await service.sync(options, {
    since,
    known: [
      { id: "101", key: "AA-1", updated: old },
      { id: "102", key: "AA-2", updated: old },
    ],
  });
  assert.deepEqual(result.removed, ["AA-1", "AA-2"]);
  assert.equal(
    result.issues.find((issue) => issue.key === "BB-9")?.matches,
    false,
  );
  assert.equal(result.issues[0]?.id, "101");
  assert.equal(result.issues[0]?.parent, "BB-1");
  assert.equal(
    calls.filter((call) => call.path.endsWith("/bulkfetch")).length,
    2,
  );
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
});
test("일시적인 묶음 오류는 삭제 결과나 성공 확인 시점을 반환하지 않는다", async () => {
  const { service } = setup([{ id: "102", errorMessage: "temporary error" }]);
  await assert.rejects(
    service.sync(options, {
      since,
      known: [{ id: "102", key: "AA-2", updated: old }],
    }),
    /묶음/,
  );
});
test("잘못된 ID·미래 시각은 Jira 요청 전에 거부한다", async () => {
  const { service, calls } = setup();
  await assert.rejects(
    service.sync(options, {
      since,
      known: [{ id: "bad", key: "AA-1", updated: old }],
    }),
  );
  await assert.rejects(
    service.sync(options, {
      since: new Date(Date.now() + 3600000).toISOString(),
      known: [],
    }),
  );
  assert.equal(calls.length, 0);
});

test("1,001개 이슈는 HTTP 경계에서도 가벼운 두 묶음으로만 확인한다", async (t) => {
  const sizes: number[] = [];
  const service = createJiraService({
    credentials: {
      site: "example.atlassian.net",
      email: "test@example.com",
      token: "fake",
    },
    fetcher: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/field")) return Response.json([]);
      if (path.endsWith("/search/jql")) return Response.json({ issues: [] });
      assert(path.endsWith("/issue/bulkfetch"));
      const body = JSON.parse(String(init?.body)) as {
        fields: string[];
        issueIdsOrKeys: string[];
      };
      assert.deepEqual(body.fields, ["updated", "parent", "project"]);
      sizes.push(body.issueIdsOrKeys.length);
      return Response.json({
        issues: body.issueIdsOrKeys.map((id) => ({
          id,
          key: `AA-${id}`,
          fields: { updated: old, project: { key: "AA" } },
        })),
        issueErrors: [],
      });
    },
  });
  const server = createHttpServer(service, () => () => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${base}/api/sync`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "projects=AA&scope=all",
      since,
      known: Array.from({ length: 1001 }, (_, index) => ({
        id: String(index + 1),
        key: `AA-${index + 1}`,
        updated: old,
        parent: "",
        project: "AA",
      })),
    }),
  });
  assert.equal(response.status, 200);
  const result = (await response.json()) as {
    removed: string[];
    issues: unknown[];
  };
  assert.deepEqual(sizes, [1000, 1]);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.issues, []);
});

test("변경되지 않은 구캐시도 참여자 정보가 없으면 필드 데이터를 한 번만 보강한다", async () => {
  const { service, calls } = setup();
  const result = await service.sync(options, {
    since,
    known: [
      {
        id: "101",
        key: "BB-9",
        updated: fresh,
        parent: "BB-1",
        project: "BB",
        needsParticipants: true,
      },
    ],
  });
  assert.deepEqual(result.issues[0]?.participantFields, []);
  assert.equal(result.issues[0]?.summary, "이동된 작업");
  const checks = calls.filter((call) => call.path.endsWith("/issue/bulkfetch"));
  assert.equal(checks.length, 2);
});
