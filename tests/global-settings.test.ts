import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GLOBAL_SETTINGS_KEY,
  readGlobalSettings,
  updateGlobalSettings,
} from "../src/client/global-settings.ts";
import {
  readPreferences,
  writePreferences,
} from "../src/client/preferences.ts";

const store = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};
test("기존 표시 설정을 읽고 새 JSON에 Diff와 함께 보존한다", () => {
  const storage = store();
  storage.setItem("fastJira:theme", "dark");
  storage.setItem("fastJira:compactView", "true");
  storage.setItem("fastJira:compactDoneParents", "false");
  updateGlobalSettings(storage, { history: { diffLayout: "inline" } });
  assert.deepEqual(readPreferences(storage), {
    theme: "dark",
    compactView: true,
    compactDone: false,
    viewNamesExpanded: false,
  });
  const stored = JSON.parse(storage.getItem(GLOBAL_SETTINGS_KEY) ?? "null");
  assert.equal(stored.version, 1);
  assert.equal(stored.history.diffLayout, "inline");
  writePreferences(storage, { ...readPreferences(storage), theme: "system" });
  assert.equal(readGlobalSettings(storage).history.diffLayout, "inline");
  updateGlobalSettings(storage, { history: { diffLayout: "split" } });
  assert.equal(readPreferences(storage).theme, "system");
});
test("손상되거나 잘못된 설정은 필드별 기본값으로 복구한다", () => {
  const storage = store();
  storage.setItem("fastJira:theme", "dark");
  storage.setItem(GLOBAL_SETTINGS_KEY, "{broken");
  assert.equal(readPreferences(storage).theme, "dark");
  storage.setItem(
    GLOBAL_SETTINGS_KEY,
    JSON.stringify({
      version: 1,
      display: { theme: {}, compactView: "true", compactDone: null },
      history: { diffLayout: "invalid" },
    }),
  );
  assert.deepEqual(readGlobalSettings(storage), {
    version: 1,
    display: {
      theme: "dark",
      compactView: false,
      compactDone: true,
      viewNamesExpanded: false,
    },
    history: { diffLayout: "split" },
    layout: { assistantRatio: 0.34 },
  });
});

test("뷰 표시 설정은 전역 저장·복원을 거치며 Diff 설정과 다른 표시값을 보존한다", () => {
  const storage = store();
  updateGlobalSettings(storage, {
    display: { viewNamesExpanded: true },
    history: { diffLayout: "inline" },
  });
  assert.equal(readPreferences(storage).viewNamesExpanded, true);
  writePreferences(storage, { ...readPreferences(storage), theme: "dark" });
  assert.equal(readPreferences(storage).viewNamesExpanded, true);
  assert.equal(readGlobalSettings(storage).history.diffLayout, "inline");
});

test("AI 너비는 전역 레이아웃에 저장하고 다른 설정 변경과 잘못된 값에 안전하다", () => {
  const storage = store();
  updateGlobalSettings(storage, { layout: { assistantRatio: 0.62 } });
  updateGlobalSettings(storage, {
    history: { diffLayout: "inline" },
    display: { theme: "dark" },
  });
  assert.equal(readGlobalSettings(storage).layout.assistantRatio, 0.62);
  assert.equal(
    JSON.parse(storage.getItem(GLOBAL_SETTINGS_KEY) ?? "null").layout
      .assistantRatio,
    0.62,
  );
  for (const value of [-1, 0, 1, 2, "0.6", null]) {
    storage.setItem(
      GLOBAL_SETTINGS_KEY,
      JSON.stringify({ version: 1, layout: { assistantRatio: value } }),
    );
    assert.equal(readGlobalSettings(storage).layout.assistantRatio, 0.34);
  }
});
