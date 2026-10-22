import {
  ensureJiraResponse,
  type JiraClient,
  JiraError,
} from "./jira-client.ts";
import { projectKeys } from "./jira-metadata.ts";

export function createJiraActivity(client: JiraClient) {
  return async (projects: string): Promise<{ feed: string }> => {
    const keys = projectKeys(projects);
    if (!keys.length)
      return { feed: '<feed xmlns="http://www.w3.org/2005/Atom"/>' };
    const params = new URLSearchParams({
      maxResults: "10",
      streams: `key IS ${keys.join(" ")}`,
    });
    // 기존 Atom 경로는 Cloud에서도 토큰으로 읽을 수 있다. 로그인 HTML은 성공으로 취급하지 않는다.
    const response = await ensureJiraResponse(
      await client.request(`/activity?${params}`, {
        headers: { Accept: "application/atom+xml" },
      }),
    );
    if (!response.headers.get("content-type")?.includes("application/atom+xml"))
      throw new JiraError("Jira 활동 스트림 응답을 읽을 수 없습니다.", 502);
    const feed = await response.text();
    if (feed.length > 1000000)
      throw new JiraError("Jira 활동 응답이 너무 큽니다.", 502);
    return { feed };
  };
}
