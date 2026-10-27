import type { ButtonOptions, ButtonVariant } from "./theme.ts";

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

export function actionButton(
  label: string,
  icon: string,
  options: ButtonOptions | ButtonVariant | "" = {},
): HTMLButtonElement {
  const config =
    typeof options === "string" ? { variant: options || "primary" } : options;
  const variant = config.variant ?? "secondary";
  const button = element("button", variant);
  button.dataset.variant = variant;
  button.dataset.size = config.size ?? "auto";
  button.type = "button";
  button.append(uiIcon(icon), element("span", "", label));
  return button;
}

export function iconButton(
  label: string,
  icon: string,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const button = element("button", "tool-button");
  button.dataset.variant = options.variant ?? "ghost";
  button.dataset.size = options.size ?? "auto";
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(uiIcon(icon));
  return button;
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
