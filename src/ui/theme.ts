/** auto는 부모의 크기를 상속하며 화면의 기본 밀도만 폭에 따라 바뀐다. */
export type ComponentSize = "auto" | "sm" | "md";
export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";
export interface ButtonOptions {
  size?: ComponentSize;
  variant?: ButtonVariant;
}
