import type { Issue } from "../domain/issue.ts";
import { parseIssueKey, record } from "../domain/validation.ts";
import { createPromiseCache } from "./cache.ts";
import { type JiraClient, JiraError } from "./jira-client.ts";
import { arrayValue, decodeIssue, stringValue } from "./jira-decode.ts";
import type { createJiraMetadata } from "./jira-metadata.ts";

/** 선택 이슈는 한 번에 읽고 후보는 실제 상위 유형 ID로 검색한다. */
export function createParentOptions(
  client: JiraClient,
  metadata: ReturnType<typeof createJiraMetadata>,
) {
  const sources = createPromiseCache<Issue[]>();
  return async (input: string[], query = "", token = "") => {
    if (
      !input.length ||
      input.length > 50 ||
      query.length > 200 ||
      /[\r\n]/.test(query)
    )
      throw new JiraError("이슈 1~50개와 한 줄 검색어를 입력하세요.", 400);
    const keys = [
      ...new Set(input.map((key) => parseIssueKey(key, ""))),
    ].sort();
    const search = (jql: string, pageToken = "") =>
      client.json(
        `/rest/api/3/search/jql?${new URLSearchParams({ jql, fields: "summary,project,issuetype,parent,status", maxResults: "50", ...(pageToken ? { nextPageToken: pageToken } : {}) })}`,
        (value) => ({
          issues: arrayValue(record(value).issues).map((value) =>
            decodeIssue(value),
          ),
          nextPageToken: stringValue(record(value).nextPageToken) || null,
        }),
      );
    const selected = await sources(
      keys.join(","),
      async () => (await search(`key in (${keys.join(", ")})`)).issues,
    );
    const first = selected[0];
    if (
      !first ||
      selected.length !== keys.length ||
      selected.some((issue) => issue.project !== first.project)
    )
      throw new JiraError(
        "조회 가능한 같은 프로젝트의 이슈를 선택하세요.",
        400,
      );
    const types = await metadata.projectTypes(first.project);
    const level = (issue: Issue) =>
      issue.hierarchyLevel ??
      types.find((type) => type.id === issue.issueTypeId)?.hierarchyLevel ??
      null;
    const sourceLevel = level(first);
    if (
      sourceLevel === null ||
      selected.some((issue) => level(issue) !== sourceLevel)
    )
      throw new JiraError(
        "같은 계층의 이슈만 함께 부모를 선택할 수 있어요.",
        400,
      );
    const ids = types
      .filter((type) => type.hierarchyLevel === sourceLevel + 1)
      .map((type) => type.id);
    const canClear = sourceLevel >= 0;
    if (!ids.length) return { issues: [], nextPageToken: null, canClear };
    if (ids.some((id) => !/^\d{1,20}$/.test(id)))
      throw new JiraError("Jira 유형 ID를 확인하지 못했어요.", 502);
    let filter = "";
    if (query.trim()) {
      const text = `summary ~ ${JSON.stringify(query.trim())}`;
      filter = /^([A-Z][A-Z0-9_]*-\d+)$/i.test(query.trim())
        ? ` AND (key = ${parseIssueKey(query.trim().toUpperCase(), "")} OR ${text})`
        : ` AND ${text}`;
    }
    const page = await search(
      `project = ${first.project} AND issuetype in (${ids.join(", ")}) AND key not in (${keys.join(", ")})${filter} ORDER BY updated DESC`,
      token,
    );
    return { ...page, canClear };
  };
}
