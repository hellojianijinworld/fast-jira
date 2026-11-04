import {
  browserSettingsStorage,
  readGlobalSettings,
  updateGlobalSettings,
} from "../client/global-settings.ts";
import type { LocalStore } from "../client/preferences.ts";
import { type DiffLine, lineDifference } from "../domain/line-diff.ts";
import { textDifference } from "../domain/text-diff.ts";
import { element } from "./dom.ts";

export function historyDiff(
  from: string,
  to: string,
  storage: LocalStore = browserSettingsStorage,
) {
  const root = element("div", "history-diff-view"),
    toolbar = element("div", "history-diff-toolbar"),
    label = element("label", "history-diff-toggle"),
    toggle = element("input"),
    table = element("div", "history-diff-table");
  toggle.type = "checkbox";
  toggle.checked = readGlobalSettings(storage).history.diffLayout === "inline";
  label.append(toggle, document.createTextNode("인라인 보기"));
  toolbar.append(element("span", "muted", "− 삭제 · + 추가"), label);
  const message = element("small", "error");
  message.setAttribute("role", "status");
  message.hidden = true;
  root.append(toolbar, message, table);
  const rows = lineDifference(from, to);
  function render() {
    table.dataset.layout = toggle.checked ? "inline" : "split";
    table.replaceChildren();
    const heading = element("div", "history-diff-row history-diff-heading");
    if (toggle.checked)
      heading.append(element("span", "", "변경 전 → 변경 후"));
    else
      heading.append(
        element("span", "", "변경 전"),
        element("span", "", "변경 후"),
      );
    table.append(heading);
    for (const row of rows) {
      const pair =
        row.before && row.after && (row.before.changed || row.after.changed)
          ? textDifference(row.before.text, row.after.text)
          : undefined;
      const cell = (line: DiffLine | undefined, side: "before" | "after") => {
        const node = element("div", "history-diff-cell");
        node.dataset.side = side;
        node.dataset.change = !line
          ? "empty"
          : line.changed
            ? side === "before"
              ? "removed"
              : "added"
            : "same";
        const number = element(
          "span",
          "history-diff-number",
          line ? String(line.number) : "",
        );
        number.setAttribute("aria-hidden", "true");
        const marker = element(
          "span",
          "history-diff-marker",
          line?.changed ? (side === "before" ? "−" : "+") : "",
        );
        marker.setAttribute("aria-hidden", "true");
        const text = element("code");
        if (line) {
          if (line.changed) {
            const marked = element(
              side === "before" ? "del" : "ins",
              "",
              pair ? (side === "before" ? pair.before : pair.after) : line.text,
            );
            text.append(pair?.prefix ?? "", marked, pair?.suffix ?? "");
          } else text.textContent = line.text;
        }
        node.append(number, marker, text);
        return node;
      };
      if (toggle.checked) {
        for (const [line, side] of [
          [row.before, "before"],
          [row.after, "after"],
        ] as const) {
          if (!line || (side === "after" && !line.changed)) continue;
          const item = element("div", "history-diff-row");
          item.append(cell(line, side));
          table.append(item);
        }
      } else {
        const item = element("div", "history-diff-row");
        item.append(cell(row.before, "before"), cell(row.after, "after"));
        table.append(item);
      }
    }
    if (!rows.length) table.append(element("p", "muted", "내용이 없어요."));
  }
  toggle.addEventListener("change", () => {
    render();
    try {
      updateGlobalSettings(storage, {
        history: { diffLayout: toggle.checked ? "inline" : "split" },
      });
      message.hidden = true;
    } catch {
      message.textContent =
        "보기 설정을 저장하지 못했어요. 이번 화면에만 적용돼요.";
      message.hidden = false;
    }
  });
  render();
  return root;
}
