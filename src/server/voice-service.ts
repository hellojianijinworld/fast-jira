import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { isRecord, record } from "../domain/validation.ts";
import {
  type CodexClient,
  codexToolIsolation,
  startCodex,
} from "./codex-client.ts";
import { JiraError } from "./jira-client.ts";
export interface VoiceEvent {
  text: string;
  error: string;
  ended: boolean;
}
async function connectVoice(): Promise<CodexClient> {
  let binary = process.env.FAST_JIRA_CODEX_BIN;
  if (!binary && process.platform === "darwin") {
    for (const path of [
      "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
      "/Applications/Codex.app/Contents/Resources/codex",
    ]) {
      try {
        await access(path);
        binary = path;
        break;
      } catch {
        /* CLI 설치 위치로 돌아간다. */
      }
    }
  }
  return startCodex(undefined, {
    ...(binary ? { binary } : {}),
    chatgpt: true,
  });
}
/** OAuth 토큰은 Codex가 관리한다. 서버는 SDP 협상과 전사 이벤트만 전달한다. */
export function createVoiceService(
  connect: () => Promise<CodexClient> = connectVoice,
) {
  type Session = {
    id: string;
    client?: CodexClient;
    threadId: string;
    state: VoiceEvent;
    listeners: Set<(event: VoiceEvent) => void>;
    close: () => void;
  };
  let active: Session | undefined;
  let disposed = false;
  async function start(value: unknown, signal?: AbortSignal) {
    const input = record(value);
    if (
      typeof input.sdp !== "string" ||
      input.sdp.length > 50000 ||
      !input.sdp.startsWith("v=0")
    )
      throw new JiraError("음성 연결 정보를 확인하세요.", 400);
    if (disposed) throw new JiraError("음성 서비스가 종료됐어요.", 503);
    if (active)
      throw new JiraError("진행 중인 음성 입력을 먼저 종료하세요.", 409);
    if (signal?.aborted) throw new Error("음성 연결을 취소했어요.");
    const session: Session = {
      id: randomUUID(),
      threadId: "",
      state: { text: "", error: "", ended: false },
      listeners: new Set<(event: VoiceEvent) => void>(),
      close: () => {},
    };
    active = session;
    let unlisten = () => {},
      deadline: ReturnType<typeof setTimeout> | undefined;
    let resolveSdp: (sdp: string) => void = () => {},
      rejectSdp: (error: Error) => void = () => {};
    const emit = () => {
      for (const listener of session.listeners) listener(session.state);
    };
    session.close = () => {
      if (session.state.ended) return;
      session.state.ended = true;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      unlisten();
      rejectSdp(new Error("음성 연결이 종료됐어요."));
      session.client?.close();
      if (active === session) active = undefined;
      emit();
      session.listeners.clear();
    };
    const abort = () => session.close();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const client = await connect();
      session.client = client;
      if (session.state.ended) {
        client.close();
        throw new Error("음성 연결을 취소했어요.");
      }
      const account = record(
        await client.request("account/read", { refreshToken: false }),
      );
      if (record(account.account).type !== "chatgpt")
        throw new Error(
          "음성 입력은 Codex의 ChatGPT 로그인으로 연결해 주세요.",
        );
      const started = record(
        await client.request("thread/start", {
          config: await codexToolIsolation(client),
          ephemeral: true,
          sandbox: "read-only",
          approvalPolicy: "never",
          selectedCapabilityRoots: [],
          environments: [],
          baseInstructions:
            "This is voice transcription only. Do not call tools or take actions.",
        }),
      );
      session.threadId = String(record(started.thread).id ?? "");
      if (!session.threadId) throw new Error("음성 대화를 시작하지 못했어요.");
      const sdp = new Promise<string>((resolve, reject) => {
        resolveSdp = resolve;
        rejectSdp = reject;
      });
      // 전사 연결이 먼저 실패해도 대기 중인 SDP promise를 처리한다.
      void sdp.catch(() => {});
      let completed = "",
        partial = "";
      unlisten = client.listen((message) => {
        if (message.method === "connection/closed") {
          session.state.error = "Codex 음성 연결이 끊겼어요.";
          session.close();
          return;
        }
        const params = isRecord(message.params) ? message.params : {};
        if (params.threadId !== session.threadId) return;
        if (
          message.method === "thread/realtime/sdp" &&
          typeof params.sdp === "string"
        )
          resolveSdp(params.sdp);
        else if (message.method === "thread/realtime/error") {
          session.state.error =
            typeof params.message === "string"
              ? params.message
              : "음성 연결에 실패했어요.";
          session.close();
        } else if (message.method === "thread/realtime/closed") session.close();
        else if (params.role === "user") {
          if (
            message.method === "thread/realtime/transcript/delta" &&
            typeof params.delta === "string"
          )
            partial += params.delta;
          else if (
            message.method === "thread/realtime/transcript/done" &&
            typeof params.text === "string"
          ) {
            completed += `${completed ? " " : ""}${params.text}`;
            partial = "";
          } else return;
          session.state.text =
            `${completed}${completed && partial ? " " : ""}${partial}`.slice(
              0,
              10000,
            );
          emit();
        }
      });
      deadline = setTimeout(() => {
        session.state.error = "음성 연결 시간이 초과됐어요.";
        session.close();
      }, 25000);
      await client.request("thread/realtime/start", {
        threadId: session.threadId,
        version: "v3",
        transport: { type: "webrtc", sdp: input.sdp },
        outputModality: "audio",
        includeStartupContext: false,
        clientManagedHandoffs: true,
        prompt:
          "Transcribe the user's speech accurately in its original language. Do not call tools or take actions.",
      });
      const answer = await sdp;
      if (session.state.ended) throw new Error("음성 연결이 종료됐어요.");
      clearTimeout(deadline);
      deadline = setTimeout(() => {
        session.state.error = "음성 입력은 한 번에 3분까지 사용할 수 있어요.";
        session.close();
      }, 180000);
      signal?.removeEventListener("abort", abort);
      return { id: session.id, sdp: answer };
    } catch (error) {
      session.close();
      if (error instanceof Error && /unknown variant.*v3/.test(error.message))
        throw new Error(
          "설치된 Codex CLI는 OAuth 음성 v3를 지원하지 않아요. Codex 데스크톱 앱을 업데이트해 주세요.",
        );
      throw error;
    }
  }
  function session(id: string) {
    if (!active || active.id !== id)
      throw new JiraError("음성 연결이 만료됐어요.", 404);
    return active;
  }
  return {
    start,
    subscribe(id: string, listener: (event: VoiceEvent) => void) {
      const current = session(id);
      current.listeners.add(listener);
      listener(current.state);
      return () => {
        current.listeners.delete(listener);
        current.close();
      };
    },
    stop(id: string) {
      if (active?.id === id) active.close();
    },
    dispose() {
      disposed = true;
      active?.close();
    },
  };
}
