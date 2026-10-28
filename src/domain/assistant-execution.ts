import { isRecord } from "./validation.ts";

export interface AssistantExecution {
  tool: string;
  label: string;
  status: "applied" | "partiallyApplied" | "notApproved" | "failed";
  keys: string[];
  reason?: "feedback" | "paused" | "expired" | "cancelled";
  error?: string;
  requestId?: string;
}
export function decodeExecutions(value: unknown): AssistantExecution[] {
  if (!Array.isArray(value)) throw new Error("실행 결과를 확인하지 못했어요.");
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.tool !== "string" ||
      typeof item.label !== "string" ||
      !["applied", "partiallyApplied", "notApproved", "failed"].includes(
        String(item.status),
      ) ||
      !Array.isArray(item.keys) ||
      !item.keys.every(
        (key) => typeof key === "string" && /^[A-Z][A-Z0-9_]*-\d+$/.test(key),
      ) ||
      (item.reason !== undefined &&
        !["feedback", "paused", "expired", "cancelled"].includes(
          String(item.reason),
        )) ||
      (item.error !== undefined && typeof item.error !== "string") ||
      (item.requestId !== undefined && typeof item.requestId !== "string")
    )
      throw new Error("실행 결과가 올바르지 않아요.");
    return {
      tool: item.tool,
      label: item.label,
      status: item.status as AssistantExecution["status"],
      keys: item.keys as string[],
      ...(typeof item.reason === "string"
        ? { reason: item.reason as NonNullable<AssistantExecution["reason"]> }
        : {}),
      ...(typeof item.error === "string" ? { error: item.error } : {}),
      ...(typeof item.requestId === "string"
        ? { requestId: item.requestId }
        : {}),
    };
  });
}
/** 최종 실행 안내는 모델의 완료 주장 대신 호스트가 확인한 결과로 만든다. */
export function executionReport(
  items: readonly AssistantExecution[],
  site: string,
): string {
  return items
    .map((item) => {
      const state =
        item.status === "applied"
          ? "완료"
          : item.status === "partiallyApplied"
            ? "일부 완료"
            : item.status === "failed"
              ? "실패"
              : item.reason === "expired"
                ? "미실행 · 승인 시간이 지났어요"
                : item.reason === "cancelled"
                  ? "미실행 · 요청이 종료됐어요"
                  : item.reason === "feedback"
                    ? "미실행 · 의견을 받아 실행하지 않았어요"
                    : item.reason === "paused"
                      ? "미실행 · 앞선 의견을 먼저 확인해야 해요"
                      : "미실행 · 건너뛰었어요";
      const links = item.keys
        .map((key) => `[${key}](https://${site}/browse/${key})`)
        .join(", ");
      return `- **${state}** · ${item.label.replace(/[\r\n]/g, " ")}${links ? ` · ${links}` : ""}${item.error ? `\n  ${item.error}` : ""}`;
    })
    .join("\n");
}
