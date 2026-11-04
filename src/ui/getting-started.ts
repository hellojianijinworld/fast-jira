import { actionButton, element } from "./dom.ts";

/** 시작 안내는 기존 설정 화면으로 연결하고 목록 사용을 막지 않는다. */
export function gettingStarted(actions: {
  view: () => void;
  display: () => void;
  finish: () => void;
}) {
  const root = element("section", "getting-started");
  root.setAttribute("aria-label", "처음 사용 안내");
  const head = element("div", "getting-started-head");
  head.append(element("h2", "", "Jira가 연결됐어요"));
  const finish = actionButton("시작하기", "check", { size: "sm" });
  finish.addEventListener("click", actions.finish);
  head.append(finish);
  const steps = element("ol", "getting-started-steps");
  for (const [label, icon, description, run] of [
    [
      "뷰 설정",
      "layers",
      "프로젝트와 작업 조건을 한 번에 골라요.",
      actions.view,
    ],
    [
      "화면 표시",
      "settings",
      "테마와 제목 표시를 골라요. 나중에 바꿔도 돼요.",
      actions.display,
    ],
  ] as const) {
    const step = element("li", "getting-started-step");
    const button = actionButton(label, icon, {
      size: "sm",
      variant: "outline",
    });
    button.addEventListener("click", run);
    step.append(button, element("small", "", description));
    steps.append(step);
  }
  root.append(head, steps);
  return root;
}
