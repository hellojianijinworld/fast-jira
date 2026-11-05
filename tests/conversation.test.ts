import assert from "node:assert/strict";
import { test } from "node:test";
import { createConversationStore } from "../src/client/conversation-store.ts";
import {
  commandForShortcut,
  matchingCommands,
  shortcutAria,
  shortcutLabel,
} from "../src/domain/commands.ts";
import {
  conversationContext,
  conversationMarkdown,
  decodeConversations,
} from "../src/domain/conversation.ts";

const chat = {
  id: "local-1",
  conversationId: "native-1",
  model: "test",
  updated: 100,
  messages: [{ role: "user" as const, text: "내 작업 찾아줘" }],
};
test("명령 검색은 이름·검색어로 찾고 OS별 단축키를 표시한다", () => {
  assert.deepEqual(
    matchingCommands("AI").map((x) => x.id),
    ["ai"],
  );
  assert.deepEqual(
    matchingCommands("> 찾기").map((x) => x.id),
    ["search"],
  );
  assert.equal(matchingCommands("없는 명령").length, 0);
  assert.equal(shortcutLabel("MacIntel", "palette"), "⌘⇧P");
  assert.equal(shortcutLabel("Win32"), "Ctrl+K");
  assert.equal(shortcutLabel("MacIntel", "ai"), "⌃⌘I");
  assert.equal(shortcutLabel("Win32", "ai"), "Ctrl+Alt+I");
  assert.equal(shortcutAria("MacIntel", "ai"), "Control+Meta+i");
  assert.equal(shortcutAria("Linux", "ai"), "Control+Alt+i");
});
test("AI 단축키는 OS별 조합과 한글 물리 키를 인식하고 개발자 도구·AltGr 입력은 가로채지 않는다", () => {
  const key = {
    key: "ㅑ",
    code: "KeyI",
    metaKey: true,
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    repeat: false,
    getModifierState: () => false,
  };
  assert.equal(commandForShortcut(key, "MacIntel"), "ai");
  assert.equal(
    commandForShortcut({ ...key, ctrlKey: false }, "MacIntel"),
    null,
  );
  assert.equal(
    commandForShortcut({ ...key, ctrlKey: false, altKey: true }, "MacIntel"),
    null,
  );
  assert.equal(
    commandForShortcut({ ...key, metaKey: false, altKey: true }, "Win32"),
    "ai",
  );
  assert.equal(
    commandForShortcut(
      { ...key, metaKey: false, altKey: true, getModifierState: () => true },
      "Win32",
    ),
    null,
  );
  assert.equal(
    commandForShortcut({ ...key, shiftKey: true }, "MacIntel"),
    null,
  );
  assert.equal(commandForShortcut({ ...key, repeat: true }, "MacIntel"), null);
  assert.equal(
    commandForShortcut(
      { ...key, key: "k", code: "KeyK", ctrlKey: false },
      "MacIntel",
    ),
    "search",
  );
  assert.equal(
    commandForShortcut(
      { ...key, key: "P", code: "KeyP", ctrlKey: false, shiftKey: true },
      "MacIntel",
    ),
    "palette",
  );
});
test("대화는 Jira 계정별로 복원·직접 삭제하며 읽기 실패 시 기존 기록을 보존한다", () => {
  const data = new Map<string, string>(),
    storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
  const first = createConversationStore(storage, "site:a"),
    second = createConversationStore(storage, "site:b");
  first.write([chat]);
  assert.deepEqual(createConversationStore(storage, "site:a").read(), [chat]);
  assert.deepEqual(second.read(), []);
  first.write([]);
  assert.deepEqual(first.read(), []);
  storage.setItem("fastJira:conversations:site:a", "broken");
  assert.throws(() => first.read(), /덮어쓰지/);
  assert.throws(() => first.write([chat]));
  assert.equal(storage.getItem("fastJira:conversations:site:a"), "broken");
});
test("연결 복구에는 최근 20개·2만 자만 전달하며 원래 기록은 유지한다", () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({
    role: "user" as const,
    text: `${i}:${"가".repeat(1200)}`,
  }));
  const context = conversationContext(messages);
  assert.ok(context.length <= 20);
  assert.equal(
    context.reduce((sum, x) => sum + x.text.length, 0),
    20000,
  );
  assert.deepEqual(context.at(-1), messages.at(-1));
  assert.equal(messages.length, 30);
  assert.throws(() =>
    decodeConversations([
      { ...chat, messages: [{ role: "system", text: "unsafe" }] },
    ]),
  );
  const store = createConversationStore(
    {
      getItem: () => null,
      setItem: () => {
        throw Error("quota");
      },
    },
    "site:a",
  );
  assert.throws(() => store.write([chat]), /저장하지 못/);
});
test("대화별 모델과 새 대화 기본 모델은 계정별로 각각 복원한다", () => {
  const data = new Map<string, string>(),
    storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
  const store = createConversationStore(storage, "site:a");
  store.setDefaultModel("second");
  store.upsert({ ...chat, model: "first" });
  const restored = createConversationStore(storage, "site:a");
  assert.equal(restored.defaultModel(), "second");
  assert.equal(restored.read()[0]?.model, "first");
  assert.equal(createConversationStore(storage, "site:b").defaultModel(), "");
});

test("이전 Codex 원본 ID는 복원하지 않고 제공자에 관계없이 대화 내용을 복사한다", () => {
  const legacy = { ...chat, threadId: "old-thread" };
  const restored = decodeConversations([legacy])[0];
  assert.equal(restored && "threadId" in restored, false);
  assert.match(conversationMarkdown(restored) ?? "", /## 나/);
  assert.match(
    conversationMarkdown({ ...chat, model: "claude:sonnet" }) ?? "",
    /내 작업/,
  );
  assert.equal(conversationMarkdown(undefined), null);
});

test("실행 결과와 후속 질문을 함께 보관하고 연결 복구 때도 맥락을 유지한다", () => {
  const messages = [
    {
      role: "assistant" as const,
      text: "두 번째 작업의 상위는 어디인가요?",
      executionSummary: "완료 · 첫 작업 AA-99",
    },
  ];
  const restored = decodeConversations([{ ...chat, messages }])[0];
  assert.equal(restored?.messages[0]?.executionSummary, "완료 · 첫 작업 AA-99");
  assert.match(
    conversationContext(messages)[0]?.text ?? "",
    /첫 작업 AA-99[\s\S]*상위는 어디/,
  );
});

test("AI를 사용할 수 없으면 명령 팔레트에서 AI 항목만 제외한다", () => {
  assert.deepEqual(
    matchingCommands("", false).map((item) => item.id),
    ["create", "search", "faq"],
  );
  assert.equal(matchingCommands("AI", false).length, 0);
  assert.equal(matchingCommands("검색", false)[0]?.id, "search");
});

test("모델·작업 이력은 저장과 복원을 거쳐 남고 모델에게는 발언만 전달한다", () => {
  const messages = [
    { role: "user" as const, text: "조회" },
    { role: "event" as const, text: "모델을 변경했어요.", created: 100 },
    {
      role: "event" as const,
      text: "승인했어요.",
      details: "상태 변경",
      created: 110,
    },
    { role: "assistant" as const, text: "완료", model: "other" },
  ];
  const restored = decodeConversations(
    JSON.parse(JSON.stringify([{ ...chat, threadId: "native", messages }])),
  );
  assert.deepEqual(restored[0]?.messages, messages);
  assert.deepEqual(conversationContext(messages), [
    { role: "user", text: "조회" },
    { role: "assistant", text: "완료" },
  ]);
  assert.throws(() =>
    decodeConversations([
      { ...chat, messages: [{ role: "event", text: "x", created: "bad" }] },
    ]),
  );
});

test("요청 오류는 기록에 보존하되 AI 대화 문맥에는 포함하지 않는다", () => {
  const messages = [
    { role: "user" as const, text: "작업 확인" },
    {
      role: "error" as const,
      text: "연결 충돌",
      executionNote: "이번 요청은 실행하지 않았어요.",
    },
    { role: "assistant" as const, text: "요청 실패: 이전 연결 오류" },
    { role: "assistant" as const, text: "정상 답변" },
  ];
  const restored = decodeConversations([{ ...chat, messages }])[0];
  assert.equal(restored?.messages[1]?.role, "error");
  assert.equal(restored?.messages[2]?.role, "error");
  assert.equal(restored?.messages[2]?.text, "이전 연결 오류");
  assert.deepEqual(conversationContext(messages), [
    { role: "user", text: "작업 확인" },
    { role: "assistant", text: "정상 답변" },
  ]);
});

test("전송된 이슈·사람 멘션의 참조 정보는 브라우저 기록 저장과 복원 후에도 남는다", () => {
  const store = createConversationStore(
    {
      getItem: () => saved,
      setItem: (_key, value) => {
        saved = value;
      },
    },
    "mentions",
  );
  let saved = "";
  const message = {
    role: "user" as const,
    text: "@김하나 확인해 주세요",
    mentions: [
      {
        start: 0,
        end: 4,
        target: { kind: "user" as const, id: "account-1", label: "김하나" },
      },
    ],
  };
  store.upsert({ ...chat, messages: [message] });
  assert.deepEqual(store.read()[0]?.messages[0]?.mentions, message.mentions);
  assert.throws(() =>
    decodeConversations([
      {
        ...chat,
        messages: [
          { ...message, mentions: [{ ...message.mentions[0], end: 1000 }] },
        ],
      },
    ]),
  );
});

test("Codex 복구 자료는 오래된 요청·멘션 ID·작업 결과·승인 의견을 보존하고 오류는 제외한다", () => {
  const messages = [
    ...Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      text: `요청 ${i}`,
    })),
    {
      role: "user" as const,
      text: "@김하나",
      mentions: [
        {
          start: 0,
          end: 4,
          target: { kind: "user" as const, id: "account-1", label: "김하나" },
        },
      ],
    },
    {
      role: "event" as const,
      text: "승인 질문",
      details: "사용자 의견",
      executionSummary: "실행 결과",
    },
    { role: "error" as const, text: "이전 연결 오류" },
  ];
  const restored = conversationContext(messages, true);
  assert.equal(restored.length, 32);
  assert.equal(restored[0]?.text, "요청 0");
  assert.match(JSON.stringify(restored), /account-1/);
  assert.match(restored.at(-1)?.text ?? "", /사용자 의견/);
  assert.match(restored.at(-1)?.text ?? "", /현재 상태·승인의 증거가 아님/);
  assert.doesNotMatch(JSON.stringify(restored), /이전 연결 오류/);
  assert.throws(
    () =>
      conversationContext([{ role: "user", text: "가".repeat(100001) }], true),
    /복구 범위/,
  );
});

test("추론 강도는 모델별 기본값과 대화별 선택을 구분해 저장한다", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const store = createConversationStore(storage, "efforts");
  store.setDefaultEffort("first", "high");
  store.setDefaultEffort("second", "medium");
  assert.equal(
    createConversationStore(storage, "efforts").defaultEffort("first"),
    "high",
  );
  assert.equal(store.defaultEffort("second"), "medium");
  store.upsert({
    id: "c",
    conversationId: "native",
    model: "first",
    effort: "medium",
    updated: 1,
    messages: [],
  });
  assert.equal(store.read()[0]?.effort, "medium");
  assert.equal(store.defaultEffort("first"), "high");
});
