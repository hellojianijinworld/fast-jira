import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdfDocument } from "../src/domain/adf.ts";
import { unembeddedImages } from "../src/domain/attachments.ts";
import type { Attachment } from "../src/domain/details.ts";

const file = (
  id: string,
  name: string,
  mimeType = "image/png",
): Attachment => ({
  id,
  name,
  mimeType,
  size: 10,
  url: `https://example.atlassian.net/rest/api/3/attachment/content/${id}`,
});
const body: AdfDocument = {
  type: "doc",
  version: 1,
  content: [
    {
      type: "mediaSingle",
      content: [{ type: "media", attrs: { alt: "본문.png" } }],
    },
  ],
};
test("중첩 본문에 삽입된 이미지와 일반 파일을 제외한다", () => {
  const files = [
    file("1", "본문.png"),
    file("2", "추가.png"),
    file("3", "설계.pdf", "application/pdf"),
  ];
  assert.deepEqual(
    unembeddedImages(body, files).map((item) => item.id),
    ["2"],
  );
  assert.equal(files.length, 3);
});
test("본문이 없거나 파일명을 글로 언급한 경우 첨부 이미지를 숨기지 않는다", () => {
  const files = [file("1", "설계.png")];
  assert.deepEqual(unembeddedImages(null, files), files);
  assert.deepEqual(
    unembeddedImages(
      {
        type: "doc",
        version: 1,
        content: [{ type: "text", text: "설계.png" }],
      },
      files,
    ),
    files,
  );
});
test("이름이 같은 이미지들은 별도 파일로 남겨 잘못 숨기지 않는다", () => {
  const files = [file("1", "본문.png"), file("2", "본문.png")];
  assert.deepEqual(
    unembeddedImages(body, files).map((item) => item.id),
    ["1", "2"],
  );
});
