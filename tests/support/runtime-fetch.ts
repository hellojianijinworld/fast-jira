// 실제 Jira에 접속하지 않고 실행·인증 검사에 필요한 응답만 반환한다.
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (options?.method && options.method !== "GET")
    throw new Error("검사에서 Jira 쓰기를 허용하지 않습니다.");
  if (url.hostname !== "example.atlassian.net")
    throw new Error("예상하지 못한 모의 Jira 요청");
  if (
    new Headers(options?.headers)
      .get("Authorization")
      ?.includes(
        Buffer.from("test@example.com:invalid-token").toString("base64"),
      )
  )
    return Response.json({}, { status: 401 });
  if (url.pathname === "/rest/api/3/myself")
    return Response.json({
      accountId: "test-account",
      displayName: "실행 검사",
    });
  if (
    ["/rest/api/3/project/search", "/rest/api/3/priority/search"].includes(
      url.pathname,
    )
  )
    return Response.json({ values: [], isLast: true });
  throw new Error("예상하지 못한 모의 Jira 요청");
};
