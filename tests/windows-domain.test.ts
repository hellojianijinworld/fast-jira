import assert from "node:assert/strict";
import { test } from "node:test";
import {
  powershellArguments,
  windowsDomainScript,
} from "../src/cli/windows-domain.ts";

test("Windows 승인 스크립트는 경로·인자를 코드로 해석하지 않고 보존한다", () => {
  const script = windowsDomainScript(
    "C:\\Jira user's folder\\node.exe",
    "C:\\app\\cli.js",
    4173,
    {
      PORTLESS_STATE_DIR: "C:\\Jira user's folder\\config",
      PORTLESS_LAN: "0",
      JIRA_API_TOKEN: "must-not-appear",
      NODE_OPTIONS: "must-not-appear",
    },
  );
  const encoded = powershellArguments(script).at(-1);
  assert(encoded);
  assert.equal(Buffer.from(encoded, "base64").toString("utf16le"), script);
  const nested = [
    ...script.matchAll(/-EncodedCommand ([A-Za-z0-9+/=]+)/g),
  ][0]?.[1];
  assert(nested);
  const child = Buffer.from(nested, "base64").toString("utf16le");
  assert(child.includes("Jira user''s folder"));
  assert(child.includes("alias fast-jira 4173"));
  assert(child.includes("$LASTEXITCODE"));
  assert(!script.includes("must-not-appear"));
  assert(!child.includes("proxy start"));
  assert(!child.includes("service install"));
  for (const port of [0, -1, 65536, 1.2, Number.NaN])
    assert.throws(() => windowsDomainScript("node", "cli", port, {}));
});
