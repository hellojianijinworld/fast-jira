import assert from "node:assert/strict";
import { test } from "node:test";
import { providerGuidance } from "../src/ui/installation-guidance.ts";

const checked = { checking: false, checked: true };
test("AI 연결 안내는 로그인·실행 파일·미지원·알 수 없음을 구분한다", () => {
  for (const reason of [
    "login_required",
    "missing_cli",
    "unsupported",
  ] as const) {
    const result = providerGuidance(
      { id: "codex", ready: false, error: "private secret", reason },
      checked,
    );
    assert.equal(result.state, reason);
    assert(!result.detail.includes("private secret"));
    assert(
      result.detail.includes(
        reason === "login_required" ? "로그인 버튼" : "사용 중인 AI",
      ),
    );
  }
  const unknown = providerGuidance(undefined, checked);
  assert.equal(unknown.state, "unknown");
  assert(unknown.detail.includes("확인하지 못했어요"));
  assert(!unknown.detail.includes("설치되어 있지"));
});
test("재확인은 확인된 상태를 지우지 않고 최초 확인 중 상태와 구분한다", () => {
  assert.equal(
    providerGuidance(
      { id: "codex", ready: true, error: "" },
      { checked: true, checking: true },
    ).state,
    "ready",
  );
  assert.equal(
    providerGuidance(undefined, { checked: false, checking: true }).state,
    "checking",
  );
  assert.equal(
    providerGuidance(undefined, { checked: false, checking: false }).state,
    "unchecked",
  );
});
