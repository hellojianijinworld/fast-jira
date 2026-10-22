import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiraService } from "../src/server/jira-service.ts";

test("부모 후보는 선택 키를 묶어 읽고 같은 프로젝트의 동적 상위 유형만 커서로 검색한다", async () => {
  const queries: URL[] = [];
  const service = createJiraService({
    credentials: {
      site: "example.atlassian.net",
      email: "test@example.com",
      token: "fake",
    },
    fetcher: async (input, options) => {
      assert.ok(!options?.method || options.method === "GET");
      const url = new URL(String(input));
      queries.push(url);
      if (url.pathname.includes("createmeta"))
        return Response.json({
          issueTypes: [
            { id: "10", name: "사용자 단계", hierarchyLevel: 2 },
            { id: "20", name: "사용자 상위", hierarchyLevel: 3 },
          ],
          isLast: true,
        });
      const selected = url.searchParams.get("jql")?.startsWith("key in");
      return Response.json({
        issues: selected
          ? ["AA-1", "AA-2"].map((key) => ({
              key,
              fields: {
                summary: "선택",
                project: { key: "AA" },
                issuetype: { id: "10", hierarchyLevel: 2 },
              },
            }))
          : [
              {
                key: "AA-9",
                fields: {
                  summary: "가능한 부모",
                  project: { key: "AA" },
                  issuetype: { id: "20", hierarchyLevel: 3 },
                },
              },
            ],
        nextPageToken: selected ? undefined : "next",
      });
    },
  });
  const page = await service.parentOptions(["AA-1", "AA-2"], '배포 "계획"', "");
  assert.equal(page.issues[0]?.key, "AA-9");
  assert.equal(page.nextPageToken, "next");
  const jql = queries.at(-1)?.searchParams.get("jql") ?? "";
  assert.match(jql, /project = AA/);
  assert.match(jql, /issuetype in \(20\)/);
  assert.match(jql, /key not in \(AA-1, AA-2\)/);
  assert.ok(jql.includes('summary ~ "배포 \\"계획\\""'));
  await service.parentOptions(["AA-2", "AA-1"], "AA-9", "next");
  assert.equal(
    queries.filter((url) => url.searchParams.get("jql")?.startsWith("key in"))
      .length,
    1,
  );
  assert.equal(queries.at(-1)?.searchParams.get("nextPageToken"), "next");
  await assert.rejects(service.parentOptions([], "", ""));
  await assert.rejects(service.parentOptions(["AA-1"], "x\n", ""));
});
