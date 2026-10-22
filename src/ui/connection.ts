import type { Api } from "../client/api.ts";
import { actionButton, element, externalLink } from "./dom.ts";

/** 토큰은 입력·전송 후 비우며 브라우저 저장소에는 남기지 않는다. */
export function connectionForm(api: Api, connected: () => void) {
  const form = element("form", "connection-form");
  form.append(element("h3", "", "Jira 연결 설정"));
  const guide = element("section", "connection-guide");
  guide.append(
    element(
      "p",
      "",
      "처음 연결하거나 토큰이 만료됐다면 새 API 토큰을 발급받아 주세요.",
    ),
  );
  const steps = element("ol");
  const first = element("li");
  first.append(
    externalLink(
      "https://id.atlassian.com/manage-profile/security/api-tokens",
      "Atlassian API 토큰 발급 페이지 열기",
    ),
    document.createTextNode(" → 본인 계정으로 로그인하세요."),
  );
  steps.append(
    first,
    element(
      "li",
      "",
      "Create API token을 선택하고 이름(Fast Jira)과 만료일을 정해 만드세요. 이 앱은 scopes 없는 토큰을 사용해요.",
    ),
    element(
      "li",
      "",
      "표시된 토큰을 복사해 아래에 입력하고 연결 확인 및 저장을 누르세요. 발급 화면을 닫으면 토큰을 다시 볼 수 없어요.",
    ),
  );
  guide.append(steps);
  form.append(guide);
  const fields = {
    site: element("input"),
    email: element("input"),
    token: element("input"),
  };
  for (const [key, label, placeholder, type] of [
    ["site", "Jira 사이트", "your-site.atlassian.net", "text"],
    ["email", "Atlassian 이메일", "you@example.com", "email"],
    ["token", "새 API 토큰", "발급받은 토큰을 입력하세요", "password"],
  ] as const) {
    const row = element("label", "connection-field", label);
    const input = fields[key];
    input.type = type;
    input.placeholder = placeholder;
    input.required = true;
    input.autocomplete =
      key === "token" ? "new-password" : key === "email" ? "email" : "off";
    input.spellcheck = false;
    row.append(input);
    form.append(row);
  }
  const feedback = element("p", "connection-feedback");
  feedback.setAttribute("role", "status");
  const save = actionButton("연결 확인 및 저장", "check", "primary");
  save.type = "submit";
  const actions = element("div", "connection-actions");
  actions.append(save);
  form.append(
    element(
      "p",
      "connection-guide",
      "연결에 성공한 정보만 이 컴퓨터의 .env에 저장돼요. 새 토큰은 서버 재시작 없이 적용돼요.",
    ),
    feedback,
    actions,
  );
  void api
    .connection()
    .then((settings) => {
      // 설정 응답을 기다리는 동안 사용자가 입력한 값은 보존한다.
      if (!fields.site.value) fields.site.value = settings.site;
      if (!fields.email.value) fields.email.value = settings.email;
    })
    .catch(() => {});
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (save.disabled || !form.reportValidity()) return;
    save.disabled = true;
    feedback.classList.remove("error");
    feedback.textContent = "Jira 연결을 확인하고 있어요…";
    void api
      .saveConnection({
        site: fields.site.value.trim(),
        email: fields.email.value.trim(),
        token: fields.token.value.trim(),
      })
      .then(() => {
        fields.token.value = "";
        feedback.textContent = "연결됐어요. 화면을 열고 있어요…";
        connected();
      })
      .catch((error: unknown) => {
        fields.token.value = "";
        feedback.classList.add("error");
        feedback.textContent =
          error instanceof Error
            ? error.message
            : "연결하지 못했어요. 설정을 확인해 주세요.";
      })
      .finally(() => {
        save.disabled = false;
      });
  });
  return form;
}
