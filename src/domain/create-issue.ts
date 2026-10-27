import type { JsonValue } from "./adf.ts";
import { isRecord, record, requiredString } from "./validation.ts";
export interface CreateField {
  id: string;
  name: string;
  required: boolean;
  type: string;
  items: string;
  allowed: { id: string; name: string }[];
  defaultValue?: JsonValue;
}
export interface CreateMetadata {
  project: string;
  type: string;
  level: number | null;
  fields: CreateField[];
}
export interface IssueDraft {
  project: string;
  type: string;
  parent: string;
  fields: Record<string, JsonValue>;
}
export function issueDraft(value: unknown): IssueDraft {
  const data = record(value);
  const project = requiredString(data.project, "프로젝트");
  const type = requiredString(data.type, "유형");
  if (!/^[A-Z][A-Z0-9_]*$/.test(project) || !/^\d{1,20}$/.test(type))
    throw new Error("프로젝트와 유형을 확인하세요.");
  const parent = data.parent ?? "";
  if (
    typeof parent !== "string" ||
    (parent && !/^[A-Z][A-Z0-9_]*-\d+$/.test(parent))
  )
    throw new Error("상위 이슈를 확인하세요.");
  if (!isRecord(data.fields) || JSON.stringify(data.fields).length > 100000)
    throw new Error("생성 필드 형식을 확인하세요.");
  // JSON 경계에서만 사용한다. 필드별 저장 가능 여부는 Jira 생성 메타정보로 검증한다.
  return {
    project,
    type,
    parent,
    fields: data.fields as Record<string, JsonValue>,
  };
}
export function createMetadata(value: unknown): CreateMetadata {
  const data = record(value);
  if (!Array.isArray(data.fields)) throw new Error("생성 필드를 확인하세요.");
  return {
    project: requiredString(data.project, "프로젝트"),
    type: requiredString(data.type, "유형"),
    level: typeof data.level === "number" ? data.level : null,
    fields: data.fields.map((value) => {
      const field = record(value);
      if (!Array.isArray(field.allowed) || typeof field.required !== "boolean")
        throw new Error("생성 필드를 확인하세요.");
      return {
        id: requiredString(field.id, "필드"),
        name: requiredString(field.name, "필드 이름"),
        required: field.required,
        type: requiredString(field.type, "필드 유형"),
        items: typeof field.items === "string" ? field.items : "",
        allowed: field.allowed.map((value) => {
          const item = record(value);
          return {
            id: requiredString(item.id, "선택 값"),
            name: requiredString(item.name, "선택 이름"),
          };
        }),
        ...(field.defaultValue === undefined
          ? {}
          : { defaultValue: field.defaultValue as JsonValue }),
      };
    }),
  };
}
