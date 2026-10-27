import type { Api } from "../client/api.ts";
import type { Issue } from "../domain/issue.ts";
import { localSearch } from "../domain/local-search.ts";
import { parseIssueKey } from "../domain/validation.ts";
import { actionButton, element, elementId, iconButton } from "./dom.ts";
import { type CardOptions, issueCard } from "./issue-card.ts";

/** 검색 입력·결과·페이지는 AI 대화와 별개로 소유하고 닫을 때 폐기한다. */
export function createSearchDialog(config: {
  host: HTMLElement;
  api: Pick<Api, "issues" | "lookup">;
  site: string;
  currentUserId?: string;
  context: () => { projects: readonly string[] };
  recent: () => readonly Issue[];
  localIssues: () => readonly Issue[];
  order: () => readonly string[];
  favorites?: CardOptions["favorites"];
  select: (key: string) => void;
  copied: (message: string) => void;
  closed: () => void;
}) {
  const dialog = element("dialog", "command-modal search-modal"),
    head = element("div", "command-head"),
    title = element("h2", "", "이슈 검색"),
    close = iconButton("검색 닫기", "x"),
    pane = element("div", "command-panel"),
    form = element("form", "search-form"),
    input = element("input", "search-query"),
    submit = actionButton("검색", "search", "primary"),
    status = element("p", "command-status"),
    hint = element(
      "p",
      "command-hint",
      "Enter 검색 · 결과에서 ↑↓ 이동 · Enter 열기 · Esc 닫기",
    ),
    searchResults = element("div", "command-results");
  title.id = elementId("search-title");
  dialog.setAttribute("aria-labelledby", title.id);
  input.type = "search";
  input.placeholder = "이슈 번호, Jira 링크 또는 제목 검색";
  input.setAttribute("aria-label", "이슈 검색어");
  input.maxLength = 10000;
  submit.type = "submit";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  head.append(title, close);
  form.append(input, submit);
  pane.append(form, hint, status, searchResults);
  dialog.append(head, pane);
  config.host.append(dialog);
  let alive = true,
    revision = 0,
    nextPage = "",
    lastQuery = "";
  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : "요청에 실패했어요.";
  function choose(key: string) {
    closeSearch();
    config.select(key);
  }
  function searchCard(issue: Issue) {
    return issueCard(issue, {
      site: config.site,
      currentUserId: config.currentUserId ?? "",
      statusOrder: config.order(),
      onSelect: choose,
      size: "sm",
      copied: config.copied,
      ...(config.favorites ? { favorites: config.favorites } : {}),
    });
  }
  function cards(issues: readonly Issue[]) {
    searchResults.replaceChildren(...issues.map(searchCard));
  }
  const shown = new Map<string, HTMLElement>();
  let remoteResults = element("section", "command-search-group");
  function addResult(issue: Issue, target: HTMLElement, query: string) {
    const card = searchCard(issue);
    const title = card.querySelector<HTMLAnchorElement>(".list-title");
    if (title) {
      const words = query
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      if (words.length) {
        const pattern = new RegExp(`(${words.join("|")})`, "giu");
        title.replaceChildren(
          ...issue.summary
            .split(pattern)
            .map((text, index) =>
              index % 2
                ? element("mark", "", text)
                : document.createTextNode(text),
            ),
        );
      }
    }
    const existing = shown.get(issue.key);
    if (existing) {
      const focused = existing.contains(document.activeElement);
      existing.replaceChildren(...card.childNodes);
      if (focused)
        existing
          .querySelector<HTMLAnchorElement>(".list-title")
          ?.focus({ preventScroll: true });
    } else {
      target.append(card);
      shown.set(issue.key, card);
    }
  }
  async function search(more = false) {
    const query = more ? lastQuery : input.value.trim(),
      current = ++revision;
    nextPage = more ? nextPage : "";
    if (!more) input.focus();
    searchResults.querySelector(".command-more")?.remove();
    if (!query) {
      reset();
      cards(config.recent());
      status.textContent = "최근 본 이슈";
      return;
    }
    let key = "";
    try {
      if (
        /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(query) ||
        /^https?:\/\//.test(query)
      )
        key = parseIssueKey(query, config.site);
      if (!more) {
        lastQuery = query;
        shown.clear();
        searchResults.replaceChildren();
        const local = element("section", "command-search-group");
        const matches = localSearch(
          config.localIssues(),
          key || query,
          config.context().projects,
          (issue) => config.favorites?.has(issue) ?? false,
          config.recent(),
        );
        for (const issue of matches) addResult(issue, local, key || query);
        local.hidden = !matches.length;
        remoteResults = element("section", "command-search-group");
        remoteResults.hidden = true;
        searchResults.append(local, remoteResults);
      }
      status.textContent = "검색 중…";
      const page = key
        ? { issues: [(await config.api.lookup(key)).parent], nextPageToken: "" }
        : await config.api.issues(
            {
              projects: [...config.context().projects],
              scope: "all",
              excludeDone: false,
              statuses: null,
              assignees: null,
              sort: "recent",
              q: query,
            },
            more ? nextPage : "",
            20,
          );
      if (!alive || current !== revision || !dialog.open) return;
      for (const issue of page.issues)
        addResult(issue, remoteResults, key || query);
      nextPage = page.nextPageToken ?? "";
      status.textContent = shown.size ? "" : "검색 결과가 없습니다.";
      remoteResults.hidden =
        remoteResults.querySelector(".issue-card") === null;
      if (nextPage) {
        const button = actionButton("더 보기", "chevron-down");
        button.classList.add("command-more");
        button.addEventListener("click", () => {
          if (input.value.trim() === lastQuery) void search(true);
        });
        searchResults.append(button);
      }
    } catch (error) {
      if (alive && current === revision && dialog.open) {
        status.textContent = `검색 실패: ${errorText(error)}`;
      }
    }
  }

  function reset() {
    revision++;
    input.value = nextPage = lastQuery = "";
    status.textContent = "";
    shown.clear();
    remoteResults.replaceChildren();
    searchResults.replaceChildren();
  }
  function closeSearch() {
    reset();
    dialog.close();
  }
  close.addEventListener("click", closeSearch);
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    reset();
    config.closed();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      closeSearch();
  });
  input.addEventListener("input", () => {
    revision++;
    searchResults.querySelector(".command-more")?.remove();
    status.textContent = "";
  });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      form.requestSubmit();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      searchResults.querySelector<HTMLAnchorElement>(".list-title")?.focus();
    }
  });
  searchResults.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const links = [
      ...searchResults.querySelectorAll<HTMLAnchorElement>(".list-title"),
    ];
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    event.preventDefault();
    if (event.key === "ArrowUp" && index <= 0) input.focus();
    else links[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void search();
  });
  return {
    dialog,
    open() {
      if (!alive) return;
      if (!dialog.open) {
        reset();
        cards(config.recent());
        status.textContent = "최근 본 이슈";
        dialog.showModal();
      }
      input.focus();
    },
    close: closeSearch,
    destroy() {
      alive = false;
      closeSearch();
      config.closed();
      dialog.remove();
    },
  };
}
