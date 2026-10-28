import type { JsonValue } from "./adf.ts";
import { isRecord, record } from "./validation.ts";

export interface ApprovalField {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "json";
  required: boolean;
  options?: string[];
  description?: string;
}
export interface AssistantApproval {
  id: string;
  title: string;
  description: string;
  details: string;
  fields: ApprovalField[];
  url?: string;
}
export interface ApprovalDecision {
  approved: boolean;
  values: Record<string, JsonValue>;
}
export type ApprovalHandler = (
  request: Omit<AssistantApproval, "id">,
) => Promise<ApprovalDecision>;
export const approvalRunId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value))
    throw new Error("AI 요청 식별자를 확인하세요.");
  return value;
};
export function approvalFields(value: unknown): ApprovalField[] {
  const schema = isRecord(value) ? value : {};
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return Object.entries(properties).map(([key, value]) => {
    const field = isRecord(value) ? value : {};
    return {
      key,
      label:
        typeof field.title === "string"
          ? field.title
          : typeof field.description === "string"
            ? field.description
            : key,
      type:
        field.type === "boolean"
          ? "boolean"
          : field.type === "number" || field.type === "integer"
            ? "number"
            : field.type === "object" || field.type === "array"
              ? "json"
              : "text",
      ...(typeof field.description === "string"
        ? { description: field.description }
        : {}),
      required: Array.isArray(schema.required) && schema.required.includes(key),
      ...(Array.isArray(field.enum) &&
      field.enum.every((item) => typeof item === "string")
        ? { options: field.enum }
        : {}),
    };
  });
}
export function decodeApprovals(value: unknown): AssistantApproval[] {
  if (!Array.isArray(value)) throw new Error("승인 요청을 확인하지 못했어요.");
  return value.map((item) => {
    const data = record(item);
    if (
      typeof data.id !== "string" ||
      typeof data.title !== "string" ||
      typeof data.description !== "string" ||
      typeof data.details !== "string" ||
      !Array.isArray(data.fields)
    )
      throw new Error("승인 요청이 올바르지 않습니다.");
    const fields = data.fields.map((item): ApprovalField => {
      const field = record(item);
      if (
        typeof field.key !== "string" ||
        typeof field.label !== "string" ||
        !["text", "number", "boolean", "json"].includes(String(field.type)) ||
        typeof field.required !== "boolean" ||
        (field.options !== undefined &&
          (!Array.isArray(field.options) ||
            !field.options.every((item) => typeof item === "string")))
      )
        throw new Error("승인 입력 항목을 확인하세요.");
      return {
        key: field.key,
        label: field.label,
        type: field.type as ApprovalField["type"],
        required: field.required,
        ...(typeof field.description === "string"
          ? { description: field.description }
          : {}),
        ...(field.options === undefined
          ? {}
          : { options: field.options as string[] }),
      };
    });
    return {
      id: data.id,
      title: data.title,
      description: data.description,
      details: data.details,
      fields,
      ...(typeof data.url === "string" ? { url: data.url } : {}),
    };
  });
}
