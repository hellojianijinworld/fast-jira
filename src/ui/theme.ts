/** auto는 부모의 크기를 상속하며 화면의 기본 밀도만 폭에 따라 바뀐다. */
export type ComponentSize = "auto" | "sm" | "md";
export type ButtonVariant = "primary" | "subtle" | "outline" | "ghost";
export type ButtonPurpose =
  | "confirm"
  | "entry"
  | "quiet"
  | "utility"
  | "danger";
export type ButtonOptions = {
  size?: ComponentSize;
  selectable?: boolean;
} & (
  | { purpose: ButtonPurpose; variant?: never }
  | { purpose?: never; variant?: ButtonVariant }
);

/** 화면은 행동 역할을 지정하고, 역할별 시각적 강도는 여기서 결정한다. */
export const buttonVariants: Record<ButtonPurpose, ButtonVariant> = {
  confirm: "primary",
  entry: "subtle",
  quiet: "ghost",
  utility: "outline",
  danger: "ghost",
};

export interface ButtonGroupOptions {
  surface?: boolean;
  size?: ComponentSize;
  compact?: boolean;
  wrap?: boolean;
}
