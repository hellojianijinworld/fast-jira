import { connectionForm } from "../ui/connection.ts";
import { actionButton, element } from "../ui/dom.ts";
import { createApi } from "./api.ts";
import { createApp } from "./app.ts";
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
async function start(root: HTMLElement) {
  const api = createApi();
  try {
    await createApp(root, api, storage);
  } catch (reason) {
    const retry = actionButton("다시 연결", "refresh-cw");
    retry.addEventListener("click", () => {
      void start(root);
    });
    const setup = element("section", "connection-setup");
    setup.append(
      element("h1", "", "Fast Jira"),
      element(
        "p",
        "error",
        reason instanceof Error ? reason.message : "Jira에 연결하지 못했어요.",
      ),
      connectionForm(api, () => {
        void start(root);
      }),
      retry,
    );
    root.replaceChildren(setup);
  }
}
void start(root);
