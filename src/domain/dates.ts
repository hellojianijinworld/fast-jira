export type DateValue = string | Date;
const pad = (value: number) => String(value).padStart(2, "0");

export function reportedTime(
  value: DateValue | null | undefined,
  now = new Date(),
): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, (now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "방금 전";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}일 전`;
  const day = `${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
  return date.getFullYear() === now.getFullYear()
    ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    : `${String(date.getFullYear()).slice(-2)}.${day}`;
}

export function dateLabel(
  value: string,
  due = false,
  now = new Date(),
): string {
  if (!value) return "없음";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  // 마감일은 경과 시간이 아니다. 자정·일광절약시간 경계에서도 달력 날짜끼리 비교한다.
  const day = (current: Date) =>
    Date.UTC(current.getFullYear(), current.getMonth(), current.getDate()) /
    86400000;
  const difference = day(date) - day(now);
  const absolute = `${date.getMonth() + 1}월 ${date.getDate()}일`;
  let relative: string;
  if (due) {
    relative =
      difference === 0
        ? "오늘"
        : difference === 1
          ? "내일"
          : difference === -1
            ? "어제 마감"
            : difference > 0
              ? `${difference}일 남음`
              : `${-difference}일 지남`;
  } else if (difference === 0) {
    const minutes = Math.max(
      0,
      Math.floor((now.getTime() - date.getTime()) / 60000),
    );
    relative =
      minutes < 1
        ? "방금"
        : minutes < 60
          ? `${minutes}분 전`
          : `${Math.floor(minutes / 60)}시간 전`;
  } else if (difference === -1) relative = "어제";
  else if (difference < 0) {
    const days = -difference;
    relative =
      days < 7
        ? `${days}일 전`
        : days < 30
          ? `${Math.floor(days / 7)}주 전`
          : days < 365
            ? `${Math.floor(days / 30)}개월 전`
            : `${Math.floor(days / 365)}년 전`;
  } else relative = difference === 1 ? "내일" : `${difference}일 후`;
  return `${absolute} · ${relative}`;
}
