import assert from "node:assert/strict";
import test from "node:test";
import { applicationCommands } from "../src/client/palette-actions.ts";
import {
  commandForShortcut,
  createActionCatalog,
  matchingActions,
  matchingCommands,
  type PaletteAction,
  shortcutLabel,
} from "../src/domain/commands.ts";

function fixture() {
  let theme: "light" | "dark" | "system" = "light";
  let active = "one";
  const views = [
    { id: "one", name: "내 작업", icon: "" },
    { id: "two", name: "가나라", icon: "emoji:🍎" },
  ];
  const calls: string[] = [];
  const actions = () =>
    applicationCommands({
      theme,
      views,
      activeView: active,
      setTheme: (value) => {
        theme = value;
        calls.push(value);
      },
      selectView: (id) => {
        active = id;
        calls.push(id);
      },
      createView: () => calls.push("new-view"),
      editView: () => calls.push("edit-view"),
      settings: (tab) => calls.push(tab ?? "settings"),
      help: () => calls.push("help"),
      onboarding: () => calls.push("onboarding"),
      feedback: () => calls.push("feedback"),
      selection: { active: false, toggle: () => calls.push("selection") },
    });
  return { actions, views, calls };
}
test("띄어쓰기·따옴표가 달라도 한국어 전환 명령을 찾고 기존 명령 검색을 유지한다", () => {
  const { actions } = fixture();
  assert.equal(
    matchingCommands("다크모드로 전환", true, actions())[0]?.id,
    "theme:dark",
  );
  assert.equal(
    matchingCommands("'가나라' 뷰로 전환", true, actions())[0]?.id,
    "view:two",
  );
  assert.equal(matchingCommands("> 찾기")[0]?.id, "search");
});
test("테마·뷰 액션은 기존 동작을 호출하고 현재 상태를 다음 조회에 반영한다", () => {
  const { actions, calls } = fixture();
  actions()
    .find((item) => item.id === "theme:dark")
    ?.run();
  actions()
    .find((item) => item.id === "view:two")
    ?.run();
  assert.deepEqual(calls, ["dark", "two"]);
  assert.equal(
    actions().find((item) => item.id === "theme:dark")?.current,
    true,
  );
  assert.equal(actions().find((item) => item.id === "view:two")?.current, true);
});
test("동적으로 추가된 뷰는 별도 등록 없이 검색되고 이름이 같아도 ID로 실행한다", () => {
  const { actions, views, calls } = fixture();
  views.push({ id: "three", name: "가나라", icon: "" });
  const found = matchingCommands("가나라", true, actions());
  assert.equal(found.length, 2);
  actions()
    .find((item) => item.id === "view:three")
    ?.run();
  assert.deepEqual(calls, ["three"]);
});
test("설정·뷰 생성은 연결된 UI만 열고 실행 전에는 상태를 바꾸지 않는다", () => {
  const { actions, calls } = fixture();
  assert.equal(calls.length, 0);
  actions()
    .find((item) => item.id === "view:create")
    ?.run();
  actions()
    .find((item) => item.id === "settings:connection")
    ?.run();
  assert.deepEqual(calls, ["new-view", "Jira 연결"]);
});

test("공통 카탈로그는 실행 직전 비활성·숨김 상태를 다시 검사하고 중복 ID를 거부한다", async () => {
  let enabled = true,
    visible = true,
    calls = 0;
  const catalog = createActionCatalog(() => [
    {
      id: "test",
      label: "검사",
      icon: "check",
      keywords: "",
      enabled,
      visible,
      run: () => {
        calls++;
      },
    },
  ]);
  assert.equal(catalog.all().length, 1);
  enabled = false;
  assert.equal(await catalog.execute("test"), false);
  enabled = true;
  assert.equal(await catalog.execute("test"), true);
  visible = false;
  assert.equal(catalog.all().length, 0);
  assert.equal(await catalog.execute("test"), false);
  assert.equal(calls, 1);
  const duplicate = createActionCatalog(() => [
    ...catalog.all(),
    ...catalog.all(),
  ]);
  visible = true;
  assert.throws(() => duplicate.all(), /중복 액션/);
});
test("검색 결과는 명시된 그룹 순서와 그룹 안의 관련도를 함께 유지한다", () => {
  const make = (id: string, label: string, group: string): PaletteAction => ({
    id,
    label,
    group,
    icon: "check",
    keywords: "뷰",
    run: () => {},
  });
  assert.deepEqual(
    matchingActions("뷰", [
      make("faq", "뷰란 무엇인가요", "FAQ"),
      make("edit", "현재 뷰 편집", "뷰"),
      make("new", "뷰 만들기", "뷰"),
    ]).map((action) => action.id),
    ["new", "edit", "faq"],
  );
});
test("설정 단축키는 OS 표시와 물리 키를 지원하고 Shift·Alt·반복 입력은 제외한다", () => {
  const event = {
    key: ",",
    code: "Comma",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    getModifierState: () => false,
  };
  assert.equal(shortcutLabel("MacIntel", "settings"), "⌘,");
  assert.equal(shortcutLabel("Win32", "settings"), "Ctrl+,");
  assert.equal(commandForShortcut(event, "MacIntel"), "settings");
  assert.equal(
    commandForShortcut({ ...event, metaKey: false, ctrlKey: true }, "Win32"),
    "settings",
  );
  for (const modifier of ["shiftKey", "altKey", "repeat"] as const)
    assert.equal(
      commandForShortcut({ ...event, [modifier]: true }, "MacIntel"),
      null,
    );
});
test("설치에서 업데이트를 지원하지 않으면 메뉴와 팔레트 모두 액션을 숨긴다", () => {
  const { actions } = fixture();
  assert.equal(matchingCommands("업데이트", true, actions()).length, 0);
});
