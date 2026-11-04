import assert from "node:assert/strict";
import { test } from "node:test";
import {
  JIRA_CLOUD_SUFFIX,
  JIRA_SITE_NAME_PATTERN,
  jiraSiteName,
} from "../src/domain/connection.ts";

test("Jira 사이트는 저장된 주소·전체 URL·이름을 같은 사이트 이름으로 표시한다", () => {
  for (const value of [
    "my-team",
    "my-team.atlassian.net",
    "https://my-team.atlassian.net/jira/software/projects/TEST",
    "  MY-TEAM.atlassian.net/  ",
  ])
    assert.equal(jiraSiteName(value), "my-team");
  assert.equal(
    jiraSiteName("my-team") + JIRA_CLOUD_SUFFIX,
    "my-team.atlassian.net",
  );
});
test("사이트 이름은 한 DNS 레이블이며 다른 도메인·경로·빈 이름은 허용하지 않는다", () => {
  const valid = new RegExp(`^(?:${JIRA_SITE_NAME_PATTERN})$`, "v");
  for (const value of ["team", "TEAM-2", "a", "a".repeat(63)])
    assert(valid.test(jiraSiteName(value)));
  for (const value of [
    "",
    "-team",
    "team-",
    "team.name",
    "a".repeat(64),
    "team.atlassian.net.evil.test",
    "https://jira.example.com",
    "team/path",
    "team.atlassian.net@evil.test",
  ])
    assert.equal(valid.test(jiraSiteName(value)), false, value);
});
