import type { Api } from "./api.ts";
export interface VoiceSnapshot {
  text: string;
  error: string;
  ended: boolean;
}
export interface VoiceCallbacks {
  transcript: (text: string) => void;
  state: (active: boolean, message: string) => void;
}
export interface VoiceInput {
  start(): void;
  stop(): void;
  destroy(): void;
}
/** 녹음 파일을 만들지 않고 WebRTC로 보내며, 텍스트는 입력창에만 돌려준다. */
export function createCodexVoice(
  options: VoiceCallbacks & {
    api: Pick<Api, "voiceStart" | "voiceStop">;
    subscribe: (
      id: string,
      listener: (event: VoiceSnapshot) => void,
    ) => () => void;
  },
): VoiceInput {
  type Recording = {
    stream?: MediaStream;
    peer?: RTCPeerConnection;
    id: string;
    abort: AbortController;
    unsubscribe: () => void;
    timer?: ReturnType<typeof setTimeout>;
  };
  let active: Recording | undefined;
  function stop() {
    const current = active;
    active = undefined;
    if (current) {
      clearTimeout(current.timer);
      current.abort.abort();
      current.stream?.getTracks().forEach((track) => {
        track.stop();
      });
      current.peer?.close();
      current.unsubscribe();
      if (current.id) void options.api.voiceStop(current.id).catch(() => {});
    }
    options.state(false, "");
  }
  async function start() {
    if (active) {
      const current = active;
      current.stream?.getTracks().forEach((track) => {
        track.stop();
      });
      options.state(true, "전사를 마무리하고 있어요…");
      clearTimeout(current.timer);
      current.timer = setTimeout(stop, 500);
      return;
    }
    const current: Recording = {
      id: "",
      abort: new AbortController(),
      unsubscribe: () => {},
    };
    active = current;
    options.state(true, "Codex 로그인으로 음성 입력을 연결하고 있어요…");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof RTCPeerConnection === "undefined"
      )
        throw new Error(
          "이 브라우저에서는 마이크를 사용할 수 없어요. 최신 브라우저에서 로컬 주소로 접속해 주세요.",
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (active !== current) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      current.stream = stream;
      for (const track of stream.getAudioTracks()) track.enabled = false;
      const peer = new RTCPeerConnection();
      current.peer = peer;
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      peer.createDataChannel("oai-events");
      peer.onconnectionstatechange = () => {
        if (active !== current) return;
        if (peer.connectionState === "connected") {
          for (const track of stream.getAudioTracks()) track.enabled = true;
          options.state(
            true,
            "듣고 있어요. 다시 누르면 멈춥니다. 음성은 Codex의 OpenAI 음성 서비스로 전달됩니다.",
          );
        } else if (
          peer.connectionState === "failed" ||
          peer.connectionState === "disconnected"
        ) {
          stop();
          options.state(false, "음성 연결이 끊겼어요. 다시 시도해 주세요.");
        }
      };
      await peer.setLocalDescription(await peer.createOffer());
      const session = await options.api.voiceStart(
        peer.localDescription?.sdp ?? "",
        current.abort.signal,
      );
      if (active !== current) {
        void options.api.voiceStop(session.id).catch(() => {});
        return;
      }
      current.id = session.id;
      current.unsubscribe = options.subscribe(session.id, (event) => {
        if (active !== current) return;
        if (event.text || (!event.error && !event.ended))
          options.transcript(event.text);
        if (event.error || event.ended) {
          stop();
          if (event.error) options.state(false, event.error);
        }
      });
      await peer.setRemoteDescription({ type: "answer", sdp: session.sdp });
    } catch (error) {
      if (active !== current) return;
      stop();
      options.state(
        false,
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "마이크 권한을 허용한 뒤 다시 눌러 주세요."
          : error instanceof Error
            ? error.message
            : "음성 입력에 실패했어요.",
      );
    }
  }
  return {
    start: () => {
      void start();
    },
    stop,
    destroy: stop,
  };
}
