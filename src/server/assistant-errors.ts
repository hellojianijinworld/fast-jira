export class AssistantUnavailableError extends Error {
  constructor(
    readonly reason: "missing_cli" | "login_required" | "unsupported",
    message: string,
  ) {
    super(message);
  }
}
export function assistantFailure(error: unknown) {
  return error instanceof AssistantUnavailableError
    ? {
        availability: "unavailable" as const,
        reason: error.reason,
        error: error.message,
      }
    : {
        availability: "unknown" as const,
        error: "AI 연결을 확인하지 못했어요. 다시 시도해 주세요.",
      };
}
