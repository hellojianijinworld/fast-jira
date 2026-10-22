import { iconButton } from "./dom.ts";

export function updateFavoriteButton(
  button: HTMLButtonElement,
  selected: boolean,
) {
  const label = selected ? "즐겨찾기 해제" : "즐겨찾기 추가";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(selected));
}

export function favoriteButton(
  selected: boolean,
  changed: (selected: boolean) => void,
) {
  const button = iconButton("즐겨찾기 추가", "star");
  button.classList.add("favorite-button");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    selected = button.getAttribute("aria-pressed") !== "true";
    updateFavoriteButton(button, selected);
    changed(selected);
  });
  updateFavoriteButton(button, selected);
  return button;
}
