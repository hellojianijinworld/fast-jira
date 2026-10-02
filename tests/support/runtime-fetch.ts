// 실행 진입점 검사도 실제 Jira로 나가지 않도록, 인증 조회 하나만 허용한다.
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (options?.method && options.method !== "GET")
    throw new Error("검사에서 Jira 쓰기를 허용하지 않습니다.");
  if (
    url.hostname !== "example.atlassian.net" ||
    url.pathname !== "/rest/api/3/myself"
  )
    throw new Error("예상하지 못한 모의 Jira 요청");
  return Response.json({ accountId: "test-account", displayName: "실행 검사" });
};
