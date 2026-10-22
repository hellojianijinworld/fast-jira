import assert from "node:assert/strict";
import { test } from "node:test";
import { createActivityController } from "../src/client/activity-controller.ts";
import { createJiraActivity } from "../src/server/jira-activity.ts";
import { createJiraClient } from "../src/server/jira-client.ts";

const entry = (id: number) => ({
  id: String(id),
  key: "AA-1",
  author: "나",
  avatar: "",
  text: `활동 ${id}`,
  created: new Date(id * 1000).toISOString(),
});
test("활동은 최신 10개를 유지하고 본인 활동도 신규 ID 두 개만 구분한다", async () => {
  let items = Array.from({ length: 10 }, (_, i) => entry(10 - i));
  let calls = 0;
  const state = createActivityController(
    {
      activity: async () => {
        calls++;
        return items;
      },
    },
    () => {},
  );
  await state.check(["AA"]);
  assert.equal(state.entries.length, 10);
  assert.equal(state.newIds.size, 0);
  items = [entry(12), entry(11), ...items];
  await state.check(["AA"]);
  assert.deepEqual([...state.newIds], ["12", "11"]);
  assert.deepEqual(
    state.entries.map((x) => x.id),
    Array.from({ length: 10 }, (_, i) => String(12 - i)),
  );
  await state.check(["AA"]);
  assert.equal(state.newIds.size, 0);
  assert.equal(calls, 3);
});
test("겹친 조회는 공유하며 이전 프로젝트의 늦은 응답과 종료 후 응답을 버린다", async () => {
  let finish: (value: ReturnType<typeof entry>[]) => void = () => {};
  let calls = 0;
  const pending = new Promise<ReturnType<typeof entry>[]>((resolve) => {
    finish = resolve;
  });
  const state = createActivityController(
    {
      activity: async (projects) => {
        calls++;
        return projects[0] === "AA" ? pending : [entry(20)];
      },
    },
    () => {},
  );
  const a = state.check(["AA"]);
  const b = state.check(["AA"]);
  await state.check(["BB"]);
  finish([entry(1)]);
  await Promise.all([a, b]);
  assert.equal(calls, 2);
  assert.equal(state.entries[0]?.id, "20");
  state.destroy();
  await state.check(["AA"]);
  assert.equal(calls, 2);
});
test("실패는 기존 활동을 지키며 빈 프로젝트는 요청하지 않는다", async () => {
  let fail = false;
  const state = createActivityController(
    {
      activity: async () => {
        if (fail) throw new Error("조회 실패");
        return [entry(1)];
      },
    },
    () => {},
  );
  await state.check(["AA"]);
  fail = true;
  await state.check(["AA"]);
  assert.equal(state.entries[0]?.id, "1");
  assert.match(state.error, /조회 실패/);
  await state.check([]);
  assert.equal(state.entries.length, 0);
  assert.equal(state.error, "");
});
test("서버는 프로젝트를 검증하고 활동 10건을 하나의 읽기 요청으로 전달한다", async () => {
  const calls: URL[] = [];
  const client = createJiraClient(
    { site: "example.atlassian.net", email: "fake@example.com", token: "fake" },
    async (input) => {
      calls.push(new URL(String(input)));
      return new Response('<feed xmlns="http://www.w3.org/2005/Atom"/>', {
        headers: { "Content-Type": "application/atom+xml" },
      });
    },
  );
  const activity = createJiraActivity(client);
  await activity("AA,BB");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.pathname, "/activity");
  assert.equal(calls[0]?.searchParams.get("maxResults"), "10");
  assert.equal(calls[0]?.searchParams.get("streams"), "key IS AA BB");
  await activity("");
  assert.equal(calls.length, 1);
  await assert.rejects(activity("AA&streams=user"));
  assert.equal(calls.length, 1);
});
test("HTML 로그인 응답과 인증 실패를 빈 활동으로 오인하지 않는다", async () => {
  for (const response of [
    new Response("<html>login</html>", {
      headers: { "Content-Type": "text/html" },
    }),
    Response.json({ errorMessages: ["권한 오류"] }, { status: 403 }),
  ]) {
    const client = createJiraClient(
      {
        site: "example.atlassian.net",
        email: "fake@example.com",
        token: "fake",
      },
      async () => response,
    );
    await assert.rejects(createJiraActivity(client)("AA"));
  }
});
