import type { LogEntry } from "../domain/log.ts";

/** 인증 헤더는 기록하지 않는다. 응답은 구독 중에만 최대 32 KiB까지 읽는다. */
export function loggedFetch(
  fetcher: typeof fetch,
  emit: (entry: LogEntry) => void,
  enabled: () => boolean = () => true,
): typeof fetch {
  let nextId = 0;
  return async (input, init) => {
    if (!enabled()) return fetcher(input, init);
    const url = new URL(String(input)),
      id = ++nextId,
      command = `${init?.method ?? "GET"} ${url.pathname}${url.search}`,
      time = new Date().toLocaleTimeString("ko-KR"),
      start = performance.now();
    const entry = { id, source: "API" as const, command, time };
    emit({ ...entry, result: "" });
    try {
      const response = await fetcher(input, init);
      const result = `${response.status} · ${Math.round(performance.now() - start)}ms`;
      emit({ ...entry, result });
      const type = response.headers.get("content-type") ?? "";
      if (/json|text\//i.test(type)) {
        const copy = response.clone();
        void preview(copy).then((body) => {
          if (enabled()) emit({ ...entry, result, response: body });
        });
      } else
        emit({
          ...entry,
          result,
          response:
            response.status === 204
              ? "응답 본문 없음"
              : `바이너리 응답 · ${type || "형식 미지정"}`,
        });
      return response;
    } catch (error) {
      emit({
        ...entry,
        result: `실패 · ${Math.round(performance.now() - start)}ms`,
        response: error instanceof Error ? error.message : "요청 실패",
      });
      throw error;
    }
  };
}
async function preview(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "응답 본문 없음";
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) return text + decoder.decode();
      const remaining = 32768 - size;
      text += decoder.decode(part.value.subarray(0, remaining), {
        stream: true,
      });
      size += part.value.length;
      if (size >= 32768) {
        void reader.cancel().catch(() => {});
        return `${text}${decoder.decode()}\n… 32 KiB까지만 표시합니다.`;
      }
    }
  } catch {
    return "응답 본문을 읽지 못했습니다.";
  } finally {
    reader.releaseLock();
  }
}
