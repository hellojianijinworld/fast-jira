import type { Issue } from "../domain/issue.ts";
import type { MentionTarget } from "../domain/mention.ts";
import type { Api } from "./api.ts";
/** 작성 중일 때만 조회한다. 프로젝트 사용자 조회는 같은 편집 세션에서 공유한다. */
export function createMentionSource(
  api: Pick<Api, "issues"> & Partial<Pick<Api, "mentionUsers" | "users">>,
  options: {
    site: string;
    projects: () => readonly string[];
    issue?: () => string;
    local?: () => readonly Issue[];
  },
) {
  let userScope = "",
    users: ReturnType<Api["users"]> | undefined;
  return async (query: string): Promise<MentionTarget[]> => {
    const projects = [...options.projects()],
      key = options.issue?.() ?? "",
      q = query.toLocaleLowerCase();
    const people =
      key && api.mentionUsers
        ? api.mentionUsers(key, query)
        : (() => {
            const scope = [...projects].sort().join(",");
            if (!users || scope !== userScope) {
              userScope = scope;
              users = api.users
                ? api.users(projects).catch((error) => {
                    if (userScope === scope) users = undefined;
                    throw error;
                  })
                : Promise.resolve([]);
            }
            return users;
          })();
    const local = (options.local?.() ?? []).filter((issue) =>
      `${issue.key} ${issue.summary}`.toLocaleLowerCase().includes(q),
    );
    const found =
      query.length >= 2 || !local.length
        ? api
            .issues(
              {
                projects,
                scope: "all",
                excludeDone: false,
                sort: "updated",
                statuses: null,
                assignees: null,
                q: query,
              },
              "",
              10,
            )
            .then((page) => page.issues)
        : Promise.resolve([]);
    const [userResult, issueResult] = await Promise.allSettled([people, found]);
    if (userResult.status === "rejected" && issueResult.status === "rejected")
      throw userResult.reason;
    const items = new Map(
      [
        ...local,
        ...(issueResult.status === "fulfilled" ? issueResult.value : []),
      ].map((issue) => [issue.key, issue]),
    );
    return [
      ...[...items.values()].slice(0, 10).map(
        (issue): MentionTarget => ({
          kind: "issue",
          id: issue.id || issue.key,
          key: issue.key,
          label: issue.summary,
          url: `https://${options.site}/browse/${encodeURIComponent(issue.key)}`,
        }),
      ),
      ...(userResult.status === "fulfilled" ? userResult.value : [])
        .filter((user) => user.name.toLocaleLowerCase().includes(q))
        .slice(0, 10)
        .map(
          (user): MentionTarget => ({
            kind: "user",
            id: user.id,
            label: user.name,
            avatar: user.avatar,
          }),
        ),
    ];
  };
}
