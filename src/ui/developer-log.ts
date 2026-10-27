import type { LogEntry } from "../domain/log.ts";
import { actionButton, element } from "./dom.ts";
import { dragHandle } from "./drag-handle.ts";

/** 로그는 화면의 최근 300줄만 가진다. 시작·완료는 요청 ID로 같은 줄을 갱신한다. */
export function developerLog(
  root: HTMLElement,
  toggle: HTMLButtonElement,
  subscribe: (listener: (entry: LogEntry) => void) => () => void,
) {
  const panel = element("section", "developer-panel"),
    resize = element("div", "debug-resize"),
    head = element("div", "debug-head"),
    log = element("div", "debug-log"),
    content = element("div", "debug-content"),
    response = element("section", "debug-response"),
    responseTitle = element("strong", "", "응답"),
    responseBody = element("pre", "", "요청을 선택하면 응답을 볼 수 있어요.");
  response.setAttribute("aria-label", "선택한 요청의 응답");
  response.append(responseTitle, responseBody);
  content.append(log, response);
  panel.setAttribute("aria-label", "개발자 로그");
  resize.tabIndex = 0;
  resize.setAttribute("role", "separator");
  resize.setAttribute("aria-label", "개발자 로그 높이");
  resize.setAttribute("aria-orientation", "horizontal");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "off");
  log.setAttribute("aria-label", "화면 동작과 요청 내역");
  const close = actionButton("닫기", "x");
  head.append(element("strong", "", "개발자 로그"), close);
  panel.append(resize, head, content);
  root.append(panel);
  let enabled = false,
    open = false,
    unsubscribe: (() => void) | null = null;
  let selectedId: number | null = null;
  const entries = new Map<number, LogEntry>();
  function showResponse() {
    const entry = selectedId === null ? undefined : entries.get(selectedId);
    responseTitle.textContent = entry
      ? `${entry.command} · ${entry.result || "진행 중…"}`
      : "응답";
    let body =
      entry?.response ??
      (entry?.result
        ? "응답 본문을 기다리는 중…"
        : "요청을 선택하면 응답을 볼 수 있어요.");
    try {
      body = JSON.stringify(JSON.parse(body), null, 2);
    } catch {}
    responseBody.textContent = body;
    for (const [id, row] of rows)
      row.setAttribute("aria-pressed", String(id === selectedId));
  }
  const rows = new Map<number, HTMLElement>(),
    controller = new AbortController();
  function height(value: number) {
    const minimum =
      innerWidth <= 600 ? Math.max(120, Math.round(innerHeight * 0.4)) : 120;
    const maximum = Math.max(minimum, Math.round(innerHeight * 0.65)),
      pixels = Math.max(minimum, Math.min(maximum, Math.round(value)));
    root.style.setProperty("--debug-height", `${pixels}px`);
    resize.setAttribute("aria-valuemin", String(minimum));
    resize.setAttribute("aria-valuemax", String(maximum));
    resize.setAttribute("aria-valuenow", String(pixels));
  }
  function trim() {
    while (log.children.length > 300) {
      const first = log.firstElementChild;
      if (!first) break;
      if (first instanceof HTMLElement && first.dataset.requestId) {
        const id = Number(first.dataset.requestId);
        rows.delete(id);
        entries.delete(id);
        if (selectedId === id) {
          selectedId = null;
          showResponse();
        }
      }
      first.remove();
    }
  }
  function append(time: string, command: string, result?: string, id?: number) {
    if (!open) return;
    const following = log.scrollHeight - log.scrollTop - log.clientHeight < 32;
    let row = id === undefined ? undefined : rows.get(id);
    if (!row) {
      log.querySelector(".empty")?.remove();
      row = element(
        id === undefined ? "div" : "button",
        `debug-line${id === undefined ? " action" : ""}`,
      );
      if (row instanceof HTMLButtonElement) row.type = "button";
      row.append(
        element("time", "", time),
        element("span", "debug-command", command),
      );
      if (id !== undefined) {
        row.dataset.requestId = String(id);
        rows.set(id, row);
        row.addEventListener("click", () => {
          selectedId = id;
          showResponse();
        });
        row.append(element("span", "debug-result"));
      }
      log.append(row);
    }
    const outcome = row.querySelector(".debug-result");
    if (outcome) outcome.textContent = result || "진행 중…";
    row.classList.toggle("failed", /^(실패|[45]\d\d)/.test(result ?? ""));
    trim();
    if (following) log.scrollTop = log.scrollHeight;
  }
  function setOpen(value: boolean) {
    unsubscribe?.();
    unsubscribe = null;
    open = value && enabled;
    panel.hidden = !open;
    root.dataset.debugOpen = String(open);
    toggle.setAttribute("aria-pressed", String(open));
    toggle.setAttribute(
      "aria-label",
      open ? "개발자 로그 끄기" : "개발자 로그 켜기",
    );
    log.replaceChildren();
    rows.clear();
    entries.clear();
    selectedId = null;
    showResponse();
    if (open) {
      height(panel.getBoundingClientRect().height);
      log.append(
        element("p", "empty", "화면 동작과 요청 내역을 기다리는 중입니다."),
      );
      unsubscribe = subscribe((entry) => {
        entries.set(entry.id, { ...entries.get(entry.id), ...entry });
        append(entry.time, entry.command, entry.result, entry.id);
        if (selectedId === entry.id) showResponse();
      });
    }
  }
  function action(label: string) {
    if (label) append(new Date().toLocaleTimeString("ko-KR"), label);
  }
  const signal = controller.signal;
  toggle.addEventListener("click", () => setOpen(!open), { signal });
  close.addEventListener("click", () => setOpen(false), { signal });
  root.addEventListener(
    "click",
    (event) => {
      if (!open || !(event.target instanceof Element)) return;
      const target = event.target.closest("button,a,summary");
      if (
        !target ||
        panel.contains(target) ||
        target === toggle ||
        target.getAttribute("type") === "submit"
      )
        return;
      const issue =
        target.matches("a.list-item") && target instanceof HTMLAnchorElement
          ? new URL(target.href).searchParams.get("issue")
          : "";
      action(
        issue
          ? `이슈 선택: ${issue}`
          : target.getAttribute("aria-label") ||
              target.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ||
              "",
      );
    },
    { capture: true, signal },
  );
  root.addEventListener(
    "change",
    (event) => {
      const control = event.target;
      if (!open || panel.contains(control instanceof Node ? control : null))
        return;
      if (
        !(control instanceof HTMLSelectElement) &&
        !(
          control instanceof HTMLInputElement &&
          ["checkbox", "date"].includes(control.type)
        )
      )
        return;
      const label =
        control.getAttribute("aria-label") ||
        control.labels?.[0]?.textContent?.trim() ||
        "값 변경";
      const value =
        control instanceof HTMLSelectElement
          ? control.selectedOptions[0]?.textContent
          : control.type === "checkbox"
            ? control.checked
              ? "켬"
              : "끔"
            : control.value;
      action(`${label}: ${value ?? ""}`);
    },
    { capture: true, signal },
  );
  root.addEventListener(
    "submit",
    (event) => {
      if (!open || !(event.target instanceof HTMLFormElement)) return;
      action(
        event.target.getAttribute("aria-label") ||
          event.target
            .querySelector("[contenteditable]")
            ?.getAttribute("aria-label") ||
          "저장",
      );
    },
    { capture: true, signal },
  );
  const stop = dragHandle(
    resize,
    (event) => height(innerHeight - event.clientY),
    (event) => {
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      height(
        panel.getBoundingClientRect().height +
          (event.key === "ArrowUp" ? 20 : -20),
      );
    },
  );
  const clamp = () => {
    if (open) height(panel.getBoundingClientRect().height);
  };
  window.addEventListener("resize", clamp, { signal });
  setOpen(false);
  return {
    setEnabled(value: boolean) {
      enabled = value;
      toggle.hidden = !enabled;
      if (!enabled) setOpen(false);
    },
    place(host: HTMLElement) {
      if (panel.parentElement !== host) host.append(panel);
    },
    destroy() {
      setOpen(false);
      stop();
      controller.abort();
      panel.remove();
      root.style.removeProperty("--debug-height");
      delete root.dataset.debugOpen;
    },
  };
}
