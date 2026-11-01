import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { bootstrapScripts } from "../scripts/bootstrap/generate.ts";
import { REQUIRED_NODE_VERSION } from "../src/cli/config.ts";

const execute = promisify(execFile);
/** 실제 공식 Node 다운로드 경계. GitHub 설치 도우미는 미발행 버전 대신 fixture를 쓴다. */
test("Node 없는 OS 진입점은 공식 전용 런타임을 다운로드하고 같은 실행에서 인계한다", {
  skip: process.env.FAST_JIRA_BOOTSTRAP_RUNTIME_TEST !== "1",
  timeout: 300000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "jira bootstrap 실제-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "공백 개인 폴더"),
    helper = join(root, "helper.mjs"),
    output = join(home, "handoff.json");
  const bytes = Buffer.from(
    `import {writeFileSync} from 'node:fs'; writeFileSync(process.env.BOOTSTRAP_OUTPUT, JSON.stringify({node:process.execPath,version:process.versions.node,args:process.argv.slice(2)}));`,
  );
  await writeFile(helper, bytes);
  const response = await fetch(
    `https://nodejs.org/dist/v${REQUIRED_NODE_VERSION}/SHASUMS256.txt`,
    { signal: AbortSignal.timeout(30000), redirect: "error" },
  );
  assert.equal(response.status, 200);
  const scripts = await bootstrapScripts(
    {
      version: "0.1.1",
      commit: "a".repeat(40),
      node: REQUIRED_NODE_VERSION,
      installerSha256: createHash("sha256").update(bytes).digest("hex"),
    },
    await response.text(),
  );
  const script = join(
    root,
    process.platform === "win32" ? "install.ps1" : "install.sh",
  );
  await writeFile(
    script,
    process.platform === "win32" ? scripts.ps1 : scripts.sh,
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BOOTSTRAP_OUTPUT: output,
    BOOTSTRAP_HELPER: helper,
    BOOTSTRAP_HOME: home,
    BOOTSTRAP_SCRIPT: script,
  };
  if (process.platform === "win32") {
    assert(process.env.SystemRoot);
    env.PATH = [
      join(process.env.SystemRoot, "System32"),
      process.env.SystemRoot,
      join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0"),
    ].join(delimiter);
    const wrapper = join(root, "run.ps1");
    await writeFile(
      wrapper,
      `$ErrorActionPreference='Stop'
if(Get-Command node -ErrorAction SilentlyContinue) { throw 'Global Node must be absent' }
foreach ($name in @('Get-FileHash','Expand-Archive')) {
  if (!(Get-Command $name -ErrorAction SilentlyContinue)) { throw ('Missing Windows PowerShell command: '+$name) }
}
function Invoke-WebRequest {
  param([switch]$UseBasicParsing,[string]$Uri,[string]$OutFile,[switch]$PassThru,[int]$TimeoutSec)
  if($Uri -eq 'https://github.com/hellojianijinworld/fast-jira/releases/download/v0.1.1/fast-jira-download.mjs') {
    Copy-Item -LiteralPath $env:BOOTSTRAP_HELPER -Destination $OutFile
    return [pscustomobject]@{BaseResponse=[pscustomobject]@{ResponseUri=[uri]$Uri}}
  }
  Microsoft.PowerShell.Utility\\Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile -PassThru -TimeoutSec $TimeoutSec
}
$Error.Clear()
try {
  & ([scriptblock]::Create([IO.File]::ReadAllText($env:BOOTSTRAP_SCRIPT))) -Platform codex -HomeDirectory $env:BOOTSTRAP_HOME -Domain no -NoOpen
} finally {
  foreach ($entry in @($Error | Select-Object -First 3)) {
    $exception=$entry.Exception
    while ($exception) {
      [Console]::Error.WriteLine('[bootstrap test] exception='+$exception.GetType().FullName)
      $exception=$exception.InnerException
    }
    [Console]::Error.WriteLine('[bootstrap test] stack='+$entry.ScriptStackTrace)
  }
}
`,
      "utf8",
    );
    await execute(
      join(
        process.env.SystemRoot,
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `& ([scriptblock]::Create([IO.File]::ReadAllText($env:BOOTSTRAP_WRAPPER)))`,
      ],
      {
        // PS7 → Node → Windows PowerShell은 PS7 모듈 경로를 그대로 상속한다.
        env: Object.fromEntries(
          Object.entries({ ...env, BOOTSTRAP_WRAPPER: wrapper }).filter(
            ([key]) => key.toUpperCase() !== "PSMODULEPATH",
          ),
        ),
        timeout: 240000,
        maxBuffer: 100000,
      },
    );
  } else {
    const bin = join(root, "bin");
    await mkdir(bin);
    const command = async (name: string) => {
      for (const dir of (process.env.PATH ?? "").split(delimiter)) {
        const file = join(dir, name);
        if (
          await access(file).then(
            () => true,
            () => false,
          )
        )
          return file;
      }
      throw Error(`Missing test OS tool: ${name}`);
    };
    const curl = await command("curl"),
      cp = await command("cp");
    for (const name of [
      "tar",
      "gzip",
      "mktemp",
      "awk",
      "uname",
      "mkdir",
      "rmdir",
      "rm",
      "mv",
      "date",
    ])
      await symlink(await command(name), join(bin, name));
    const hash = process.platform === "darwin" ? "shasum" : "sha256sum";
    await symlink(await command(hash), join(bin, hash));
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(
      join(bin, "curl"),
      `#!/bin/sh
url='' out='' previous=''
for value in "$@"; do
  [ "$previous" != '--output' ] || out=$value
  case "$value" in https://*) url=$value;; esac
  previous=$value
done
if [ "$url" = 'https://github.com/hellojianijinworld/fast-jira/releases/download/v0.1.1/fast-jira-download.mjs' ]; then
  ${quote(cp)} "$BOOTSTRAP_HELPER" "$out"
  printf '%s' "$url"
else
  exec ${quote(curl)} "$@"
fi
`,
    );
    await chmod(join(bin, "curl"), 0o700);
    env.PATH = bin;
    await execute(
      "/bin/sh",
      [
        script,
        "--platform",
        "codex",
        "--home",
        home,
        "--domain",
        "no",
        "--no-open",
      ],
      { env, timeout: 240000, maxBuffer: 100000 },
    );
  }
  const first = JSON.parse(await readFile(output, "utf8"));
  assert.equal(first.version, REQUIRED_NODE_VERSION);
  assert(first.node.startsWith(await realpath(join(home, "tools"))));
  assert.deepEqual(first.args.slice(4), [
    "--platform",
    "codex",
    "--domain",
    "no",
    "--no-open",
  ]);
  assert.equal(await realpath(first.args[3]), await realpath(home));
  assert.equal(
    await realpath(dirname(first.args[2])),
    await realpath(join(home, "releases")),
  );
  await assert.rejects(access(join(home, ".bootstrap-lock")));
});
