import assert from "node:assert/strict";
import { test } from "node:test";
import type { LogEntry } from "../src/domain/log.ts";
import { loggedFetch } from "../src/server/network-log.ts";

test("요청·응답을 같은 ID로 기록하고 원래 응답을 소비하지 않는다", async () => {
  const entries: LogEntry[] = [];
  const request = loggedFetch(
    async () => Response.json({ ok: true }),
    (entry) => entries.push(entry),
  );
  const response = await request("https://example.atlassian.net/rest/test", {
    headers: { Authorization: "secret" },
  });
  assert.deepEqual(await response.json(), { ok: true });
  for (let n = 0; n < 20 && !entries.some((entry) => entry.response); n++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(entries.at(-1)?.response, '{"ok":true}');
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 1);
  assert.ok(!JSON.stringify(entries).includes("secret"));
});
test("꺼진 로그는 응답을 복제하지 않고 바이너리·실패·크기 제한을 처리한다", async () => {
  const entries: LogEntry[] = [];
  let response = new Response("x".repeat(40000), {
    headers: { "content-type": "text/plain" },
  });
  let enabled = false;
  const request = loggedFetch(
    async () => response,
    (entry) => entries.push(entry),
    () => enabled,
  );
  assert.equal(await request("https://example.atlassian.net/test"), response);
  assert.equal(entries.length, 0);
  enabled = true;
  await request("https://example.atlassian.net/test");
  for (let n = 0; n < 20 && !entries.some((entry) => entry.response); n++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(entries.at(-1)?.response?.endsWith("32 KiB까지만 표시합니다."));
  response = new Response(new Uint8Array([1, 2]), {
    headers: { "content-type": "image/png" },
  });
  await request("https://example.atlassian.net/image");
  assert.equal(entries.at(-1)?.response, "바이너리 응답 · image/png");
  const failure = loggedFetch(
    async () => {
      throw new Error("offline");
    },
    (entry) => entries.push(entry),
  );
  await assert.rejects(
    failure("https://example.atlassian.net/test"),
    /offline/,
  );
  assert.equal(entries.at(-1)?.response, "offline");
});
