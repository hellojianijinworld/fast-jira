import type { InstallationPlatform } from "./installation.ts";
import { record } from "./validation.ts";

const targets = [
  "domain",
  "codex",
  "claude",
  "codex-login",
  "claude-login",
] as const;
export type RepairTarget = (typeof targets)[number];
export interface RepairRequest {
  target: RepairTarget;
  consent?: true;
}
export interface RepairJob {
  id: string;
  target: RepairTarget;
  phase: "pending" | "running" | "complete" | "failed" | "interrupted";
  startedAt: number;
}
export function repairRequest(value: unknown): RepairRequest {
  const data = record(value);
  if (
    !targets.includes(data.target as RepairTarget) ||
    Object.keys(data).some((key) => !["target", "consent"].includes(key)) ||
    (data.target === "domain"
      ? data.consent !== true
      : data.consent !== undefined)
  )
    throw new Error("복구 대상과 동의를 확인해 주세요.");
  return {
    target: data.target as RepairTarget,
    ...(data.target === "domain" ? { consent: true } : {}),
  };
}
export function decodeRepairJob(value: unknown): RepairJob {
  const data = record(value);
  if (
    typeof data.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(data.id) ||
    !targets.includes(data.target as RepairTarget) ||
    !["pending", "running", "complete", "failed", "interrupted"].includes(
      String(data.phase),
    ) ||
    typeof data.startedAt !== "number" ||
    !Number.isSafeInteger(data.startedAt) ||
    data.startedAt < 0
  )
    throw new Error("복구 상태를 확인하지 못했어요.");
  return {
    id: data.id,
    target: data.target as RepairTarget,
    phase: data.phase as RepairJob["phase"],
    startedAt: data.startedAt,
  };
}
export function repairing(job: RepairJob | null | undefined) {
  return job?.phase === "pending" || job?.phase === "running";
}
export interface InstallationManagement {
  supported: boolean;
  url: string;
  domain: boolean;
  platforms: InstallationPlatform[];
  job: RepairJob | null;
}
export function decodeInstallationManagement(
  value: unknown,
): InstallationManagement {
  const data = record(value);
  if (
    typeof data.supported !== "boolean" ||
    typeof data.domain !== "boolean" ||
    typeof data.url !== "string" ||
    !/^(https:\/\/fast-jira\.local|http:\/\/localhost:[0-9]{1,5}|)$/.test(
      data.url,
    ) ||
    !Array.isArray(data.platforms) ||
    data.platforms.some((p) => p !== "codex" && p !== "claude")
  )
    throw new Error("설치 상태를 확인하지 못했어요.");
  return {
    supported: data.supported,
    url: data.url,
    domain: data.domain,
    platforms: data.platforms as InstallationPlatform[],
    job: data.job === null ? null : decodeRepairJob(data.job),
  };
}
