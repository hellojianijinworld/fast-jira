import { decodeAdfDocument } from "../domain/adf.ts";
import type {
  Attachment,
  IssueDetails,
  LookupResult,
} from "../domain/details.ts";
import { parseIssueKey, record, requiredString } from "../domain/validation.ts";
import { createPromiseCache } from "./cache.ts";
import {
  ensureJiraResponse,
  type JiraClient,
  JiraError,
} from "./jira-client.ts";
import {
  arrayValue,
  avatarValue,
  decodeIssue,
  numberValue,
  optionalRecord,
  stringValue,
} from "./jira-decode.ts";
import type { createJiraMetadata } from "./jira-metadata.ts";

export interface BinaryAsset {
  bytes: Buffer;
  mimeType: string;
}
export function createJiraRead(
  client: JiraClient,
  metadata: ReturnType<typeof createJiraMetadata>,
  site: string,
) {
  const attachments = createPromiseCache<Attachment[]>();
  const icons = createPromiseCache<BinaryAsset>();
  const pathFor = (key: string) =>
    `/rest/api/3/issue/${parseIssueKey(key, "")}`;
  function decodeAttachments(value: unknown): Attachment[] {
    return (value == null ? [] : arrayValue(value)).map((value) => {
      const file = record(value);
      const id = requiredString(file.id, "첨부 ID");
      if (!/^\d+$/.test(id))
        throw new Error("첨부 ID 형식이 올바르지 않습니다.");
      return {
        id,
        name: requiredString(file.filename, "첨부 이름"),
        mimeType: requiredString(file.mimeType, "첨부 형식"),
        size: numberValue(file.size),
        url: `https://${site}/rest/api/3/attachment/content/${id}`,
      };
    });
  }
  function item(value: unknown): IssueDetails {
    const fields = record(record(value).fields),
      reporter = optionalRecord(fields.reporter);
    const issue = decodeIssue(value);
    return {
      ...issue,
      reporter: stringValue(reporter.displayName),
      reporterAvatar: avatarValue(reporter.avatarUrls),
      created: stringValue(fields.created),
      description:
        fields.description == null
          ? null
          : decodeAdfDocument(fields.description),
      attachments: decodeAttachments(fields.attachment),
      url: `https://${site}/browse/${issue.key}`,
    };
  }
  async function lookup(key: string): Promise<LookupResult> {
    key = parseIssueKey(key, "");
    const parent = await client.json(
      `${pathFor(key)}?fields=summary,description,status,assignee,reporter,created,duedate,attachment,comment,issuetype,priority,subtasks,updated,project,parent`,
      item,
    );
    // 본문에 이미지가 여러 개 있어도 방금 받은 첨부 정보를 재사용해 목록 요청을 늘리지 않는다.
    attachments.prime(key, parent.attachments);
    await metadata.withDefaultPriorities([parent]);
    return {
      parent,
      children: [],
      deferredChildren: true,
      dateEditing: true,
      imageEnabled: true,
    };
  }
  async function detail(key: string): Promise<IssueDetails> {
    const issue = await client.json(
      `${pathFor(key)}?fields=summary,status,assignee,reporter,created,duedate,issuetype,priority,updated,project,parent,comment,subtasks`,
      item,
    );
    await metadata.withDefaultPriorities([issue]);
    return issue;
  }
  async function image(key: string, name: string): Promise<BinaryAsset> {
    key = parseIssueKey(key, "");
    if (!name || name.length > 255)
      throw new JiraError("이미지 이름이 올바르지 않습니다.", 400);
    const files = await attachments(key, () =>
      client.json(`${pathFor(key)}?fields=attachment`, (value) =>
        decodeAttachments(record(record(value).fields).attachment),
      ),
    );
    // ponytail: ADF의 파일 이름으로 연결한다. 같은 이름이 중복되면 Media API 연결로 확장한다.
    const file = files.find((file) => file.name === name);
    if (!file || !/^image\/(png|jpeg|gif|webp|avif)$/.test(file.mimeType))
      throw new JiraError("이미지를 찾지 못했습니다.", 404);
    const limit = 20 * 1024 * 1024;
    if (file.size > limit)
      throw new JiraError(
        "20MB보다 큰 이미지는 원본 Jira에서 확인하세요.",
        413,
      );
    const response = await ensureJiraResponse(
      await client.request(
        `/rest/api/3/attachment/content/${file.id}?redirect=false`,
      ),
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new JiraError("이미지가 너무 큽니다.", 413);
    return { bytes, mimeType: file.mimeType };
  }
  async function typeIcon(value: string): Promise<BinaryAsset> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new JiraError("아이콘 주소가 올바르지 않습니다.", 400);
    }
    if (
      url.protocol !== "https:" ||
      url.host !== site ||
      !/^(\/rest\/api\/[23]\/universal_avatar\/view\/type\/(issuetype|project|priority)\/avatar\/\d+|\/secure\/(viewavatar|projectavatar)|\/images\/icons\/(issuetypes|priorities)\/[^/]+)$/.test(
        url.pathname,
      )
    )
      throw new JiraError("아이콘 주소가 올바르지 않습니다.", 400);
    return icons(url.href, async () => {
      const response = await ensureJiraResponse(
        await client.request(url.pathname + url.search, {
          signal: AbortSignal.timeout(10000),
        }),
      );
      const mimeType =
        response.headers.get("content-type")?.split(";")[0] ?? "";
      const limit = 262144;
      if (
        ![
          "image/svg+xml",
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp",
        ].includes(mimeType) ||
        Number(response.headers.get("content-length")) > limit
      )
        throw new Error("아이콘 형식이 올바르지 않습니다.");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > limit) throw new Error("아이콘이 너무 큽니다.");
      return { bytes, mimeType };
    });
  }
  return { lookup, detail, image, typeIcon };
}
