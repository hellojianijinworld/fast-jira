import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions } from "../src/domain/app-update.ts";
import { createAppUpdater } from "../src/server/app-update.ts";

const commit = "a".repeat(40);
const release = {
  tag_name: "v0.1.1",
  name: "작은 개선",
  body: "목록과 검색 개선",
  draft: false,
  prerelease: false,
  assets: [
    "fast-jira-0.1.1.zip",
    "fast-jira-0.1.1.json",
    "fast-jira-download.mjs",
  ].map((name) => ({ name, state: "uploaded", size: 1 })),
};

test("정식 버전을 숫자로 비교하고 잘못된 버전은 거부한다", () => {
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("v0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.1.0", "1.0.0"), -1);
  assert.throws(() => compareVersions("0.1.1-beta", "0.1.0"));
});

test("릴리스 확인은 요청을 공유하고 5분 캐시·ETag를 사용하며 명시한 버전만 설치한다", async () => {
  let time = 1000;
  let requests = 0;
  const starts: unknown[] = [];
  const updater = createAppUpdater({
    currentVersion: "0.1.0",
    supported: true,
    now: () => time,
    readJob: async () => null,
    start: async (target) => {
      starts.push(target);
      return {
        id: "job-1",
        version: target.version,
        phase: "preparing",
        startedAt: time,
        message: "준비 중",
      };
    },
    fetcher: async (input, init) => {
      requests++;
      const url = new URL(String(input));
      assert.equal(url.hostname, "api.github.com");
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      if (url.pathname.endsWith("/releases/latest")) {
        if (new Headers(init?.headers).get("If-None-Match") === '"release-1"')
          return new Response(null, { status: 304 });
        return Response.json(release, { headers: { ETag: '"release-1"' } });
      }
      assert.ok(url.pathname.endsWith("/commits/v0.1.1"));
      return Response.json({ sha: commit });
    },
  });
  assert.equal((await updater.status()).phase, "idle");
  const [a, b] = await Promise.all([updater.check(), updater.check()]);
  assert.equal(a.phase, "available");
  assert.deepEqual(a, b);
  assert.equal(requests, 2);
  assert.equal(a.release?.version, "0.1.1");
  await updater.check();
  assert.equal(requests, 2);
  time += 300000;
  await updater.check();
  assert.equal(requests, 3);
  time += 10000;
  await updater.check(true);
  assert.equal(requests, 4);
  assert.equal(starts.length, 0, "조회만으로 설치하면 안 된다");
  await assert.rejects(
    updater.install({ version: "0.1.1", commit: "b".repeat(40) }),
  );
  await updater.install({ version: "0.1.1", commit });
  assert.equal(starts.length, 1);
});

test("릴리스 없음·사전 배포·구버전·오류를 새 버전으로 잘못 안내하지 않는다", async () => {
  for (const [response, phase] of [
    [new Response(null, { status: 404 }), "unavailable"],
    [Response.json({ ...release, prerelease: true }), "unavailable"],
    [Response.json({ ...release, tag_name: "v0.0.9" }), "current"],
    [new Response(null, { status: 503 }), "error"],
  ] as const) {
    const updater = createAppUpdater({
      currentVersion: "0.1.0",
      supported: false,
      readJob: async () => null,
      start: async () => {
        throw new Error("개발 환경에서 설치 금지");
      },
      fetcher: async () => response,
    });
    const status = await updater.check();
    assert.equal(status.phase, phase);
    assert.equal(status.release, null);
    await assert.rejects(updater.install({ version: "0.1.1", commit }));
  }
});

test("GitHub 사용량 제한을 받으면 수동 확인도 지정한 시각까지 쉬고 새 버전 안내는 보존한다", async () => {
  let time = 1000;
  let requests = 0;
  const updater = createAppUpdater({
    currentVersion: "0.1.0",
    supported: true,
    now: () => time,
    readJob: async () => null,
    start: async () => {
      throw new Error("설치 안 함");
    },
    fetcher: async () => {
      requests++;
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "600" },
      });
    },
  });
  assert.equal((await updater.check()).phase, "error");
  time += 300000;
  await updater.check(true);
  assert.equal(requests, 1);
  time += 300000;
  await updater.check(true);
  assert.equal(requests, 2);
});

test("업데이트 HTTP 경로는 Jira 인증 없이 동작하고 외부 Origin의 설치 요청은 차단한다", async (t) => {
  const { createHttpServer } = await import("../src/server/http.ts");
  let starts = 0;
  const updater = createAppUpdater({
    currentVersion: "0.1.0",
    supported: true,
    readJob: async () => null,
    start: async (target) => {
      starts++;
      return {
        id: "job-http",
        version: target.version,
        phase: "preparing",
        startedAt: 1000,
        message: "준비 중",
      };
    },
    fetcher: async (input) =>
      String(input).endsWith("/releases/latest")
        ? Response.json(release)
        : Response.json({ sha: commit }),
  });
  const server = createHttpServer(
    () => {
      throw new Error("Jira를 조회하면 안 된다");
    },
    undefined,
    undefined,
    undefined,
    updater,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const post = (path: string, body: unknown, origin = base) =>
    fetch(base + path, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await fetch(`${base}/api/app-update/status`)).status, 200);
  assert.equal(
    (await post("/api/app-update/check", { force: true })).status,
    200,
  );
  assert.equal(
    (
      await post(
        "/api/app-update/install",
        { version: "0.1.1", commit },
        "https://attacker.example",
      )
    ).status,
    403,
  );
  assert.equal(starts, 0);
  assert.equal(
    (
      await post("/api/app-update/install", {
        version: "0.1.1",
        commit: "b".repeat(40),
      })
    ).status,
    409,
  );
  assert.equal(
    (await post("/api/app-update/install", { version: "0.1.1", commit }))
      .status,
    200,
  );
  assert.equal(starts, 1);
});

test("0.2.0 설치본은 재출발용 0.1.0 릴리스를 자동 다운그레이드하지 않는다", async () => {
  let starts = 0;
  const updater = createAppUpdater({
    currentVersion: "0.2.0",
    supported: true,
    readJob: async () => null,
    start: async () => {
      starts++;
      throw new Error("다운그레이드 금지");
    },
    fetcher: async () => Response.json({ ...release, tag_name: "v0.1.0" }),
  });
  const state = await updater.check();
  assert.equal(state.phase, "current");
  assert.equal(state.release, null);
  await assert.rejects(updater.install({ version: "0.1.0", commit }));
  assert.equal(starts, 0);
});

test("실행용 ZIP과 검증 정보가 없는 릴리스는 업데이트로 안내하지 않는다", async () => {
  const updater = createAppUpdater({
    currentVersion: "0.1.0",
    supported: true,
    readJob: async () => null,
    start: async () => {
      throw new Error("설치 금지");
    },
    fetcher: async (input) =>
      String(input).endsWith("/releases/latest")
        ? Response.json({ ...release, assets: [] })
        : Response.json({ sha: commit }),
  });
  assert.equal((await updater.check()).phase, "unavailable");
  assert.equal((await updater.status()).release, null);
});
