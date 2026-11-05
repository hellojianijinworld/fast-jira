import {
  type ButtonGroupOptions,
  type ButtonOptions,
  type ButtonVariant,
  buttonVariants,
} from "./theme.ts";

let nextElementId = 0;

/** 화면 내 접근성 연결용 ID에는 보안 컨텍스트나 난수가 필요하지 않다. */
export function elementId(prefix: string): string {
  return `fast-jira-${prefix}-${++nextElementId}`;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function safeHref(value: string, base?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function uiIcon(name: string): SVGSVGElement {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.classList.add("ui-icon");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `/assets/icons.svg#${name}`);
  icon.append(use);
  return icon;
}

function buttonAppearance(
  node: HTMLElement,
  options: ButtonOptions,
  fallback: ButtonVariant,
) {
  const variant = options.purpose
    ? buttonVariants[options.purpose]
    : (options.variant ?? fallback);
  node.dataset.variant = variant;
  node.dataset.size = options.size ?? "auto";
  node.classList.add(variant);
  if (options.purpose) node.dataset.purpose = options.purpose;
  if (options.selectable) node.classList.add("selection-button");
  return node;
}

export function textButton(
  label: string,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const button = element("button", "", label);
  buttonAppearance(button, options, buttonVariants.entry);
  button.type = "button";
  return button;
}

export function actionButton(
  label: string,
  icon: string,
  options: ButtonOptions | ButtonVariant = {},
): HTMLButtonElement {
  const config = typeof options === "string" ? { variant: options } : options;
  const button = textButton("", config);
  button.append(uiIcon(icon), element("span", "", label));
  return button;
}

export function iconButton(
  label: string,
  icon: string,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const button = element("button", "tool-button");
  buttonAppearance(button, options, buttonVariants.quiet);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(uiIcon(icon));
  return button;
}

/** 버튼 모양의 외부 링크도 같은 variant·크기·상태 규칙을 사용한다. */
export function buttonLink(
  href: string,
  label: string,
  icon: string,
  options: ButtonOptions = { purpose: "utility" },
) {
  const link = externalLink(href, "", "button-link");
  buttonAppearance(link, options, buttonVariants.utility);
  link.append(uiIcon(icon), element("span", "", label));
  return link;
}

/** 배치만 공유하고 nav·tablist·footer 등 호출자의 의미와 동작은 보존한다. */
export function buttonGroup<T extends HTMLElement>(
  root: T,
  options: ButtonGroupOptions = {},
): T {
  root.classList.add("button-group");
  root.dataset.size = options.size ?? "auto";
  root.dataset.groupCompact = String(options.compact ?? false);
  root.dataset.groupWrap = String(options.wrap ?? true);
  root.dataset.groupSurface = String(options.surface ?? false);
  return root;
}

export function externalLink(
  href: string,
  label = "",
  className = "",
): HTMLAnchorElement {
  const link = element("a", className, label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}
