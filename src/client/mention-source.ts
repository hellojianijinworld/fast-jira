import type { Issue } from "../domain/issue.ts";
import type { MentionLoader, MentionTarget } from "../domain/mention.ts";
import type { Api } from "./api.ts";
/** 작성 중에 로컬 후보를 먼저 표시하고 뷰와 독립된 전체 검색을 합친다. */
export function createMentionSource(
  api: Pick<Api, "issues"> & Partial<Pick<Api, "mentionUsers" | "users">>,
  options: {
    site: string;
    projects: () => readonly string[];
    issue?: () => string;
    local?: () => readonly Issue[];
  },
): MentionLoader {
  let userScope = "",
    users: ReturnType<Api["users"]> | undefined;
  return async (query, publish) => {
    const projects = [...options.projects()],
      key = options.issue?.() ?? "",
      q = query.toLocaleLowerCase();
    const items = new Map(
      (options.local?.() ?? [])
        .filter((issue) =>
          `${issue.key} ${issue.summary}`.toLocaleLowerCase().includes(q),
        )
        .slice(0, 8)
        .map((issue) => [issue.key, issue]),
    );
    let peopleItems: MentionTarget[] = [];
    const snapshot = (): MentionTarget[] => [
      ...[...items.values()].map((issue) => ({
        kind: "issue" as const,
        id: issue.id || issue.key,
        key: issue.key,
        label: issue.summary,
        url: `https://${options.site}/browse/${encodeURIComponent(issue.key)}`,
      })),
      ...peopleItems,
    ];
    publish?.(snapshot());
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
    const found = api
      .issues(
        {
          projects: [],
          scope: "all",
          excludeDone: false,
          sort: "recent",
          statuses: null,
          assignees: null,
          q: query,
        },
        "",
        20,
      )
      .then((page) => {
        for (const issue of page.issues) items.set(issue.key, issue);
        publish?.(snapshot());
        return page;
      });
    const [userResult, issueResult] = await Promise.allSettled([
      people.then((result) => {
        peopleItems = result
          .filter((user) => user.name.toLocaleLowerCase().includes(q))
          .slice(0, 10)
          .map((user) => ({
            kind: "user",
            id: user.id,
            label: user.name,
            avatar: user.avatar,
          }));
        publish?.(snapshot());
      }),
      found,
    ]);
    if (
      userResult.status === "rejected" &&
      issueResult.status === "rejected" &&
      !items.size
    )
      throw userResult.reason;
    if (issueResult.status === "rejected")
      publish?.(
        snapshot(),
        "전체 검색을 마치지 못했어요. 현재 후보는 선택할 수 있어요.",
      );
    return snapshot();
  };
}
