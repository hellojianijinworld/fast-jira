import { appUpdate } from "../ui/app-update.ts";
import { connectionForm } from "../ui/connection.ts";
import { actionButton, element } from "../ui/dom.ts";
import { startTooltips } from "../ui/tooltip.ts";
import { createApi } from "./api.ts";
import { createApp } from "./app.ts";
import { createListCache } from "./list-cache.ts";
import { type LocalStore, readPreferences } from "./preferences.ts";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("앱 진입점이 없습니다.");
// 저장소 객체 자체의 접근이 차단돼도 각 설정 모듈의 복구 경로를 사용한다.
const storage: LocalStore = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};
document.documentElement.dataset.theme = readPreferences(storage).theme;
const updates = appUpdate(createApi());
async function start(root: HTMLElement) {
  const api = createApi();
  let failure: unknown;
  try {
    const settings = await api.connection();
    if (settings.tokenConfigured) {
      await createApp(root, api, storage, createListCache(), updates);
      return;
    }
  } catch (reason) {
    failure = reason;
  }
  const setup = element("section", "connection-setup");
  const head = element("div", "connection-setup-head");
  head.append(element("h1", "", "Fast Jira"));
  setup.append(head);
  if (failure)
    setup.append(
      element(
        "p",
        "error",
        failure instanceof Error
          ? failure.message
          : "Jira에 연결하지 못했어요.",
      ),
    );
  setup.append(
    connectionForm(
      api,
      () => {
        void start(root);
      },
      { guided: true },
    ),
  );
  if (failure) {
    const retry = actionButton("다시 연결", "refresh-cw");
    retry.addEventListener("click", () => {
      void start(root);
    });
    setup.append(retry);
  }
  const updateSettings = element("details", "connection-update-settings");
  updateSettings.append(element("summary", "", "업데이트"), updates.element);
  setup.append(updateSettings);
  root.replaceChildren(setup);
}

startTooltips();
void start(root);
