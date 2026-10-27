import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodexVoice } from "../src/client/codex-voice.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
test("마이크 권한 응답 전에 닫으면 늦게 받은 트랙도 즉시 종료하고 연결하지 않는다", async () => {
  let release: (stream: MediaStream) => void = () => {},
    stopped = 0,
    calls = 0;
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices"),
    oldPeer = Object.getOwnPropertyDescriptor(globalThis, "RTCPeerConnection");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          release = resolve;
        }),
    },
  });
  Object.defineProperty(globalThis, "RTCPeerConnection", {
    configurable: true,
    value: class {},
  });
  const states: boolean[] = [];
  const voice = createCodexVoice({
    api: {
      voiceStart: async () => {
        calls++;
        return { id: "x", sdp: "v=0" };
      },
      voiceStop: async () => ({}),
    },
    subscribe: () => () => {},
    transcript: () => {
      throw Error("No transcript expected");
    },
    state: (active) => {
      states.push(active);
    },
  });
  try {
    voice.start();
    voice.stop();
    release({
      getTracks: () => [
        {
          stop() {
            stopped++;
          },
        },
      ],
    } as unknown as MediaStream);
    await tick();
    assert.equal(stopped, 1);
    assert.equal(calls, 0);
    assert.deepEqual(states, [true, false]);
  } finally {
    voice.destroy();
    if (descriptor)
      Object.defineProperty(navigator, "mediaDevices", descriptor);
    else Reflect.deleteProperty(navigator, "mediaDevices");
    if (oldPeer)
      Object.defineProperty(globalThis, "RTCPeerConnection", oldPeer);
    else Reflect.deleteProperty(globalThis, "RTCPeerConnection");
  }
});
test("마이크 권한 거절은 연결을 만들지 않고 입력 가능한 상태로 돌아온다", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices"),
    oldPeer = Object.getOwnPropertyDescriptor(globalThis, "RTCPeerConnection");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    },
  });
  Object.defineProperty(globalThis, "RTCPeerConnection", {
    configurable: true,
    value: class {},
  });
  const states: { active: boolean; message: string }[] = [];
  const voice = createCodexVoice({
    api: {
      voiceStart: async () => {
        throw Error("Unexpected session");
      },
      voiceStop: async () => ({}),
    },
    subscribe: () => () => {},
    transcript: () => {},
    state: (active, message) => {
      states.push({ active, message });
    },
  });
  try {
    voice.start();
    await tick();
    assert.equal(states.at(-1)?.active, false);
    assert.match(states.at(-1)?.message ?? "", /마이크 권한/);
  } finally {
    voice.destroy();
    if (descriptor)
      Object.defineProperty(navigator, "mediaDevices", descriptor);
    else Reflect.deleteProperty(navigator, "mediaDevices");
    if (oldPeer)
      Object.defineProperty(globalThis, "RTCPeerConnection", oldPeer);
    else Reflect.deleteProperty(globalThis, "RTCPeerConnection");
  }
});
