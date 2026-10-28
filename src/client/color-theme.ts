import type { Preferences } from "./preferences.ts";

export function applyColorTheme(
  theme: Preferences["theme"],
  systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches,
  root = document.documentElement,
): void {
  root.dataset.themePreference = theme;
  root.dataset.theme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export function updateSystemTheme(
  systemDark: boolean,
  root = document.documentElement,
): void {
  if (root.dataset.themePreference === "system")
    applyColorTheme("system", systemDark, root);
}
