import type { Api } from "../client/api.ts";
import { actionButton, element, externalLink, uiIcon } from "./dom.ts";

/** 토큰은 전송 직후 비우며 브라우저 저장소에는 남기지 않는다. */
export function connectionForm(
  api: Pick<Api, "connection" | "saveConnection">,
  connected: () => void,
  { guided = false }: { guided?: boolean } = {},
) {
  const form = element("form", "connection-form");
  form.append(element("h3", "", guided ? "Jira 연결하기" : "Jira 연결 설정"));
  const progress = element("ol", "connection-progress");
  progress.setAttribute("aria-label", "연결 진행도");
  const steps = (guided ? ["기본 정보", "API 토큰", "연결 확인"] : []).map(
    (label, index) => {
      const item = element("li");
      const marker = element(
        "span",
        "connection-progress-marker",
        String(index + 1),
      );
      marker.setAttribute("aria-hidden", "true");
      item.append(marker, element("span", "", label));
      return item;
    },
  );
  progress.append(...steps);
  if (guided)
    form.append(
      element(
        "p",
        "connection-guide",
        "사용 중인 Jira를 연결하세요. 토큰은 이 컴퓨터에만 저장돼요.",
      ),
      progress,
    );
  const inputs = element("fieldset", "connection-fields");
  inputs.setAttribute("aria-label", "Jira 연결 정보");
  const fields = {
    site: element("input"),
    email: element("input"),
    token: element("input"),
  };
  const storedMask = "••••••••";
  let tokenConfigured = false;
  let phase: "editing" | "checking" | "failed" | "connected" = "editing";
  const busy = () => phase === "checking" || phase === "connected";
  fields.token.addEventListener("focus", () => {
    if (fields.token.value === storedMask) fields.token.value = "";
  });
  fields.token.addEventListener("blur", () => {
    if (!guided && !busy() && tokenConfigured && !fields.token.value)
      fields.token.value = storedMask;
  });
  const issueToken = externalLink(
    "https://id.atlassian.com/manage-profile/security/api-tokens",
    "",
    "button-link secondary connection-token-link",
  );
  issueToken.append(uiIcon("external-link"), element("span", "", "토큰 발급"));
  let returnFocus: AbortController | undefined;
  issueToken.addEventListener("click", (event) => {
    if (busy()) {
      event.preventDefault();
      return;
    }
    returnFocus?.abort();
    returnFocus = new AbortController();
    window.addEventListener(
      "focus",
      () => {
        if (form.isConnected && !busy()) fields.token.focus();
      },
      { once: true, signal: returnFocus.signal },
    );
  });
  for (const [key, label, placeholder, type] of [
    ["site", "Jira 사이트", "예: your-team.atlassian.net", "text"],
    ["email", "Atlassian 이메일", "you@example.com", "email"],
    ["token", "API 토큰", "발급한 토큰을 붙여넣으세요", "password"],
  ] as const) {
    const row = element("label", "connection-field");
    const heading = element("span", "connection-field-label", label);
    const input = fields[key];
    input.type = type;
    input.placeholder = placeholder;
    input.required = true;
    input.autocomplete =
      key === "token" ? "new-password" : key === "email" ? "email" : "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", label);
    row.append(heading, input);
    if (key === "token") {
      heading.append(issueToken);
      row.append(
        element(
          "small",
          "connection-guide",
          guided
            ? "권한 범위(scopes) 없는 토큰을 발급해 이곳에 붙여넣으세요. AI 채팅에 보내지 않아도 돼요."
            : "권한 범위(scopes) 없는 API 토큰을 사용해요. 연결 확인에 성공하면 이 컴퓨터에 저장하고 바로 적용해요.",
        ),
      );
    }
    inputs.append(row);
  }
  const feedback = element("p", "connection-feedback");
  feedback.setAttribute("role", "status");
  const save = actionButton(
    guided ? "연결하고 시작하기" : "연결 확인 및 저장",
    "check",
    "primary",
  );
  save.type = "submit";
  const saveLabel = save.querySelector("span");
  const actions = element("div", "connection-actions");
  actions.append(save);
  form.append(inputs, feedback, actions);
  function render() {
    inputs.disabled = busy();
    save.disabled = busy();
    save.setAttribute("aria-busy", String(phase === "checking"));
    issueToken.setAttribute("aria-disabled", String(busy()));
    issueToken.tabIndex = busy() ? -1 : 0;
    if (saveLabel)
      saveLabel.textContent =
        phase === "checking"
          ? "연결 확인 중…"
          : phase === "connected"
            ? "연결 완료"
            : guided
              ? "연결하고 시작하기"
              : "연결 확인 및 저장";
    const basicReady = Boolean(
      fields.site.value.trim() && fields.email.validity.valid,
    );
    const tokenReady =
      busy() ||
      Boolean(fields.token.value.trim() && fields.token.value !== storedMask);
    const current = !basicReady ? 0 : !tokenReady ? 1 : 2;
    steps.forEach((step, index) => {
      const complete =
        index === 0
          ? basicReady
          : index === 1
            ? tokenReady
            : phase === "connected";
      step.dataset.state = complete
        ? "complete"
        : index === 2 && phase === "failed"
          ? "error"
          : index === current
            ? "current"
            : "waiting";
      if (index === current && !complete)
        step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
      const marker = step.querySelector(".connection-progress-marker");
      if (complete) marker?.replaceChildren(uiIcon("check"));
      else
        marker?.replaceChildren(
          document.createTextNode(
            step.dataset.state === "error" ? "!" : String(index + 1),
          ),
        );
    });
  }
  form.addEventListener("input", () => {
    if (busy()) return;
    phase = "editing";
    feedback.textContent = "";
    feedback.classList.remove("error");
    render();
  });
  render();
  void api
    .connection()
    .then((settings) => {
      // 늦은 설정 응답으로 작성 중인 내용을 덮어쓰지 않는다.
      if (!fields.site.value) fields.site.value = settings.site;
      if (!fields.email.value) fields.email.value = settings.email;
      tokenConfigured = settings.tokenConfigured === true;
      if (
        !guided &&
        !busy() &&
        tokenConfigured &&
        !fields.token.value &&
        document.activeElement !== fields.token
      )
        fields.token.value = storedMask;
      render();
    })
    .catch(() => {});
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy() || !form.reportValidity()) return;
    if (fields.token.value === storedMask) {
      feedback.textContent = "변경할 새 API 토큰을 입력하세요.";
      fields.token.focus();
      return;
    }
    const credentials = {
      site: fields.site.value.trim(),
      email: fields.email.value.trim(),
      token: fields.token.value.trim(),
    };
    fields.token.value = "";
    phase = "checking";
    returnFocus?.abort();
    render();
    feedback.classList.remove("error");
    feedback.textContent = "Jira 연결을 확인하고 있어요…";
    void api
      .saveConnection(credentials)
      .then(() => {
        phase = "connected";
        render();
        feedback.textContent = "연결됐어요. 화면을 열고 있어요…";
        connected();
      })
      .catch((error: unknown) => {
        phase = "failed";
        render();
        feedback.classList.add("error");
        feedback.textContent =
          error instanceof Error
            ? error.message
            : "연결하지 못했어요. 설정을 확인해 주세요.";
      });
  });
  return form;
}
