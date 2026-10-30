import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { feedbackKinds, feedbackUrl } from "../src/domain/product.ts";

test("공개 문의는 존재하는 GitHub 양식으로 연결하고 제품 버전 외의 정보를 첨부하지 않는다", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  for (const kind of feedbackKinds) {
    const url = new URL(feedbackUrl(kind.id));
    assert.equal(url.origin, "https://github.com");
    assert.equal(url.pathname, "/hellojianijinworld/fast-jira/issues/new");
    const template = url.searchParams.get("template");
    assert.ok(template);
    await access(`.github/ISSUE_TEMPLATE/${template}`);
    assert.deepEqual([...url.searchParams.keys()].sort(), [
      "template",
      "version",
    ]);
    assert.equal(url.searchParams.get("version"), pkg.version);
  }
});
