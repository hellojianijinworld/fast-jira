# Fast Jira AI 설치 가이드

Codex와 Claude Code가 사용자를 대신해 설치·연결을 진행하는 단일 절차입니다. 저장소는 https://github.com/hellojianijinworld/fast-jira 입니다. 사용자에게 명령 실행이나 설정 파일 편집을 맡기지 마세요. 시스템 동의·계정 로그인·Jira 토큰 입력만 사용자가 직접 합니다.

## 1. 설치 대상과 동의 확인

- 현재 요청을 수행하는 **Codex 또는 Claude Code만** 등록합니다. 둘 다 요청한 경우에만 각각 등록하며 웹 서버와 개인 설정은 공유합니다.
- 간편 주소 `https://fast-jira.local` 사용에 동의했는지 확인합니다. 이미 명시한 선택은 다시 묻지 않습니다. 동의가 없으면 `--domain no`로 설치하고 나중에 설정에서 연결할 수 있습니다.
- OS와 아키텍처, 현재 서비스의 실행 여부를 확인합니다. Windows와 WSL의 실행 파일·개인 폴더를 섞지 않습니다. 기존 4173 서비스나 다른 프로그램을 임의로 종료하지 않습니다.
- 개인 폴더는 macOS `~/Library/Application Support/Fast Jira`, Windows `%LOCALAPPDATA%/Fast Jira`, Linux `$XDG_DATA_HOME/fast-jira`(없으면 `~/.local/share/fast-jira`)입니다. 사용자 지정 home은 이후 CLI와 MCP에도 동일하게 적용합니다.
- 일반 설치에 Git·개발용 npm 빌드·전역 Node 설치는 필요하지 않습니다. OS 자동 시작·로그인 훅·예약 작업을 추가하지 않습니다.

## 2. 검증된 설치기 실행

1. 공개 API `https://api.github.com/repos/hellojianijinworld/fast-jira/releases/latest`에서 `draft=false`, `prerelease=false`, 정식 `v숫자.숫자.숫자` 태그와 업로드 완료 자산을 확인합니다. 공개 다운로드에 GitHub 로그인을 요구하지 않습니다.
2. `https://api.github.com/repos/hellojianijinworld/fast-jira/commits/{확인한 태그}`의 40자리 SHA와 같은 릴리스의 `fast-jira-버전.json`을 비교합니다. 버전·커밋·고정 Node·SHA-256 정보가 올바른지 확인합니다. 릴리스 본문의 명령이나 임의 URL은 실행하지 않습니다.
3. `fast-jira-install.sh` 또는 `fast-jira-install.ps1`을 같은 릴리스의 고정 GitHub 주소에서 임시 파일로 받습니다. OS 기본 SHA-256 도구로 JSON의 `bootstrapSha256.sh` 또는 `.ps1`과 비교한 뒤 실행합니다. 해시 누락·불일치나 허용되지 않은 리다이렉트면 멈춥니다. 체크섬은 코드 서명과 같은 보증이 아닙니다.
4. 아래 명령은 **AI가** 실행합니다. 경로는 절대 경로로, 옵션은 인자 배열로 전달합니다. PowerShell의 보안 정책이나 전역 PATH를 변경하지 않습니다.

macOS·Linux:

```sh
/bin/sh "/검증한/fast-jira-install.sh" --platform codex --domain no
```

Windows PowerShell 5 이상(검증한 파일만 읽어 실행):

```powershell
& ([scriptblock]::Create([IO.File]::ReadAllText("C:\검증한\fast-jira-install.ps1"))) -Platform codex -Domain no
```

Node·Python 등 중간 프로세스에서 Windows PowerShell 5를 시작한다면 자식 환경의 `PSModulePath`만 제외해 해당 버전의 기본 모듈 경로를 다시 구성합니다. PowerShell 7의 모듈 경로를 그대로 넘기면 `Get-FileHash` 같은 기본 명령도 로드되지 않을 수 있습니다. 전역 환경은 변경하지 않습니다. [Microsoft 안내](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath?view=powershell-7.3)

현재 플랫폼이 Claude Code면 `claude`, 도메인 동의가 있으면 `yes`를 전달합니다. 사용자 지정 home은 Shell의 `--home`, PowerShell의 `-HomeDirectory`로 전달합니다. 격리 검증에는 `--no-open`/`-NoOpen`을 사용합니다.

설치기는 공식 Node 배포본의 고정 버전·아키텍처·체크섬을 확인해 개인 home의 `tools/`에 준비합니다. 전역 Node가 없어도 바로 공통 CLI로 이어집니다. 검증한 다운로드 도우미가 실행용 ZIP을 받고 버전·커밋·해시·경로를 검사한 뒤 웹 → 현재 플랫폼 등록 → 로컬 MCP → 선택 도메인을 처리합니다. 원본은 `releases/`, 실행본은 `runtime/`, 개인 설정은 `config/`에 남습니다.

이 진입점이 없는 구버전 릴리스에서는 해당 **태그의 INSTALL.md**에 있는 검증된 Node·다운로드 도우미 절차를 AI가 수행합니다. 없는 설치기 파일을 있다고 가정하거나 미발행 main을 빌드해 대체하지 않습니다. 소스 개발은 명시적 요청이 있을 때만 CONTRIBUTING.md를 따릅니다.

기존 설치를 처음부터 검증하려고 명시적으로 재설치하는 경우에는 서비스 종료 후 개인 폴더를 접근 제한된 백업으로 보관하고 새 폴더에 설치합니다. 토큰·설정을 임의로 삭제하거나 백업 내용을 출력하지 않습니다. 새 설치의 인증 대기와 웹·플러그인·MCP 연결을 먼저 확인한 뒤, 요청한 경우에만 기존 연결 설정을 복원합니다. 브라우저에 저장된 뷰·대화는 서버 폴더 재설치로 초기화되지 않습니다. 미발행 변경을 검증하는 개발용 ZIP 설치는 정식 릴리스 다운로드 검증과 구분해 보고합니다.

이미 설치된 플러그인에서 Setup을 실행한다면 다운로드를 반복하지 않고 그 배포본의 CLI를 사용합니다.

```sh
"/영구경로/node" "/플러그인/dist/cli/main.js" setup --platform codex --domain no
```

필요한 경우 `--home`, `--port`, `--marketplace`를 추가합니다. 포트 충돌을 피하려는 격리 설치는 사용자 지정 home과 사용 가능한 포트를 함께 지정하고 `--no-open`으로 인증 화면을 열지 않습니다. 정상 서비스에 단순 상태 확인만 필요하면 재설치하지 않습니다.

## 3. 부분 완료와 연결 확인

설치 결과 JSON의 `runtime`, `web`, `plugin`, `mcp`, `domain`, `assistant`, `jira`를 따로 확인합니다. `state`와 `code`가 기준이며 오류 문구를 파싱하지 않습니다.

- 종료 코드 0은 요청한 설치 흐름 완료, 1은 기본 앱 실패, 2는 웹은 정상이나 요청한 플러그인/MCP 설치에 실패한 부분 완료입니다. 0이라고 Jira 로그인이나 현재 대화의 도구 발견까지 보장하지 않습니다.
- `appReady`는 런타임과 웹 범위입니다. 실제 `url`과 `/api/health`를 확인하고 그 주소를 사용합니다.
- `mcp_host_pending`은 로컬 MCP 연결 성공이며 현재 AI 호스트의 도구 발견은 미확인입니다. 도구 목록을 확인할 수 없다면 대기로 보고합니다. Jira 토큰을 MCP 설정이나 명령 인자에 넣지 않습니다.
- 플러그인 등록 실패는 웹을 내리지 않습니다. 다른 플랫폼으로 몰래 바꾸거나 정상 항목까지 재설치하지 않습니다. 현재 플랫폼의 공식 설치/로그인 흐름이 필요하면 사용자에게 안내합니다.
- AI 상태 확인에는 계정·모델·로컬 MCP만 사용합니다. 유료 대화나 Jira 쓰기 테스트를 하지 않습니다. 미연결 AI 기능은 일반 화면에서 숨기며 **설정 > 관리**에서 연결 확인·공식 로그인·플러그인 연결 확인을 제공합니다.
- 도메인 동의 후 필요한 OS 창은 사용자가 직접 승인합니다. macOS는 pinned Portless와 현재 사용자 인증서 신뢰, Windows는 hosts용 UAC와 현재 사용자 인증서 등록을 사용합니다. Windows OpenSSL이 없거나 승인·연결에 실패하면 localhost를 독립 확인해 엽니다. Linux는 localhost를 사용합니다.
- 인증 화면은 최종 주소를 확정한 뒤 엽니다. 기존 사용자의 도메인 재시도는 현재 탭을 강제로 이동시키지 않습니다. localhost와 도메인은 브라우저 저장소가 다르므로 뷰·대화를 자동 이전했다고 주장하지 않습니다.

### OS별 조건과 복구 경계

[Node 24 공식 지원표](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list)의 실행 조건은 Windows x64/arm64가 Windows 10 이상, macOS x64/arm64가 13.5 이상입니다. 이 표의 하한과 별개로 OS 공급자의 지원이 종료된 버전은 Node 지원 대상이 아닙니다. Windows 11 등 지원 중인 OS를 권장하며 Windows 10은 해당 에디션의 연장 지원 여부까지 확인합니다. Linux 공식 x64/arm64 배포본은 kernel 4.18·glibc 2.28 이상이 기준이며 musl/Alpine을 같은 환경으로 간주하지 않습니다. Node를 직접 컴파일하는 도구 목록은 Fast Jira 일반 설치 의존성이 아닙니다.

| 상황 | 처리 |
| --- | --- |
| Windows에 Node·Git·npm이 없음 | 기본 웹/MCP에는 검증된 Node ZIP만 준비. Git과 빌드 도구는 설치하지 않음 |
| 공백·한글 경로 또는 오래된 PATH | 절대 경로와 인자 배열 사용. 전역 PATH나 다른 Node를 수정하지 않음 |
| 4173 포트 사용 중 | 기존 Fast Jira 소유면 재사용. 다른 프로그램이면 종료하지 않고 다른 포트 선택 |
| 보호 폴더/읽기 전용 경로 | Program Files 대신 사용자 전용 home 사용. 회사 정책에 의해 차단되면 IT 확인이 필요함 |
| Windows 도메인용 OpenSSL 없음 | 앱은 localhost로 완료. 도메인을 계속 원할 때만 별도 공식 설치를 제안. Node 내부 OpenSSL과 외부 `openssl.exe`는 다름 |
| UAC 취소·관리자 자격 없음·인증서 등록 거부 | 도메인만 포기하고 localhost HTTP를 재확인. 서비스 전체를 관리자 권한으로 띄우지 않음 |
| 회사 App Control·PowerShell 제한·TLS 가로채기 | 오류 종류만 정리하고 정책 우회·보안 도구 해제·인증서 검증 해제 금지. localhost도 차단되면 앱 설치 실패로 보고 |
| 443 점유·VPN/프록시·도메인 신뢰 실패 | 도메인 주소를 성공으로 표시하지 않음. localhost 응답을 독립 확인하고 실제로 열리는 주소 안내 |
| 다운로드 실패·프록시 인증 필요 | URL·단계·오류 종류만 정리. 회사 설정을 임의 변경하거나 인증정보를 채팅에 요청하지 않음 |

Windows 도메인은 불가능한 기능이 아닙니다. [UAC](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/how-it-works)로 hosts 변경만 상승 권한을 얻고 [현재 사용자 인증서 저장소](https://learn.microsoft.com/en-us/powershell/module/pki/import-certificate)로 HTTPS 신뢰를 등록합니다. 표준 사용자는 UAC에서 관리자 자격이 필요할 수 있습니다. [그룹 정책은 PowerShell 실행 정책보다 우선](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies)하며 [App Control](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/)은 실행 파일과 스크립트 자체를 제한할 수 있습니다. AI가 모든 PC에서 이를 자동 해결할 수 있다고 약속하지 않습니다.

설치 결과는 **앱 / 플러그인·MCP / 선택 도메인 / Jira 연결**을 각각 성공·실패·대기로 보고합니다. 이슈로 문의할 때는 OS·아키텍처·Node 버전·설치 버전·실패 단계·비식별화한 오류만 정리합니다. 환경변수 전체, 인증 파일, 토큰, 원본 로그를 수집하지 않습니다.

## 4. Jira 연결은 사용자에게 맡기기

1. 인증을 넘기기 전에 `/api/health`와 서비스 URL을 확인합니다. 이 요청은 Jira를 조회하지 않습니다. 이미 설정된 연결을 재사용한다면 이 시점에 읽기 전용 `/api/projects`의 HTTP 상태만 확인할 수 있습니다. 본문은 출력하지 않습니다.
2. 앱의 **Jira 연결하기** 화면을 열고 사용자에게 입력을 맡깁니다. 사이트(`your-site.atlassian.net`), Atlassian 이메일과 토큰을 한 화면에서 입력합니다. **토큰 발급** 링크로 이동해 복사한 뒤 돌아와 붙여넣고 **연결하고 시작하기**를 누릅니다. 상단 진행도는 기본 정보, 토큰 입력, 연결 확인 상태만 표시하며 입력 영역을 숨기지 않습니다.
3. 발급 링크는 https://id.atlassian.com/manage-profile/security/api-tokens 입니다. 사용자가 본인 계정으로 로그인해 **scopes 없는 API 토큰**의 이름과 만료일을 정해 발급받고 복사합니다. AI가 토큰을 발급받거나 복사해 입력하지 않습니다.
4. 인증을 넘긴 후에는 화면, 스크린샷, DOM, 입력값, 네트워크 요청/응답 본문, 클립보드, 인증 파일을 읽거나 브라우저를 조작하지 않습니다. 토큰을 채팅에 요청하지 않습니다. 토큰 교체 시에도 같은 규칙을 적용합니다.
5. AI는 `GET /api/connection/status`만 확인합니다. 응답에는 `state`만 있고 개인정보는 없으며 Jira 추가 조회도 발생하지 않습니다. 3초 이상 간격으로 최대 2분 확인하고 `connected` 또는 `failed`에서 멈춥니다. 사용자에게 입력 완료를 다시 채팅으로 알려달라고 요구하지 않습니다. 입력이 끝나지 않았다면 "설치 완료, Jira 연결 대기"로 안내하고 확인을 종료합니다. 이후 요청에서 다시 확인할 수 있습니다.

| state | 의미, 안내 |
| --- | --- |
| `waiting` | 아직 연결하지 않음. 사용자 입력 대기 |
| `unverified` | 저장된 토큰이 있지만 이번 서비스 실행에서 아직 확인되지 않음. 연결 성공으로 단정하지 않음 |
| `checking` | 앱이 입력한 정보로 인증 및 저장을 확인 중 |
| `connected` | 이번 연결 확인과 저장이 성공함. 앱에서 자동으로 시작 |
| `failed` | 최근 연결 시도가 실패함. 앱이 원인과 재시도 방법을 안내하며 기존 연결은 보존 |

상태는 마지막 연결 시도의 결과이며 토큰의 이후 만료, 폐기를 실시간 보증하지 않습니다. 실패 시에도 토큰이나 화면을 대신 읽지 않습니다. 사용자가 앱의 안내에 따라 이메일, 만료, 토큰 종류, 권한을 확인하도록 안내합니다. 실제 댓글 등록이나 이슈 수정으로 테스트하지 않습니다.

## 연결 후 첫 사용

앱의 시작 안내에서 다음 순서로 진행합니다. AI는 인증 입력을 넘긴 뒤 화면을 대신 읽거나 조작하지 않습니다.

1. **프로젝트 선택**으로 현재 뷰에 볼 프로젝트를 고릅니다. 빈 선택은 로딩 상태가 아니라 선택한 프로젝트가 없는 상태로 안내되어야 합니다.
2. **필터 설정**과 **화면 표시**는 선택 사항입니다. 건너뛰고 시작한 뒤에도 메뉴에서 바꿀 수 있습니다.
3. **시작하기**로 안내를 닫습니다. **메뉴 > 이용 안내**에서 시작 안내를 다시 열 수 있습니다.

## 관리와 업데이트

설치된 관리 CLI는 1단계에서 확인한 공통 개인 폴더의 `runtime/dist/cli/main.js`입니다. macOS 기본 위치는 `~/Library/Application Support/Fast Jira/runtime/dist/cli/main.js`이며, 다른 OS나 사용자 지정 home에도 같은 상대 경로를 사용합니다.

- `status`: 실행본 설치, OS 서비스 등록 여부, HTTP 정상 응답을 각각 확인합니다. 현재 방식은 OS 서비스를 등록하지 않으므로 `registered=false`여도 `installed=true`, `running=true`이면 정상입니다.
- `start` / `stop` / `open`: 실행, 종료, 화면 열기. 이미 정상 실행 중이면 중복 시작하지 않습니다.
- `update`: 새 플러그인/새로 빌드한 소스의 CLI로 실행해 실행본을 교체합니다. 명시적인 업데이트 요청일 때만 합니다. 실패하면 이전 실행본, 설정 복구를 시도합니다.
- `remove`: 서비스와 실행 파일을 제거하며 개인 `config/connection.env`와 로그는 남깁니다. 도메인 프록시, hosts 연결, 인증서까지 제거하는 명령은 아닙니다. 플러그인은 해당 플랫폼의 공식 명령으로 별도 제거합니다.
- `service.lock` 오류: 다른 관리 명령이 실행 중인지 기록된 PID를 확인합니다. 진행 중인 작업의 잠금을 지우지 않습니다.

앱은 5분 간격으로 GitHub의 최신 정식 릴리스를 확인합니다. 실행용 ZIP, 검증 JSON, 설치 도우미가 준비된 더 높은 버전만 업데이트로 안내합니다. **메뉴 > 업데이트 확인**에서 직접 확인하거나 업데이트를 시작할 수 있습니다.

- 다운로드한 버전, 커밋, Node, SHA-256을 확인합니다. 사용자 컴퓨터에서 Git이나 npm으로 소스를 빌드하지 않습니다.
- 앱과 Setup으로 설치한 사용자 범위의 Codex, Claude 플러그인을 함께 갱신합니다. 설치하지 않은 플랫폼을 새로 등록하지 않습니다.
- 실패하면 이전 앱과 플러그인 복구를 시도합니다. 서비스만 바뀐 경우 플러그인까지 갱신됐다고 보고하지 않습니다.
- 이미 열린 AI 대화의 도구나 지침은 플랫폼에 따라 바로 바뀌지 않을 수 있습니다. 반영이 필요한 경우에만 새 대화 또는 플러그인 다시 로드를 안내합니다.

플러그인 업데이트도 각 플랫폼의 공식 marketplace 갱신, 플러그인 업데이트 명령을 따릅니다. 로컬 폴더 marketplace를 다시 빌드했다면 Codex의 `marketplace upgrade`는 사용하지 않습니다(Git 소스 전용). 새 배포본을 만든 뒤 `codex plugin remove fast-jira@fast-jira-local` > `codex plugin add fast-jira@fast-jira-local`로 다시 설치합니다. Claude의 동일 버전 로컬 테스트도 `claude plugin uninstall fast-jira@fast-jira-local --scope user` > `claude plugin install fast-jira@fast-jira-local --scope user`로 반영합니다. 모두 업데이트 요청 범위에서만 실행합니다. 소스 checkout에 변경이 있으면 자동 reset/clean 하지 않습니다. 원격 게시, 커밋, 태그, 푸시는 설치 요청에 포함되지 않습니다.

## MCP 연결

배포 플러그인의 `.mcp.json`을 Codex, Claude Code가 읽어 `fast_jira`를 등록합니다. 새 대화/플러그인 다시 로드가 필요할 수 있습니다. 중계기는 공통 설치의 설정과 로컬 MCP 전용 토큰을 읽고 같은 Node 서버의 `/mcp`로 연결합니다. Jira 토큰을 플랫폼 MCP 설정이나 명령 인자에 넣지 않습니다. MCP 도구 발견은 서버를 자동 시작하지 않습니다. 꺼져 있으면 Managing으로 시작합니다.

조회와 수정은 웹과 같은 Jira 서비스, 인증, 캐시를 사용합니다. 수정, 댓글, 되돌리기는 MCP 클라이언트의 기본 확인 UI(네이티브 elicitation)에서 대상과 값을 확인하고 승인한 경우에만 실행합니다. 승인 기능을 지원하지 않는 클라이언트는 조회만 가능합니다. AI가 인자로 보낸 `approved=true` 같은 값은 승인으로 인정하지 않습니다. 별도 웹 승인 화면은 만들지 않습니다.

## 기존 버전에서 재설치할 때

일반 업데이트는 현재보다 높은 버전만 설치합니다. 사용자가 특정 버전으로 재설치를 요청했다면 해당 정식 배포 파일을 사용하고 개인 `config/`를 보존합니다. 낮은 버전을 새 업데이트로 표시하거나, 개발 중인 코드를 정식 배포본으로 대체하지 않습니다.

## 최종 안내

설치 버전, 설치된 플랫폼, 실제 URL, 서비스 실행 여부, 인증 여부를 짧게 보고합니다. 인증 미완료는 "설치 완료, Jira 연결 대기"입니다. 실패한 단계와 지원하지 않는 범위는 따로 안내합니다. 일부 단계만 확인하고 전체 설치가 검증됐다고 보고하지 않습니다.
