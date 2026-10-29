import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { basename, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type AdfDocument, decodeAdfDocument } from "../domain/adf.ts";
import type { PeopleFilter } from "../domain/issue.ts";
import { record } from "../domain/validation.ts";
import { AppUpdateError, type AppUpdater } from "./app-update.ts";
import type { AssistantService } from "./assistant-service.ts";
import type { Connection } from "./connection.ts";
import { JiraError } from "./jira-client.ts";
import type { BrowseOptions } from "./jira-query.ts";
import type { JiraService } from "./jira-service.ts";
import type { createMcpEndpoint } from "./mcp-server.ts";

const invalid = (message: string) => new JiraError(message, 400);
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "요청에 실패했습니다.";
function inputString(value: unknown, name: string): string {
  if (typeof value !== "string") throw invalid(`${name} 값을 입력하세요.`);
  return value;
}
function documentInput(value: unknown): AdfDocument {
  try {
    return decodeAdfDocument(value);
  } catch (error) {
    throw invalid(messageOf(error));
  }
}
function browseOptions(params: URLSearchParams): BrowseOptions {
  const scope = params.get("scope") ?? "all";
  if (scope !== "all" && scope !== "assigned" && scope !== "related")
    throw invalid("필터가 올바르지 않습니다.");
  const done = params.get("excludeDone") ?? "false";
  if (done !== "true" && done !== "false")
    throw invalid("완료 제외 값이 올바르지 않습니다.");
  return {
    q: params.get("q")?.trim() ?? "",
    projects: params.get("projects") ?? params.get("project") ?? "",
    scope,
    excludeDone: done === "true",
    statuses: params.get("statuses") ?? "",
    assignees: params.get("assignees") ?? "",
  };
}
async function requestInput(
  req: IncomingMessage,
  limit: number,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const input: unknown = chunk;
    if (!Buffer.isBuffer(input) && typeof input !== "string")
      throw invalid("요청 형식이 올바르지 않습니다.");
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
    size += bytes.length;
    if (size > limit) throw invalid("요청이 너무 큽니다.");
    chunks.push(bytes);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return record(value);
  } catch {
    throw invalid("JSON 객체를 입력하세요.");
  }
}
function json(res: ServerResponse, data: unknown, status = 200): void {
  res
    .writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
    .end(JSON.stringify(data));
}
export function createHttpServer(
  source: JiraService | (() => JiraService),
  frontendOrigin = "http://127.0.0.1:5173",
  connection?: Connection,
  assistant?: AssistantService,
  updates?: AppUpdater,
  local?: { mcp: ReturnType<typeof createMcpEndpoint>; origin?: string },
) {
  const getService = () => (typeof source === "function" ? source() : source);
  const key = (value: unknown) => {
    try {
      return getService().issueKey(value);
    } catch (error) {
      throw invalid(messageOf(error));
    }
  };
  async function readData(url: URL) {
    const service = getService();
    const params = url.searchParams;
    const issueKey = () => key(params.get("key") ?? "");
    switch (url.pathname) {
      case "/api/create-types":
        return service.creationTypes(params.get("project") ?? "");
      case "/api/create-users":
        return service.creationUsers(
          params.get("project") ?? "",
          params.get("type") ?? "",
          params.get("field") ?? "",
        );
      case "/api/create-metadata":
        return service.creationMetadata(
          params.get("project") ?? "",
          params.get("type") ?? "",
        );
      case "/api/create-parents":
        return service.creationParents(
          params.get("project") ?? "",
          params.get("type") ?? "",
          params.get("q") ?? "",
          params.get("pageToken") ?? "",
        );
      case "/api/parent-options":
        return service.parentOptions(
          (params.get("keys") ?? "").split(",").filter(Boolean),
          params.get("q") ?? "",
          params.get("pageToken") ?? "",
        );
      case "/api/projects": {
        const [projects, me, priorities] = await Promise.all([
          service.projects(),
          service.currentUser(true),
          service.priorities(),
        ]);
        return {
          site: service.site,
          projects,
          priorities,
          me: { accountId: me.accountId, displayName: me.displayName },
        };
      }
      case "/api/issue-types":
        return service.projectTypes(params.get("projects") ?? "");
      case "/api/statuses":
        return service.projectStatuses(params.get("projects") ?? "");
      case "/api/assignees":
        return service.filterUsers(params.get("projects") ?? "");
      case "/api/issues":
        return service.browse(
          browseOptions(params),
          params.get("sort") ?? "recent",
          params.get("pageToken") ?? "",
          Number(params.get("pageSize") ?? 30),
        );
      case "/api/activity":
        return service.activity(params.get("projects") ?? "");
      case "/api/changes":
        return service.recentChanges(
          browseOptions(params),
          Number(params.get("lookback") ?? 5),
        );
      case "/api/children": {
        const people = params.get("people") ?? "all";
        if (!["all", "mine", "assigned", "related"].includes(people))
          throw invalid("하위 담당자 조건이 올바르지 않습니다.");
        return service.childrenPage(
          issueKey(),
          browseOptions(params),
          people as PeopleFilter,
          params.get("sort") ?? "recent",
          params.get("pageToken") ?? "",
          Number(params.get("pageSize") ?? 25),
        );
      }
      case "/api/matches":
        return params.has("keys")
          ? service.matchesIssues(
              (params.get("keys") ?? "").split(","),
              browseOptions(params),
              (params.get("parents") ?? "").split(",").filter(Boolean),
            )
          : service.matchesIssue(issueKey(), browseOptions(params));
      case "/api/ancestors":
        return service.ancestorPath(issueKey());
      case "/api/issue":
        return service.lookup(issueKey());
      case "/api/detail":
        return service.detail(issueKey());
      case "/api/issue-children":
        return service.directChildren(issueKey());
      case "/api/options":
        return service.editOptions(issueKey());
      case "/api/transitions":
        return service.transitionOptions(issueKey());
      case "/api/participant-options":
        return service.participantOptions(issueKey());
      case "/api/participant-users":
        return service.participantUsers(
          issueKey(),
          params.get("field") ?? "",
          params.get("q")?.trim() ?? "",
        );
      case "/api/priority-options":
        return service.priorityOptions(issueKey());
      case "/api/comments":
        return service.comments(issueKey(), Number(params.get("startAt") ?? 0));
      case "/api/history":
        return service.history(
          issueKey(),
          params.has("before") ? Number(params.get("before")) : null,
        );
      case "/api/mention-users":
        return service.mentionUsers(issueKey(), params.get("q")?.trim() ?? "");
      default:
        throw new JiraError("조회 경로를 찾지 못했습니다.", 404);
    }
  }
  async function writeData(path: string, input: Record<string, unknown>) {
    if (path === "/api/connection" && connection) return connection.save(input);
    if (path === "/api/app-update/check" && updates) {
      if (typeof input.force !== "boolean")
        throw new AppUpdateError("확인 요청 형식이 올바르지 않습니다.", 400);
      return updates.check(input.force);
    }
    if (path === "/api/app-update/install" && updates)
      return updates.install(input);
    const service = getService();
    const string = (name: string) => inputString(input[name], name);
    const keys = () => {
      if (!Array.isArray(input.keys)) throw invalid("이슈 목록을 입력하세요.");
      return input.keys.map((value) => inputString(value, "이슈 키"));
    };
    switch (path) {
      case "/api/create-issue":
        return service.createIssue(input.draft, string("requestId"));
      case "/api/sync":
        return service.sync(
          browseOptions(new URLSearchParams(string("query"))),
          input,
        );
      case "/api/bulk-options":
        return service.bulk.options(keys(), string("field"));
      case "/api/bulk-update":
        return service.bulk.apply(keys(), string("field"), string("value"));
      case "/api/bulk-undo":
        return service.bulk.undo(string("token"));
      case "/api/update":
        return service.update(
          key(input.key),
          string("field"),
          string("value"),
          input.expected === undefined ? undefined : string("expected"),
        );
      case "/api/participants":
        return service.updateParticipants(key(input.key), input.changes);
      case "/api/description":
        return service.updateDescription(
          key(input.key),
          documentInput(input.description),
        );
      case "/api/comment-edit":
        return service.editComment(
          key(input.key),
          string("id"),
          documentInput(input.document),
        );
      case "/api/comment":
        return service.addComment(key(input.key), {
          ...(input.text === undefined ? {} : { text: string("text") }),
          ...(input.document === undefined
            ? {}
            : { document: documentInput(input.document) }),
          ...(input.parentId === undefined
            ? {}
            : { parentId: string("parentId") }),
        });
      default:
        throw new JiraError("변경 경로를 찾지 못했습니다.", 404);
    }
  }
  const staticRoot = fileURLToPath(
    new URL("../../dist/client/", import.meta.url),
  );
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const hosts = [
        `127.0.0.1:${req.socket.localPort}`,
        `localhost:${req.socket.localPort}`,
        new URL(frontendOrigin).host,
        ...(local?.origin ? [new URL(local.origin).host] : []),
      ];
      if (!hosts.includes(req.headers.host ?? ""))
        throw new JiraError("허용되지 않은 로컬 주소입니다.", 403);
      if (url.pathname === "/mcp" && local) {
        await local.mcp.handle(req, res);
        return;
      }
      if (
        req.method === "GET" &&
        url.pathname === "/api/app-update/status" &&
        updates
      ) {
        json(res, await updates.status());
        return;
      }
      if (
        req.method === "GET" &&
        url.pathname === "/api/assistant/approvals" &&
        assistant
      ) {
        json(
          res,
          assistant.approvals.pending(url.searchParams.get("requestId")),
        );
        return;
      }
      if (
        req.method === "GET" &&
        url.pathname === "/api/assistant/status" &&
        assistant
      ) {
        json(res, await assistant.status());
        return;
      }
      if (
        req.method === "GET" &&
        url.pathname === "/api/assistant/voice/events" &&
        assistant
      ) {
        const unsubscribe = assistant.voice.subscribe(
          url.searchParams.get("id") ?? "",
          (event) => {
            if (!res.headersSent)
              res.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-store",
                Connection: "keep-alive",
              });
            if (!res.destroyed) {
              res.write(`data: ${JSON.stringify(event)}\n\n`);
              if (event.ended) res.end();
            }
          },
        );
        res.once("close", unsubscribe);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        json(res, {
          app: "fast-jira",
          pid: process.pid,
          instance: process.env.FAST_JIRA_INSTANCE ?? "",
        });
        return;
      }
      if (
        req.method === "GET" &&
        url.pathname === "/api/connection/status" &&
        connection
      ) {
        json(res, connection.status());
        return;
      }
      if (
        req.method === "GET" &&
        url.pathname === "/api/connection" &&
        connection
      ) {
        json(res, connection.settings());
        return;
      }
      if (
        req.method === "GET" &&
        (url.pathname === "/api/image" || url.pathname === "/api/type-icon")
      ) {
        const service = getService();
        const icon = url.pathname === "/api/type-icon";
        const file = icon
          ? await service.typeIcon(url.searchParams.get("url") ?? "")
          : await service.image(
              key(url.searchParams.get("key") ?? ""),
              url.searchParams.get("name") ?? "",
            );
        if (icon) {
          res.setHeader("Cache-Control", "public, max-age=3600");
          res.setHeader(
            "Content-Security-Policy",
            "default-src 'none'; sandbox",
          );
        }
        res
          .writeHead(200, {
            "Content-Type": file.mimeType,
            "Content-Length": file.bytes.length,
          })
          .end(file.bytes);
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/")) {
        json(res, await readData(url));
        return;
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        // Vite의 화면 Origin과 동일 포트의 배포 화면만 쓰기를 허용한다. 토큰은 서버에 남는다.
        const localOrigin = `http://127.0.0.1:${req.socket.localPort}`;
        if (
          ![
            localOrigin,
            `http://localhost:${req.socket.localPort}`,
            frontendOrigin,
            ...(local?.origin ? [local.origin] : []),
          ].includes(req.headers.origin ?? "") ||
          !req.headers["content-type"]?.startsWith("application/json")
        )
          throw new JiraError("로컬 화면에서 JSON으로 요청하세요.", 403);
        const input = await requestInput(
          req,
          url.pathname === "/api/sync"
            ? 2000000
            : ["/api/assistant/run", "/api/assistant/voice/start"].includes(
                  url.pathname,
                )
              ? 120000
              : [
                    "/api/create-issue",
                    "/api/description",
                    "/api/comment",
                    "/api/comment-edit",
                  ].includes(url.pathname)
                ? 500000
                : 20000,
        );
        if (url.pathname === "/api/assistant/voice/stop" && assistant) {
          if (typeof input.id !== "string")
            throw invalid("음성 연결을 확인하세요.");
          assistant.voice.stop(input.id);
          json(res, {});
        } else if (url.pathname === "/api/assistant/voice/start" && assistant) {
          const controller = new AbortController();
          const cancel = () => {
            if (!res.writableEnded) controller.abort();
          };
          res.once("close", cancel);
          try {
            json(res, await assistant.voice.start(input, controller.signal));
          } finally {
            res.off("close", cancel);
          }
        } else if (url.pathname === "/api/assistant/approve" && assistant) {
          assistant.approvals.respond(input);
          json(res, {});
        } else if (url.pathname === "/api/assistant/run" && assistant) {
          const controller = new AbortController();
          const started = Date.now();
          const trace = {
            requestId:
              typeof input.requestId === "string" &&
              /^[a-f0-9]{32}$/.test(input.requestId)
                ? input.requestId
                : undefined,
            pid: process.pid,
            startedAt: new Date(started).toISOString(),
          };
          let outcome = "failed";
          console.info(
            "Fast Jira AI",
            JSON.stringify({ ...trace, event: "started" }),
          );
          const cancel = () => {
            if (!res.writableEnded) {
              outcome = "connection-closed";
              controller.abort();
            }
          };
          res.once("close", cancel);
          try {
            const reply = await assistant.run(input, controller.signal);
            if (!res.destroyed) {
              json(res, reply);
              outcome = "completed";
            }
          } finally {
            res.off("close", cancel);
            console.info(
              "Fast Jira AI",
              JSON.stringify({
                ...trace,
                event: outcome,
                elapsedMs: Date.now() - started,
              }),
            );
          }
        } else json(res, await writeData(url.pathname, input));
        return;
      }
      if (
        (req.method === "GET" || req.method === "HEAD") &&
        (url.pathname === "/" || url.pathname.startsWith("/assets/"))
      ) {
        const path = resolve(
          staticRoot,
          "." +
            decodeURIComponent(
              url.pathname === "/" ? "/index.html" : url.pathname,
            ),
        );
        if (!path.startsWith(resolve(staticRoot) + sep))
          throw new JiraError("파일 경로를 찾지 못했습니다.", 404);
        const types: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".json": "application/json; charset=utf-8",
          ".png": "image/png",
        };
        const type = types[extname(path)];
        if (!type) throw new JiraError("파일을 찾지 못했습니다.", 404);
        const body = await readFile(path).catch(() => {
          throw new JiraError(
            "빌드 파일을 찾지 못했습니다. npm run build를 실행하세요.",
            404,
          );
        });
        // 빌드 해시가 붙은 이모지 데이터는 HEAD로 변경 여부만 확인한다.
        if (/^data-[\w-]+\.json$/.test(basename(path))) {
          res.setHeader("ETag", `"${basename(path)}"`);
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
        res
          .writeHead(200, {
            "Content-Type": type,
            "Content-Length": body.length,
          })
          .end(req.method === "HEAD" ? undefined : body);
        return;
      }
      throw new JiraError("경로를 찾지 못했습니다.", 404);
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.end();
        return;
      }
      json(
        res,
        { error: messageOf(error) },
        error instanceof JiraError || error instanceof AppUpdateError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 502,
      );
    }
  });
}
