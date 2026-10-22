import type { Api } from "../client/api.ts";
import type { Issue } from "../domain/issue.ts";
import { actionButton, element } from "./dom.ts";
import { issueTypeIcon } from "./meta.ts";
import { enhanceSelect } from "./select-menu.ts";

export async function parentSelect(
  host: HTMLElement,
  api: Api,
  keys: string[],
) {
  const select = element("select");
  select.setAttribute("aria-label", "부모 변경");
  host.replaceChildren(select);
  const initial = element("option", "", "부모를 선택하세요");
  initial.value = "__choose__";
  initial.disabled = initial.selected = true;
  const clear = element("option", "", "부모 연결 해제");
  clear.value = "";
  select.append(initial, clear);
  const issues = new Map<string, Issue>();
  let requestVersion = 0;
  let query = "",
    token: string | null = null;
  const more = actionButton("후보 더 보기", "chevron-right");
  more.hidden = true;
  async function load(text: string, append = false) {
    const version = ++requestVersion;
    const page = await api.parentOptions(
      keys,
      text,
      append ? (token ?? "") : "",
    );
    if (version !== requestVersion) return;
    const value = select.value;
    if (!append) {
      issues.clear();
      select.replaceChildren(initial, clear);
    }
    for (const issue of page.issues) {
      if (issues.has(issue.key)) continue;
      issues.set(issue.key, issue);
      const option = element("option", "", `${issue.key} · ${issue.summary}`);
      option.value = issue.key;
      select.append(option);
    }
    select.value = [...select.options].some((option) => option.value === value)
      ? value
      : "__choose__";
    if (select.value !== value)
      select.dispatchEvent(new Event("change", { bubbles: true }));
    query = text;
    token = page.nextPageToken;
    more.hidden = !token;
  }
  await load("");
  const menu = enhanceSelect(select, {
    searchLabel: "이슈 키·제목으로 검색",
    onSearch: async (query) => {
      await load(query);
      menu.sync();
    },
    renderOption: (option) => {
      const issue = issues.get(option.value);
      if (!issue) return document.createTextNode(option.textContent ?? "");
      const row = element("span", "parent-choice");
      const copy = element("span", "select-option-copy");
      copy.append(
        element("span", "", issue.summary),
        element("small", "", issue.key),
      );
      row.append(issueTypeIcon(issue), copy);
      return row;
    },
  });
  const error = element("p", "error");
  error.setAttribute("role", "alert");
  menu.panel.append(more, error);
  more.addEventListener("click", async () => {
    more.disabled = true;
    error.textContent = "";
    try {
      await load(query, true);
      menu.sync();
    } catch (reason) {
      error.textContent =
        reason instanceof Error ? reason.message : "후보를 불러오지 못했어요.";
    } finally {
      more.disabled = false;
    }
  });
  return { select, menu };
}
