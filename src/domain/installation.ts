export type InstallationPlatform = "codex" | "claude";
export type InstallationState = "ready" | "waiting" | "failed" | "skipped";

// 안정된 코드와 안내만 공유하고 CLI 원문·인증 정보는 화면에 전달하지 않는다.
const steps = {
  runtime_pending: ["waiting", "실행 환경을 확인하고 있어요."],
  runtime_ready: ["ready", "전용 런타임을 확인했어요."],
  runtime_node_required: ["failed", "검증된 전용 Node를 준비해 주세요."],
  runtime_invalid: ["failed", "정식 릴리스의 실행 파일을 확인해 주세요."],
  runtime_unsupported: ["failed", "이 실행 환경은 지원하지 않아요."],
  web_pending: ["waiting", "앱 실행을 기다리고 있어요."],
  web_ready: ["ready", "앱을 사용할 수 있어요."],
  web_failed: ["failed", "앱 실행을 확인해 주세요."],
  plugin_pending: ["waiting", "플러그인 연결을 기다리고 있어요."],
  plugin_ready: ["ready", "플러그인을 등록했어요."],
  plugin_missing_cli: ["failed", "지정한 AI의 실행 파일을 확인해 주세요."],
  plugin_unsupported: [
    "failed",
    "AI CLI의 플러그인 지원 여부를 확인해 주세요.",
  ],
  plugin_failed: ["failed", "플러그인 등록을 다시 시도해 주세요."],
  mcp_pending: ["waiting", "MCP 연결 확인을 기다리고 있어요."],
  mcp_host_pending: [
    "waiting",
    "로컬 MCP에 연결했어요. AI에서 도구를 불러왔는지 확인해 주세요.",
  ],
  mcp_ready: ["ready", "MCP 연결을 확인했어요."],
  mcp_failed: ["failed", "MCP 연결을 확인해 주세요."],
  domain_skipped: ["skipped", "localhost로 사용할 수 있어요."],
  domain_ready: ["ready", "간편 주소를 사용할 수 있어요."],
  domain_failed: [
    "failed",
    "간편 주소에 연결하지 못했어요. localhost로 사용할 수 있어요.",
  ],
  assistant_pending: ["waiting", "앱의 AI 연결을 확인해 주세요."],
  assistant_ready: ["ready", "앱에서 AI와 대화할 수 있어요."],
  assistant_login_required: ["waiting", "AI 서비스의 로그인을 확인해 주세요."],
  assistant_unavailable: ["failed", "AI 연결을 확인해 주세요."],
  jira_pending: ["waiting", "앱에서 Jira 연결 정보를 입력해 주세요."],
  jira_ready: ["ready", "Jira 연결을 확인했어요."],
} as const satisfies Record<string, readonly [InstallationState, string]>;

type Stage =
  | "runtime"
  | "web"
  | "plugin"
  | "mcp"
  | "domain"
  | "assistant"
  | "jira";
type StageCodes = {
  [K in Stage]: Extract<keyof typeof steps, `${K}_${string}`>;
};
export interface InstallationStep<
  C extends keyof typeof steps = keyof typeof steps,
> {
  state: InstallationState;
  code: C;
  message: string;
}
function step<C extends keyof typeof steps>(code: C): InstallationStep<C> {
  const [state, message] = steps[code];
  return { state, code, message };
}

export function installationResult(
  platform: InstallationPlatform | undefined,
  codes: Partial<StageCodes> = {},
) {
  const report = {
    ...(platform ? { platform } : {}),
    runtime: step(codes.runtime ?? "runtime_pending"),
    web: step(codes.web ?? "web_pending"),
    plugin: step(codes.plugin ?? "plugin_pending"),
    mcp: step(codes.mcp ?? "mcp_pending"),
    domain: step(codes.domain ?? "domain_skipped"),
    assistant: step(codes.assistant ?? "assistant_pending"),
    jira: step(codes.jira ?? "jira_pending"),
  };
  return {
    ...report,
    appReady: report.runtime.state === "ready" && report.web.state === "ready",
  };
}
export type InstallationResult = ReturnType<typeof installationResult>;

export function installationPlatform(value: unknown): InstallationPlatform {
  if (value !== "codex" && value !== "claude")
    throw new Error("설치할 AI 플랫폼을 codex 또는 claude로 지정해 주세요.");
  return value;
}
