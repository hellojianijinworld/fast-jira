import assert from "node:assert/strict";
import { test } from "node:test";
import { installationResult } from "../src/domain/installation.ts";

test("플러그인 실패는 정상 웹을 실패로 바꾸거나 Jira 연결 성공으로 보고하지 않는다", () => {
  const report = installationResult("codex", {
    runtime: "runtime_ready",
    web: "web_ready",
    plugin: "plugin_failed",
  });
  assert.equal(report.appReady, true);
  assert.equal(report.web.state, "ready");
  assert.equal(report.plugin.state, "failed");
  assert.equal(report.mcp.state, "waiting");
  assert.equal(report.assistant.state, "waiting");
  assert.equal(report.jira.state, "waiting");
  assert.equal(report.domain.state, "skipped");
});

test("로컬 MCP 검사 성공과 호스트 도구 발견 대기는 별도 코드로 남는다", () => {
  const report = installationResult("claude", {
    plugin: "plugin_ready",
    mcp: "mcp_host_pending",
  });
  assert.equal(report.plugin.state, "ready");
  assert.equal(report.mcp.state, "waiting");
  assert.equal(report.mcp.code, "mcp_host_pending");
  assert.equal(report.appReady, false);
});

test("Node와 배포본 실패는 명확한 코드로 보고되고 도메인은 웹 성공을 대신하지 않는다", () => {
  for (const code of ["runtime_node_required", "runtime_invalid"] as const) {
    const report = installationResult(undefined, {
      runtime: code,
      domain: "domain_ready",
    });
    assert.equal(report.appReady, false);
    assert.equal(report.runtime.state, "failed");
    assert.equal(report.runtime.code, code);
    assert.equal(report.web.state, "waiting");
    assert.equal(report.domain.state, "ready");
  }
});
