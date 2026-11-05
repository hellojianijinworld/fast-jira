import type { Api } from "../client/api.ts";
import type { TreeCatalog } from "../domain/catalog.ts";
import type { Issue } from "../domain/issue.ts";
import {
  matchesSearchFilters,
  searchLocalIssues,
} from "../domain/search-results.ts";
import { parseIssueKey } from "../domain/validation.ts";
import { actionButton, element, elementId, iconButton } from "./dom.ts";
import { type CardOptions, issueCard } from "./issue-card.ts";
import { createSearchFilters } from "./search-filters.ts";

/** 검색 입력·결과·페이지는 AI 대화와 별개로 소유하고 닫을 때 폐기한다. */
export function createSearchDialog(config: {
  host: HTMLElement;
  api: Pick<Api, "issues" | "lookup"> &
    Partial<Pick<Api, "users" | "statuses">>;
  catalog?: () => TreeCatalog;
  currentUserName?: string;
  site: string;
  currentUserId?: string;
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
    submit = actionButton("검색", "search", { purpose: "confirm" }),
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
  const refinements = createSearchFilters({
    api: config.api,
    ...(config.catalog ? { catalog: config.catalog } : {}),
    me: {
      accountId: config.currentUserId ?? "",
      displayName: config.currentUserName ?? "나",
    },
    changed: () => {
      if (dialog.open && lastQuery !== null) void search(false, true);
    },
  });
  const heading = element("div", "search-heading");
  const meta = element("div", "search-meta");
  meta.append(hint, status);
  heading.append(form, refinements.element, meta);
  pane.append(heading, searchResults);
  dialog.append(head, pane);
  config.host.append(dialog);
  let alive = true,
    revision = 0,
    nextPage = "",
    lastQuery: string | null = null;
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
  const shown = new Map<string, Issue>();
  function renderResults(query: string) {
    const focusedHref =
      document.activeElement instanceof HTMLAnchorElement
        ? document.activeElement.getAttribute("href")
        : null;
    cards([...shown.values()]);
    const words = query
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    for (const title of searchResults.querySelectorAll<HTMLAnchorElement>(
      ".list-title",
    )) {
      if (words.length) {
        const pattern = new RegExp(`(${words.join("|")})`, "giu");
        title.replaceChildren(
          ...(title.textContent ?? "")
            .split(pattern)
            .map((text, i) =>
              i % 2 ? element("mark", "", text) : document.createTextNode(text),
            ),
        );
      }
    }
    if (focusedHref)
      [...searchResults.querySelectorAll<HTMLAnchorElement>(".list-title")]
        .find((link) => link.getAttribute("href") === focusedHref)
        ?.focus({ preventScroll: true });
    if (nextPage) {
      const button = actionButton("더 보기", "chevron-down", {
        purpose: "quiet",
        size: "sm",
      });
      button.classList.add("command-more");
      button.addEventListener("click", () => {
        if (input.value.trim() === lastQuery) void search(true);
      });
      searchResults.append(button);
    }
  }
  async function search(more = false, conditionsChanged = false) {
    const query =
        (more || conditionsChanged ? lastQuery : input.value.trim()) ?? "",
      current = ++revision;
    const filters = refinements.value;
    if (!more) nextPage = "";
    if (!more && !conditionsChanged) input.focus();
    searchResults.querySelector(".command-more")?.remove();
    if (!query && !refinements.active) {
      lastQuery = "";
      shown.clear();
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
        const catalog = config.catalog?.();
        const matches = refinements.emptyProjects
          ? []
          : searchLocalIssues(
              config.localIssues(),
              key || query,
              filters,
              refinements.sort,
              config.currentUserId ?? "",
              (issue) => config.favorites?.has(issue) ?? false,
              config.recent(),
              catalog?.statuses ?? [],
              catalog?.priorities ?? [],
            );
        for (const issue of matches) shown.set(issue.key, issue);
        if (matches.length) renderResults(key || query);
      }
      status.textContent = more
        ? "검색 결과를 더 불러오는 중이에요…"
        : "현재 뷰 밖의 이슈도 확인 중이에요…";
      const page = refinements.emptyProjects
        ? { issues: [], nextPageToken: "" }
        : key
          ? {
              issues: [(await config.api.lookup(key)).parent].filter((issue) =>
                matchesSearchFilters(
                  issue,
                  filters,
                  config.currentUserId ?? "",
                ),
              ),
              nextPageToken: "",
            }
          : await config.api.issues(
              { ...filters, q: query },
              more ? nextPage : "",
              20,
            );
      if (!alive || current !== revision || !dialog.open) return;
      // 명시적 정렬에서는 서버의 페이지 순서를 따른다. 캐시 항목이 페이지 앞으로 끼어들지 않는다.
      if (!more && refinements.sort !== "recommended") shown.clear();
      for (const issue of page.issues) shown.set(issue.key, issue);
      nextPage = page.nextPageToken ?? "";
      renderResults(key || query);
      status.textContent = shown.size
        ? `${shown.size}개 표시${nextPage ? " · 더 불러올 수 있어요" : ""}`
        : "조건에 맞는 검색 결과가 없어요.";
    } catch (error) {
      if (alive && current === revision && dialog.open) {
        if (!shown.size) searchResults.replaceChildren();
        status.textContent = `검색 실패: ${errorText(error)}`;
      }
    }
  }

  function reset() {
    revision++;
    input.value = nextPage = "";
    lastQuery = null;
    refinements.reset();
    status.textContent = "";
    shown.clear();
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
      refinements.destroy();
      dialog.remove();
    },
  };
}
