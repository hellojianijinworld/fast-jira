import { win32 } from "node:path";

type Run = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<void>;
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
export function windowsTool(name: string) {
  return win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", name);
}
export function powershellArguments(script: string) {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
}
export function windowsDomainScript(
  node: string,
  cli: string,
  port: number,
  env: NodeJS.ProcessEnv,
) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("잘못된 포트예요.");
  const settings = Object.entries(env)
    .filter(([key]) =>
      [
        "PORTLESS_STATE_DIR",
        "PORTLESS_LAN",
        "PORTLESS_TLD",
        "PORTLESS_PORT",
        "PORTLESS_HTTPS",
        "PORTLESS_SYNC_HOSTS",
      ].includes(key),
    )
    .map(([key, value]) => `$env:${key}=${quote(value ?? "")}`)
    .join("\n");
  const child = `$ErrorActionPreference='Stop'
Get-ChildItem Env: | Where-Object { $_.Name -like 'JIRA_*' -or $_.Name -eq 'NODE_OPTIONS' } | Remove-Item
${settings}
& ${quote(node)} ${quote(cli)} alias fast-jira ${port}
if ($LASTEXITCODE -ne 0) { exit 1 }
`;
  const encoded = Buffer.from(child, "utf16le").toString("base64");
  return `$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  & ${quote(windowsTool("WindowsPowerShell/v1.0/powershell.exe"))} -NoProfile -NonInteractive -EncodedCommand ${encoded}
  exit $LASTEXITCODE
}
Write-Host 'Fast Jira: fast-jira.local 주소를 사용하려면 Windows 승인창에서 허용해 주세요.'
$p=Start-Process -FilePath ${quote(windowsTool("WindowsPowerShell/v1.0/powershell.exe"))} -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand',${quote(encoded)} -Verb RunAs -Wait -PassThru
exit $p.ExitCode
`;
}

/** 관리자 권한은 hosts 연결에만 사용하고 프록시와 인증서는 현재 사용자로 처리한다. */
export async function startWindowsDomain(
  cli: string,
  port: number,
  env: NodeJS.ProcessEnv,
  run: Run,
) {
  const powershell = windowsTool("WindowsPowerShell/v1.0/powershell.exe");
  // Portless가 사용하는 OpenSSL을 PATH 또는 일반 설치 경로에서 찾는다.
  await run(
    powershell,
    powershellArguments(`$ErrorActionPreference='Stop'
$candidates=@((Get-Command openssl.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source), "$env:ProgramFiles\\Git\\usr\\bin\\openssl.exe", "$env:ProgramFiles\\Git\\mingw64\\bin\\openssl.exe", "$env:ProgramFiles\\OpenSSL-Win64\\bin\\openssl.exe")
$openssl=$candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (!$openssl) { throw 'Fast Jira 로컬 HTTPS 주소에는 OpenSSL이 필요해요. localhost로 계속 사용할 수 있어요.' }
# 검증된 실행 파일 경로만 개인 설정에 기록한다.
[IO.File]::WriteAllText(${quote(`${env.PORTLESS_STATE_DIR}/openssl-path.txt`)}, $openssl)
`),
    env,
  );
  // 설정 파일의 경로를 Node 부모 환경으로 되돌릴 필요 없이 PowerShell 안에서 실행한다.
  await run(
    powershell,
    powershellArguments(`$ErrorActionPreference='Stop'
$openssl=[IO.File]::ReadAllText(${quote(`${env.PORTLESS_STATE_DIR}/openssl-path.txt`)})
$env:PATH=[IO.Path]::GetDirectoryName($openssl)+';'+$env:PATH
& ${quote(process.execPath)} ${quote(cli)} proxy start --port 443 --tld local --skip-trust
exit $LASTEXITCODE
`),
    env,
  );
  await run(
    powershell,
    powershellArguments(windowsDomainScript(process.execPath, cli, port, env)),
    env,
  );
}
