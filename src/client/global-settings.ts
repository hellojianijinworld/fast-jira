import { isRecord } from "../domain/validation.ts";
import type { LocalStore, Preferences } from "./preferences.ts";

export const GLOBAL_SETTINGS_KEY = "fastJira:settings";
export interface GlobalSettings {
  version: 1;
  display: Preferences;
  history: { diffLayout: "split" | "inline" };
}
/** DOM을 읽지 않는 브라우저 저장소 어댑터. 접근 제한은 각 읽기·쓰기에서 처리한다. */
export const browserSettingsStorage: LocalStore = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};
export function readGlobalSettings(storage: LocalStore): GlobalSettings {
  const defaults: GlobalSettings = {
    version: 1,
    display: {
      theme: "light",
      compactView: false,
      compactDone: true,
      viewNamesExpanded: false,
    },
    history: { diffLayout: "split" },
  };
  try {
    const legacyTheme = storage.getItem("fastJira:theme");
    const legacy: Preferences = {
      viewNamesExpanded: false,
      theme:
        legacyTheme === "dark" || legacyTheme === "system"
          ? legacyTheme
          : "light",
      compactView: storage.getItem("fastJira:compactView") === "true",
      compactDone:
        (storage.getItem("fastJira:compactDone") ??
          storage.getItem("fastJira:compactDoneParents")) !== "false",
    };
    let value: unknown;
    try {
      value = JSON.parse(storage.getItem(GLOBAL_SETTINGS_KEY) ?? "null");
    } catch {
      value = null;
    }
    if (!isRecord(value) || value.version !== 1)
      return { ...defaults, display: legacy };
    const display = isRecord(value.display) ? value.display : {};
    const history = isRecord(value.history) ? value.history : {};
    return {
      version: 1,
      display: {
        viewNamesExpanded: display.viewNamesExpanded === true,
        theme:
          display.theme === "light" ||
          display.theme === "dark" ||
          display.theme === "system"
            ? display.theme
            : legacy.theme,
        compactView:
          typeof display.compactView === "boolean"
            ? display.compactView
            : legacy.compactView,
        compactDone:
          typeof display.compactDone === "boolean"
            ? display.compactDone
            : legacy.compactDone,
      },
      history: {
        diffLayout: history.diffLayout === "inline" ? "inline" : "split",
      },
    };
  } catch {
    return defaults;
  }
}
/** 섹션을 읽어 병합하므로 표시 옵션 저장이 최근 변경한 Diff 설정을 덮지 않는다. */
export function updateGlobalSettings(
  storage: LocalStore,
  patch: {
    display?: Partial<Preferences>;
    history?: Partial<GlobalSettings["history"]>;
  },
) {
  const current = readGlobalSettings(storage);
  const next: GlobalSettings = {
    version: 1,
    display: { ...current.display, ...patch.display },
    history: { ...current.history, ...patch.history },
  };
  storage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(next));
  return next;
}
