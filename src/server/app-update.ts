import {
  type AppRelease,
  type AppUpdateStatus,
  compareVersions,
  UPDATE_INTERVAL,
  UPDATE_REPOSITORY,
  type UpdateJob,
  updating,
} from "../domain/app-update.ts";
import { hasReleaseArtifacts } from "../domain/release-artifact.ts";
import { record } from "../domain/validation.ts";

export class AppUpdateError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
/** GitHub 확인은 로컬 서버 한 곳에서 공유한다. Jira 인증은 사용하지 않는다. */
export function createAppUpdater(options: {
  currentVersion: string;
  supported: boolean;
  fetcher?: typeof fetch;
  now?: () => number;
  readJob: () => Promise<UpdateJob | null>;
  start: (release: AppRelease) => Promise<UpdateJob>;
}) {
  const fetcher = options.fetcher ?? fetch,
    now = options.now ?? Date.now;
  let state: Omit<AppUpdateStatus, "job"> = {
    currentVersion: options.currentVersion,
    supported: options.supported,
    phase: "idle",
    checkedAt: null,
    release: null,
    message: "아직 업데이트를 확인하지 않았어요.",
  };
  let pending: Promise<AppUpdateStatus> | undefined;
  let installing = false,
    etag = "",
    retryAt = 0;
  const status = async (): Promise<AppUpdateStatus> => ({
    ...state,
    job: await options.readJob(),
  });
  async function check(force = false): Promise<AppUpdateStatus> {
    if (pending) return pending;
    const age = state.checkedAt === null ? Infinity : now() - state.checkedAt;
    if (now() < retryAt || age < (force ? 10000 : UPDATE_INTERVAL))
      return status();
    pending = inspect().finally(() => {
      pending = undefined;
    });
    return pending;
  }
  async function inspect(): Promise<AppUpdateStatus> {
    state = { ...state, phase: "checking" };
    try {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
      };
      if (etag) headers["If-None-Match"] = etag;
      const response = await fetcher(
        `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`,
        { headers, redirect: "error", signal: AbortSignal.timeout(10000) },
      );
      if (response.status === 403 || response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After"));
        const reset = Number(response.headers.get("X-RateLimit-Reset")) * 1000;
        retryAt = Math.max(
          now() + UPDATE_INTERVAL,
          now() + (Number.isFinite(seconds) ? seconds * 1000 : 0),
          Number.isFinite(reset) ? reset : 0,
        );
        throw new Error(
          "확인 요청이 많아 잠시 쉬고 있어요. 조금 뒤 다시 확인해 주세요.",
        );
      }
      if (response.status === 304) {
        state = {
          ...state,
          phase: state.release ? "available" : "current",
          message: state.release
            ? "새 버전을 설치할 수 있어요."
            : "최신 버전을 사용하고 있어요.",
        };
      } else if (response.status === 404) {
        etag = "";
        state = {
          ...state,
          phase: "unavailable",
          release: null,
          message: "아직 확인할 수 있는 공개 릴리스가 없어요.",
        };
      } else {
        if (!response.ok)
          throw new Error(
            "GitHub에 연결하지 못했어요. 잠시 후 다시 확인해 주세요.",
          );
        const data = record(await response.json());
        if (data.draft !== false || data.prerelease !== false) {
          etag = "";
          state = {
            ...state,
            phase: "unavailable",
            release: null,
            message: "아직 정식 배포된 업데이트가 없어요.",
          };
        } else {
          if (typeof data.tag_name !== "string")
            throw new Error("배포 버전 정보를 확인하지 못했어요.");
          const version = data.tag_name.replace(/^v/, "");
          if (compareVersions(version, options.currentVersion) > 0) {
            if (!hasReleaseArtifacts(data.assets, version)) {
              state = {
                ...state,
                phase: "unavailable",
                release: null,
                message: "아직 실행용 배포 파일이 준비되지 않았어요.",
              };
              state.checkedAt = now();
              return status();
            }
            const pinned = await fetcher(
              `https://api.github.com/repos/${UPDATE_REPOSITORY}/commits/${encodeURIComponent(data.tag_name)}`,
              {
                headers: { Accept: "application/vnd.github+json" },
                redirect: "error",
                signal: AbortSignal.timeout(10000),
              },
            );
            if (!pinned.ok)
              throw new Error("배포 파일의 기준 코드를 확인하지 못했어요.");
            const sha = record(await pinned.json()).sha;
            if (typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha))
              throw new Error("배포 코드 정보가 올바르지 않습니다.");
            state = {
              ...state,
              phase: "available",
              release: {
                version,
                commit: sha,
                notes:
                  typeof data.body === "string"
                    ? data.body.slice(0, 12000)
                    : "",
                url: `https://github.com/${UPDATE_REPOSITORY}/releases/tag/${encodeURIComponent(data.tag_name)}`,
              },
              message: "새 버전을 설치할 수 있어요.",
            };
          } else
            state = {
              ...state,
              phase: "current",
              release: null,
              message: "최신 버전을 사용하고 있어요.",
            };
          etag = response.headers.get("ETag") ?? "";
        }
      }
      retryAt = 0;
    } catch (error) {
      state = {
        ...state,
        phase: "error",
        message:
          error instanceof Error && error.message.startsWith("확인 요청이")
            ? error.message
            : "업데이트를 확인하지 못했어요. 네트워크나 저장소 접근 권한을 확인해 주세요.",
      };
      retryAt = Math.max(retryAt, now() + UPDATE_INTERVAL);
    }
    state = { ...state, checkedAt: now() };
    return status();
  }
  async function install(input: unknown): Promise<AppUpdateStatus> {
    if (!options.supported)
      throw new AppUpdateError(
        "설치된 Fast Jira 서비스에서 업데이트할 수 있어요. 소스 실행은 Managing 가이드를 이용해 주세요.",
        409,
      );
    if (installing)
      throw new AppUpdateError("이미 업데이트를 진행하고 있어요.", 409);
    installing = true;
    try {
      if (updating(await options.readJob()))
        throw new AppUpdateError("이미 업데이트를 진행하고 있어요.", 409);
      const data = record(input),
        target = state.release;
      if (
        !target ||
        data.version !== target.version ||
        data.commit !== target.commit ||
        state.phase !== "available"
      )
        throw new AppUpdateError(
          "업데이트를 다시 확인한 뒤 표시된 버전을 선택해 주세요.",
          409,
        );
      const job = await options.start(target);
      return { ...state, job };
    } finally {
      installing = false;
    }
  }
  return { status, check, install };
}
export type AppUpdater = ReturnType<typeof createAppUpdater>;
