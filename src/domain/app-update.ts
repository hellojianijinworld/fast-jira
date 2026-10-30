import { PRODUCT_REPOSITORY } from "./product.ts";
import { record } from "./validation.ts";

export const UPDATE_INTERVAL = 5 * 60 * 1000;
export const UPDATE_REPOSITORY = PRODUCT_REPOSITORY;
export interface AppRelease {
  version: string;
  commit: string;
  notes: string;
  url: string;
}
export interface UpdateJob {
  id: string;
  version: string;
  phase: "preparing" | "installing" | "complete" | "failed";
  startedAt: number;
  message: string;
}
export interface AppUpdateStatus {
  currentVersion: string;
  supported: boolean;
  phase:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "unavailable"
    | "error";
  checkedAt: number | null;
  release: AppRelease | null;
  message: string;
  job: UpdateJob | null;
}
export function versionParts(value: string): number[] {
  if (!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    throw new Error("정식 버전 형식이 아닙니다.");
  const parts = value.replace(/^v/, "").split(".").map(Number);
  if (!parts.every(Number.isSafeInteger))
    throw new Error("버전 범위가 올바르지 않습니다.");
  return parts;
}
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a),
    right = versionParts(b);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}
export function decodeUpdateJob(value: unknown): UpdateJob {
  const data = record(value);
  if (
    typeof data.id !== "string" ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(data.id) ||
    typeof data.version !== "string" ||
    !["preparing", "installing", "complete", "failed"].includes(
      String(data.phase),
    ) ||
    typeof data.startedAt !== "number" ||
    !Number.isFinite(data.startedAt) ||
    typeof data.message !== "string"
  )
    throw new Error("업데이트 작업 정보가 올바르지 않습니다.");
  versionParts(data.version);
  return {
    id: data.id,
    version: data.version,
    phase: data.phase as UpdateJob["phase"],
    startedAt: data.startedAt,
    message: data.message,
  };
}
export function decodeUpdateStatus(value: unknown): AppUpdateStatus {
  const data = record(value);
  if (
    typeof data.currentVersion !== "string" ||
    typeof data.supported !== "boolean" ||
    typeof data.message !== "string" ||
    ![
      "idle",
      "checking",
      "current",
      "available",
      "unavailable",
      "error",
    ].includes(String(data.phase)) ||
    !(
      data.checkedAt === null ||
      (typeof data.checkedAt === "number" && Number.isFinite(data.checkedAt))
    )
  )
    throw new Error("업데이트 확인 정보가 올바르지 않습니다.");
  let release: AppRelease | null = null;
  if (data.release !== null) {
    const item = record(data.release);
    if (
      typeof item.version !== "string" ||
      typeof item.commit !== "string" ||
      !/^[a-f0-9]{40}$/.test(item.commit) ||
      typeof item.notes !== "string" ||
      typeof item.url !== "string" ||
      !item.url.startsWith(
        `https://github.com/${UPDATE_REPOSITORY}/releases/tag/`,
      )
    )
      throw new Error("배포 버전 정보가 올바르지 않습니다.");
    versionParts(item.version);
    release = {
      version: item.version,
      commit: item.commit,
      notes: item.notes,
      url: item.url,
    };
  }
  return {
    currentVersion: data.currentVersion,
    supported: data.supported,
    phase: data.phase as AppUpdateStatus["phase"],
    checkedAt: data.checkedAt as number | null,
    message: data.message,
    release,
    job: data.job === null ? null : decodeUpdateJob(data.job),
  };
}
export function updating(job: UpdateJob | null): boolean {
  return job?.phase === "preparing" || job?.phase === "installing";
}
