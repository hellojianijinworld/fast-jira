import type { Api } from "../client/api.ts";
import { actionButton, element, externalLink } from "./dom.ts";

/** 토큰은 입력·전송 후 비우며 브라우저 저장소에는 남기지 않는다. */
export function connectionForm(
  api: Pick<Api, "connection" | "saveConnection">,
  connected: () => void,
) {
  const form = element("form", "connection-form");
  form.append(element("h3", "", "Jira 연결 설정"));
  const fields = {
    site: element("input"),
    email: element("input"),
    token: element("input"),
  };
  const storedMask = "••••••••";
  let tokenConfigured = false;
  fields.token.addEventListener("focus", () => {
    if (fields.token.value === storedMask) fields.token.value = "";
  });
  fields.token.addEventListener("blur", () => {
    if (tokenConfigured && !fields.token.value) fields.token.value = storedMask;
  });
  for (const [key, label, placeholder, type] of [
    ["site", "Jira 사이트", "예: your-team.atlassian.net", "text"],
    ["email", "Atlassian 이메일", "you@example.com", "email"],
    [
      "token",
      "API 토큰",
      "발급받은 토큰을 붙여넣으세요 (예: ATATT…)",
      "password",
    ],
  ] as const) {
    const row = element("label", "connection-field");
    const heading = element("span", "connection-field-label", label);
    if (key === "token")
      heading.append(
        externalLink(
          "https://id.atlassian.com/manage-profile/security/api-tokens",
          "토큰 발급 ↗",
        ),
      );
    row.append(heading);
    const input = fields[key];
    input.type = type;
    input.placeholder = placeholder;
    input.required = true;
    input.autocomplete =
      key === "token" ? "new-password" : key === "email" ? "email" : "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", label);
    row.append(input);
    if (key === "token")
      row.append(
        element(
          "small",
          "connection-guide",
          "권한 범위(scopes) 없는 API 토큰을 사용해요. 연결 확인에 성공하면 이 컴퓨터에 저장하고 바로 적용해요.",
        ),
      );
    form.append(row);
  }
  const feedback = element("p", "connection-feedback");
  feedback.setAttribute("role", "status");
  const save = actionButton("연결 확인 및 저장", "check", "primary");
  save.type = "submit";
  const actions = element("div", "connection-actions");
  actions.append(save);
  form.append(feedback, actions);
  void api
    .connection()
    .then((settings) => {
      // 설정 응답을 기다리는 동안 사용자가 입력한 값은 보존한다.
      if (!fields.site.value) fields.site.value = settings.site;
      if (!fields.email.value) fields.email.value = settings.email;
      tokenConfigured = settings.tokenConfigured === true;
      if (
        tokenConfigured &&
        !fields.token.value &&
        document.activeElement !== fields.token
      )
        fields.token.value = storedMask;
    })
    .catch(() => {});
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (save.disabled) return;
    if (fields.token.value === storedMask) {
      feedback.textContent = "변경할 새 API 토큰을 입력하세요.";
      fields.token.focus();
      return;
    }
    if (!form.reportValidity()) return;
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
