import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Run = (command: string, args: string[]) => Promise<void>;
export const certificateCheck = (state: string) => [
  "verify-cert",
  "-c",
  join(state, "host-certs/fast-jira_local.pem"),
  "-p",
  "ssl",
  "-s",
  "fast-jira.local",
];

export async function verifyLocalCertificate(state: string, run: Run) {
  await run("/usr/bin/security", certificateCheck(state));
  await run("/usr/bin/curl", [
    "--disable",
    "--fail",
    "--silent",
    "--show-error",
    "--max-time",
    "10",
    "--output",
    "/dev/null",
    "https://fast-jira.local/api/health",
  ]);
}

/** 셸의 관리자 권한과 별개인 인증서 승인은 사용자 GUI 세션에서 요청한다. */
export async function trustLocalCertificate(state: string, run: Run) {
  try {
    await verifyLocalCertificate(state, run);
    return;
  } catch {
    /* 처음 연결하거나 인증서가 바뀐 경우에만 승인창을 연다. */
  }
  const directory = await mkdtemp(join(tmpdir(), "fast-jira-trust-"));
  const der = join(directory, "certificate.der");
  const result = join(directory, "result.json");
  const script = join(directory, "trust.js");
  const app = join(directory, "Fast Jira 로컬 주소 설정.app");
  try {
    await run("/usr/bin/openssl", [
      "x509",
      "-in",
      join(state, "host-certs/fast-jira_local.pem"),
      "-outform",
      "der",
      "-out",
      der,
    ]);
    await run("/usr/bin/security", [
      "add-certificates",
      join(state, "host-certs/fast-jira_local.pem"),
    ]);
    await writeFile(
      script,
      `
ObjC.import('Cocoa');
ObjC.import('Security');
ObjC.bindFunction('SecCertificateCreateWithData', ['id', ['void *', 'id']]);
ObjC.bindFunction('SecPolicyCreateSSL', ['id', ['bool', 'id']]);
ObjC.bindFunction('SecTrustSettingsSetTrustSettings', ['int', ['id', 'int', 'id']]);
function run() {
  var result;
  try {
    $.NSApplication.sharedApplication.activateIgnoringOtherApps(true);
    var cert = $.SecCertificateCreateWithData(null, $.NSData.dataWithContentsOfFile(${JSON.stringify(der)}));
    var policy = $.NSMutableDictionary.alloc.init;
    policy.setObjectForKey($.SecPolicyCreateSSL(true, null), $('kSecTrustSettingsPolicy'));
    policy.setObjectForKey($(2), $('kSecTrustSettingsResult'));
    result = { status: $.SecTrustSettingsSetTrustSettings(cert, 0, $.NSArray.arrayWithObject(policy)) };
  } catch (error) { result = { error: String(error) }; }
  $(JSON.stringify(result)).writeToFileAtomicallyEncodingError(${JSON.stringify(result)}, true, $.NSUTF8StringEncoding, null);
}
`,
      { mode: 0o600 },
    );
    await run("/usr/bin/osacompile", ["-l", "JavaScript", "-o", app, script]);
    await run("/usr/bin/open", ["-W", "-n", app]);
    const approval: unknown = JSON.parse(await readFile(result, "utf8"));
    if (
      !approval ||
      typeof approval !== "object" ||
      !("status" in approval) ||
      approval.status !== 0
    )
      throw new Error("Fast Jira 로컬 주소의 인증서 승인이 완료되지 않았어요.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
