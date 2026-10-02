/** 카드·상세·댓글·일괄 링크 복사는 같은 성공/실패 안내를 사용한다. */
export async function copyText(
  text: string,
  notify: (message: string) => void = () => {},
  success = "링크를 복사했어요.",
  failure = "링크를 복사하지 못했어요.",
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify(success);
  } catch {
    notify(failure);
  }
}
