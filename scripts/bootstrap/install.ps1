param(
  [Parameter(Mandatory=$true)][ValidateSet('codex','claude')][string]$Platform,
  [string]$HomeDirectory,
  [ValidateSet('yes','no')][string]$Domain='no',
  [switch]$NoOpen
)
$ErrorActionPreference='Stop'
$lock=$null
$stage=$null
try {
  if ($env:OS -ne 'Windows_NT') { throw '이 설치기는 Windows용이에요.' }
  if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'PowerShell 5 이상이 필요해요.' }
  $machine=if ($env:PROCESSOR_ARCHITEW6432) {$env:PROCESSOR_ARCHITEW6432} else {$env:PROCESSOR_ARCHITECTURE}
  $arch=switch ($machine) { 'ARM64' {'arm64'} 'AMD64' {'x64'} default {throw '64비트 Windows가 필요해요.'} }
  if (!$HomeDirectory) { $HomeDirectory=Join-Path $env:LOCALAPPDATA 'Fast Jira' }
  if (![IO.Path]::IsPathRooted($HomeDirectory)) { throw '개인 폴더는 절대 경로로 지정해 주세요.' }
  $HomeDirectory=[IO.Path]::GetFullPath($HomeDirectory)
  if ($HomeDirectory -eq [IO.Path]::GetPathRoot($HomeDirectory)) { throw '드라이브 루트는 개인 폴더로 사용할 수 없어요.' }
  function CheckDirectory([string]$Path) {
    if ((Test-Path -LiteralPath $Path) -and ((Get-Item -LiteralPath $Path).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '설치 경로의 링크는 사용할 수 없어요.' }
  }
  CheckDirectory $HomeDirectory
  $tools=Join-Path $HomeDirectory 'tools'
  $releases=Join-Path $HomeDirectory 'releases'
  CheckDirectory $tools
  CheckDirectory $releases
  New-Item -ItemType Directory -Path $tools,$releases -Force | Out-Null
  $lockPath=Join-Path $HomeDirectory '.bootstrap-lock'
  # 기존 잠금은 삭제하지 않고 설치 간 경합을 막는다.
  $lock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  $stage=Join-Path $tools ('.setup-'+[Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $stage | Out-Null
  [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  function Download([string]$Url,[string]$Path) {
    $result=Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Path -PassThru -TimeoutSec 180
    $final=if ($result.BaseResponse.ResponseUri) {$result.BaseResponse.ResponseUri} else {$result.BaseResponse.RequestMessage.RequestUri}
    if ($final.Scheme -ne 'https' -or $final.Host -notin @('nodejs.org','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com')) { throw '공식 다운로드 주소를 확인하지 못했어요.' }
  }
  function Verify([string]$Path,[string]$Expected) {
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() -ne $Expected) { throw '다운로드한 파일의 체크섬이 일치하지 않아요.' }
  }
  $nodeName='node-v__NODE__-win-'+$arch
  $nodeRoot=Join-Path $tools $nodeName
  CheckDirectory $nodeRoot
  if (!(Test-Path -LiteralPath $nodeRoot)) {
    [Console]::Error.WriteLine('전용 실행 환경을 준비하고 있어요.')
    $zip=Join-Path $stage 'node.zip'
    Download ('https://nodejs.org/dist/v__NODE__/'+$nodeName+'.zip') $zip
    $sha=if ($arch -eq 'arm64') {'__SHA_WIN_ARM64__'} else {'__SHA_WIN_X64__'}
    Verify $zip $sha
    Expand-Archive -LiteralPath $zip -DestinationPath $stage
    $extracted=Join-Path $stage $nodeName
    if (!(Test-Path -LiteralPath (Join-Path $extracted 'node.exe'))) { throw 'Node 실행 파일이 없어요.' }
    Move-Item -LiteralPath $extracted -Destination $nodeRoot
  }
  $node=Join-Path $nodeRoot 'node.exe'
  $version=& $node --version
  if ($LASTEXITCODE -ne 0 -or $version -ne 'v__NODE__') { throw '전용 Node 버전을 확인해 주세요. 기존 파일은 보존했어요.' }
  $helper=Join-Path $stage 'download.mjs'
  Download 'https://github.com/hellojianijinworld/fast-jira/releases/download/v__VERSION__/fast-jira-download.mjs' $helper
  Verify $helper '__INSTALLER_SHA__'
  $destination=Join-Path $releases ('v__VERSION__-'+[Guid]::NewGuid().ToString('N'))
  $arguments=@($helper,'__VERSION__','__COMMIT__',$destination,$HomeDirectory,'--platform',$Platform,'--domain',$Domain)
  if ($NoOpen) { $arguments+='--no-open' }
  & $node @arguments
  $resultCode=$LASTEXITCODE
} catch {
  [Console]::Error.WriteLine('설치를 완료하지 못했어요. 실패한 단계를 확인한 뒤 다시 시도해 주세요.')
  $resultCode=1
} finally {
  if ($stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
  if ($lock) { $lock.Dispose(); Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue }
}
exit $resultCode
