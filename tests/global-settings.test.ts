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
