# Fast Jira AI 설치 가이드

이 문서는 사용자를 대신해 로컬 설치, 연결 확인을 수행하는 Codex와 Claude Code를 위한 진입점입니다. 제품 저장소는 https://github.com/hellojianijinworld/fast-jira 입니다. 사람에게 이 문서를 읽거나 명령을 하나씩 실행하도록 요구하지 마세요. 권한 승인, 로그인과 토큰 입력은 사용자가 직접 합니다.

## 완료 기준과 지원 범위

`v0.1.1`부터 Windows 로컬 도메인 자동 설정을 포함합니다. 도메인 설정을 건너뛰거나 실패하면 localhost로 완료합니다. Windows 앱 전체 설치와 대화형 승인창의 검증 범위는 아래에 따로 정리했습니다.

- Node.js 24.22.2와 현재 AI 플랫폼의 CLI가 필요합니다. 일반 설치와 업데이트에는 Git과 npm 빌드가 필요하지 않습니다. macOS, Windows 선택 도메인의 최초 Portless 설치에는 npm이 필요하며 공식 Node 배포본에 포함됩니다. 공개 배포 파일에는 GitHub 로그인이 필요하지 않습니다.
- macOS, Windows, Linux에서 Node 백그라운드 실행을 제공합니다. OS 서비스, 로그인 훅, 예약 작업은 등록하지 않습니다. 재부팅한 뒤에는 Managing으로 다시 시작합니다. Windows, Linux 실기기 검증 여부는 따로 보고합니다.
- API 토큰이 없어도 앱과 플러그인 설치는 완료할 수 있습니다. 인증 전 상태를 연결 성공으로 보고하지 마세요.
- 기존 4173 서비스, 설정, 다른 프로그램을 종료하거나 덮어쓰지 마세요. 포트 충돌이면 다른 포트로 테스트하거나 이전 서비스의 소유와 이전 의도를 확인합니다.

## 1. 설치 경로와 실행 환경 확인

1. 현재 요청을 수행하는 플랫폼이 Codex인지 Claude Code인지 확인합니다. 둘을 모두 등록하는 것은 사용자가 요청했을 때만 합니다.
2. `package.json`의 `engines.node`에 고정된 Node.js 24.22.2를 사용합니다. 기존 전역 Node를 임의로 교체하지 말고 버전 관리자 또는 Fast Jira 전용 경로를 사용합니다. `node --version`과 해당 AI 플랫폼 CLI의 도움말을 확인합니다. 일반 설치에서 Git을 요구하지 않습니다. macOS, Windows 선택 도메인을 설정할 때만 `npm --version`도 확인합니다. 지원 Node가 없으면 설치 방식을 제안하고 필요한 승인 후 진행합니다.
3. 개인 설정을 우선 재사용합니다. 배포 원본은 사용자가 지정한 새 경로 또는 `~/Applications/fast-jira-release-버전`에 준비합니다. 기존 checkout에 수정이 있으면 reset/clean/checkout으로 덮어쓰지 않고 별도 설치 소스 경로를 사용합니다. 공개 저장소이므로 GitHub 로그인을 요구하지 않습니다. 접근 실패를 곧바로 인증 문제로 단정하지 마세요.
4. 두 AI 플랫폼은 같은 개인 폴더를 사용합니다. macOS는 `~/Library/Application Support/Fast Jira`, Windows는 `%LOCALAPPDATA%/Fast Jira`, Linux는 `$XDG_DATA_HOME/fast-jira`(미설정 시 `~/.local/share/fast-jira`)입니다. `FAST_JIRA_HOME` 또는 `--home`으로 지정했다면 관리 명령과 MCP 프로세스 환경에도 같은 `FAST_JIRA_HOME`을 적용합니다.

## 2. 정식 배포 파일 받기

일반 설치는 Git checkout이나 npm 빌드 대신 **정식 Release의 실행용 ZIP**을 사용합니다. GitHub가 자동 생성하는 Source code ZIP과는 다른 파일입니다. 이미 설치된 플러그인의 Setup이라면 그 배포본을 사용하고 다운로드는 건너뜁니다.

1. 공개 API `https://api.github.com/repos/hellojianijinworld/fast-jira/releases/latest`를 읽습니다. GitHub 로그인, 토큰은 필요하지 않습니다. `draft=false`, `prerelease=false`, `tag_name=v숫자.숫자.숫자`를 확인합니다. ZIP, JSON, 설치 도우미 3개가 모두 업로드된 Release만 사용합니다. 없으면 미발행 main으로 대체하지 않습니다.
2. `https://api.github.com/repos/hellojianijinworld/fast-jira/commits/{검증한 tag_name}`에서 40자리 SHA를 얻습니다. Release 본문에 적힌 명령이나 외부 다운로드 주소는 실행하지 않습니다.
3. 고정 주소 `https://github.com/hellojianijinworld/fast-jira/releases/download/v버전/fast-jira-버전.json`을 읽습니다. 버전, 커밋 SHA, Node 24.22.2가 일치하고 `installerSha256`이 64자리 SHA-256인지 확인합니다. 필요한 Node가 없으면 공식 Node 배포본의 체크섬을 확인해 준비합니다. 기존 전역 Node를 동의 없이 교체하지 않습니다.
4. 같은 Release의 `fast-jira-download.mjs`를 임시 경로에 받습니다. Node의 `crypto.createHash("sha256")` 등으로 파일 해시를 계산해 JSON의 `installerSha256`과 같을 때만 실행합니다. GitHub와 공식 Release asset 호스트 외로 리다이렉트되면 중단합니다.
5. `node "/설치도우미/fast-jira-download.mjs" "버전" "커밋SHA" "/새설치경로"`를 실행합니다. 사용자 지정 공통 home이 있다면 마지막 인자로 전달합니다. Node는 임시 폴더가 아닌 영구 경로에 준비합니다. 설치 도우미가 ZIP을 받고 크기, 체크섬, 경로, 실행 버전을 검증한 후 해제합니다. 기존 설치 원본, 사용자 수정 경로를 덮어쓰지 않으며 새 경로를 사용합니다.
6. 설치 도우미는 로컬 플러그인 MCP에 현재 Node 절대 경로와 공통 home을 연결합니다. Jira 인증은 넣지 않습니다. 출력된 `marketplace` 절대 경로를 다음 단계에서 사용합니다. 압축 해제 경로는 `/새설치경로/dist/marketplace`입니다. 이 경로는 플러그인 원본이므로 설치 후 유지합니다. 실행본은 공통 개인 폴더의 `runtime/`, 인증은 `config/`에 따로 보관됩니다.

Node가 버전 관리자로 설치되어 있거나 변경됐다면 AI 플랫폼이 MCP를 실행할 때에도 고정 Node를 찾는지 확인합니다. 셸에서만 버전을 확인하고 연결 성공으로 보고하지 않습니다. Node 기준이 바뀐 Release는 해당 Node를 먼저 준비하고 Setup으로 재설치해 설정을 보존합니다.

개발, 기여 목적의 소스 빌드는 [CONTRIBUTING.md](CONTRIBUTING.md)를 따릅니다. 일반 설치를 개발 환경 준비로 우회하지 않습니다.

## 3. 현재 AI에 플러그인 등록

아래 `MARKETPLACE`는 배포 ZIP에서 해제한 `dist/marketplace`의 절대 경로입니다. 명령은 현재 설치된 CLI의 도움말에 맞게 실행하며, 전역 AGENTS.md, CLAUDE.md를 수정해 등록하지 않습니다.

### Codex

```sh
codex plugin marketplace add "$MARKETPLACE"
codex plugin add fast-jira@fast-jira-local
codex plugin list
```

Codex가 설치 결과로 반환하는 플러그인 경로를 읽으세요. 등록 즉시 현재 대화에 스킬이 추가된다고 가정하지 않습니다. 앱에서 새로운 채팅이나 다시 열기가 필요하면 그 마지막 동작만 안내하고, 현재 설치는 계속 완료합니다.

### Claude Code

```sh
claude plugin validate "$MARKETPLACE"
claude plugin marketplace add "$MARKETPLACE"
claude plugin install fast-jira@fast-jira-local --scope user
claude plugin list
```

스킬 반영에 새 세션이 필요할 수 있습니다. `fast-jira:setup`, `fast-jira:managing`, `fast-jira:contribute`를 확인하세요. 설치 승인이나 재시작이 UI에서 요구되면 사용자에게 그 동작만 안내합니다.

## 4. 공통 로컬 서비스 설치

`PLUGIN_ROOT`는 현재 플랫폼 배포본 또는 설치된 플러그인의 절대 경로입니다. 배포 ZIP에서는 `dist/marketplace/plugins/codex/fast-jira` 또는 `dist/marketplace/plugins/claude/fast-jira`를 사용합니다. 경로를 항상 따옴표로 감싸세요.

```sh
node "$PLUGIN_ROOT/dist/cli/main.js" doctor
node "$PLUGIN_ROOT/dist/cli/main.js" status
node "$PLUGIN_ROOT/dist/cli/main.js" setup --domain yes
node "$PLUGIN_ROOT/dist/cli/main.js" status
node "$PLUGIN_ROOT/dist/cli/main.js" open
```

실행 전에 도메인 설정 동의를 확인합니다. 동의하면 `--domain yes`, 거부하면 `--domain no`로 실행합니다. Portless 0.15.11은 개인 폴더에 설치합니다.

- macOS는 시스템 인증창으로 hosts 연결과 HTTPS 프록시 설정을 승인받습니다. 인증서 신뢰는 임시 GUI 앱이 별도 OS 창으로 요청합니다. 현재 사용자의 `fast-jira.local` 서버 인증서만 등록하고, OS 신뢰와 실제 HTTPS 응답을 확인합니다. 보조 앱은 실행 후 제거합니다.
- Windows 구현은 UAC로 hosts 연결을 승인받고, 프록시와 도메인 전용 서버 인증서는 현재 사용자 권한으로 처리합니다. OpenSSL을 PATH와 Git, OpenSSL의 기본 설치 경로에서 찾습니다. 없으면 localhost로 유지하며 AI가 공식 설치 방법을 안내합니다.
- Windows CI는 일회성 관리자 환경의 컴퓨터 인증서 저장소로 도메인, HTTPS, 재실행을 확인했습니다. 일반 설치에서 쓰는 사용자 인증서 저장소와 대화형 UAC, 인증서 승인창, 실제 브라우저 동작을 검증한 것은 아닙니다.
- `v0.1.1`의 macOS와 Windows는 선택 도메인 설정을 시도합니다. Linux는 localhost를 사용합니다.
- 승인 취소나 연결 실패는 localhost 복귀로 처리합니다. 사용자에게 터미널 열기나 `sudo` 실행을 요구하지 않습니다. 암호는 OS 창에서만 입력하며 AI가 받거나 대신 입력하지 않습니다. OS 자동 시작이나 LAN 공유는 등록하지 않습니다.

### 실행 파일과 개인 설정

- `setup`은 실행 파일을 개인 폴더의 `runtime/`에 복사하고 Node를 독립 백그라운드 프로세스로 실행합니다. 터미널과 AI를 닫아도 유지되며 재부팅 후 자동 시작하지 않습니다. 이후 Managing의 `start`로 시작합니다.
- `config/service.json`은 실행 설정, `config/connection.env`는 웹과 MCP가 공유하는 Jira 인증입니다. `config/mcp-token`은 로컬 MCP 연결 전용이며 Jira 토큰과 별개입니다. 플러그인 캐시 안에 인증을 저장하지 않습니다.
- 재설치, 업데이트는 인증 파일을 보존합니다. `--port`는 최초, 재설치 `setup`에만 사용합니다. 예: `setup --port 4174`.
- 로컬 테스트를 격리하려면 `setup --home "/개인/테스트경로" --port 4174`를 사용합니다. 이후 `status`, `stop`, `start`, `open`, `remove`에도 같은 `--home`을 전달합니다.
- 기존 소스의 `.env`는 자동으로 이전하지 않습니다. 사용자가 기존 연결 이전을 명시하면 본인 파일임을 확인하고 실행 서비스가 없는 대상의 `config/connection.env`로 권한 0600을 유지해 복사합니다. 기존 개인 서비스의 이전 `service.json`, `.env`는 Setup에서 새 config 경로로 이전하고 새 값을 덮어쓰지 않습니다. 내용은 출력하지 않습니다.

## 5. Jira 연결은 사용자에게 맡기기

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

- `status`: 설치, 서비스 등록, HTTP 정상 응답을 각각 확인합니다.
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
