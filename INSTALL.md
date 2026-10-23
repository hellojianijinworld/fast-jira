# Fast Jira — AI 설치 가이드

이 문서는 사용자를 대신해 로컬 설치·연결 확인을 수행하는 Codex와 Claude Code를 위한 진입점입니다. 제품 저장소는 https://github.com/hellojianijinworld/fast-jira 입니다. 사람에게 이 문서를 읽거나 명령을 하나씩 실행하도록 요구하지 마세요. 권한 승인, 로그인과 토큰 입력은 사용자가 직접 합니다.

## 완료 기준과 지원 범위

- Node.js 22.12 이상, npm, Git. 저장소 접근에 필요한 GitHub 인증은 재사용합니다.
- macOS 로그인 세션에서 서비스 설치·자동 시작·재시작을 지원합니다. Windows·Linux의 자동 서비스 설치는 미지원입니다. 해당 환경에서는 이를 먼저 안내하고 CONTRIBUTING.md의 전경 실행만 제공합니다.
- API 토큰이 없어도 앱과 플러그인 설치는 완료할 수 있습니다. 인증 전 상태를 연결 성공으로 보고하지 마세요.
- 기존 4173 서비스·설정·다른 프로그램을 종료하거나 덮어쓰지 마세요. 포트 충돌이면 다른 포트로 테스트하거나 이전 서비스의 소유와 이전 의도를 확인합니다.

## 1. 설치 경로와 실행 환경 확인

1. 현재 요청을 수행하는 플랫폼이 Codex인지 Claude Code인지 확인합니다. 둘을 모두 등록하는 것은 사용자가 요청했을 때만 합니다.
2. `node --version`, `npm --version`, `git --version`과 해당 플랫폼 CLI의 도움말을 확인합니다. 지원 Node가 없으면 설치 방식을 제안하고 필요한 승인 후 진행합니다.
3. 기존 소스 경로와 개인 설정을 우선 재사용합니다. 새로 필요하면 사용자가 지정한 위치 또는 `~/Applications/fast-jira-source`에 복제합니다. GitHub 접근 실패는 사용자의 로그인·저장소 권한 문제로 안내하며 공개 저장소라고 가정하지 않습니다.
4. 개인 데이터 기본 경로는 `~/Library/Application Support/Fast Jira`입니다. 두 AI 플랫폼이 같은 경로를 사용합니다. `FAST_JIRA_HOME` 또는 `--home`으로 지정했다면 이후 모든 관리 명령에도 같은 경로를 사용합니다.

## 2. 배포본 준비

### 소스 저장소에서 설치할 때

저장소 루트에서 아래 명령을 실행합니다. 기존 `.env`는 출력하거나 자동 복사하지 않습니다.

```sh
npm ci
npm run package:plugin
```

산출물은 `dist/marketplace`입니다. 빌드한 UI·서버·관리 CLI와 스킬만 들어 있으며 개발 의존성·개인 설정은 포함하지 않습니다. Node는 실행 시에도 필요합니다.

### 이미 빌드된 플러그인을 받았을 때

`dist/cli/main.js`, `dist/server/main.js`, `dist/client/index.html`이 있으면 그 플러그인 루트를 사용합니다. 배포본에는 개발 의존성이 없으므로 `npm ci`나 소스 빌드를 실행하지 않습니다. 이미 설치된 플러그인의 Setup 스킬로 진입했다면 아래 marketplace 등록은 반복하지 않고 4단계로 갑니다.

## 3. 현재 AI에 플러그인 등록

아래 `MARKETPLACE`는 빌드된 `dist/marketplace`의 절대 경로입니다. 명령은 현재 설치된 CLI의 도움말에 맞게 실행하며, 전역 AGENTS.md·CLAUDE.md를 수정해 등록하지 않습니다.

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

`PLUGIN_ROOT`는 현재 플랫폼 배포본 또는 설치된 플러그인의 절대 경로입니다. 소스에서 빌드한 경우 `dist/marketplace/plugins/codex/fast-jira` 또는 `dist/marketplace/plugins/claude/fast-jira`를 사용할 수 있습니다. 경로를 항상 따옴표로 감싸세요.

```sh
node "$PLUGIN_ROOT/dist/cli/main.js" doctor
node "$PLUGIN_ROOT/dist/cli/main.js" status
node "$PLUGIN_ROOT/dist/cli/main.js" setup
node "$PLUGIN_ROOT/dist/cli/main.js" status
node "$PLUGIN_ROOT/dist/cli/main.js" open
```

- `setup`은 실행 파일을 개인 폴더의 `runtime/`에 복사하고 macOS 사용자 LaunchAgent를 등록합니다. 터미널과 AI를 닫아도 서비스가 유지되고 다음 로그인 시 시작합니다. 컴퓨터가 잠들거나 로그아웃한 동안 동작을 보장하지 않습니다.
- 재설치·업데이트는 인증 파일을 보존합니다. `--port`는 최초·재설치 `setup`에만 사용합니다. 예: `setup --port 4174`.
- 로컬 테스트를 격리하려면 `setup --home "/개인/테스트경로" --port 4174`를 사용합니다. 이후 `status`, `stop`, `start`, `open`, `remove`에도 같은 `--home`을 전달합니다.
- 기존 소스의 `.env`는 자동으로 이전하지 않습니다. 사용자가 기존 연결 이전을 명시하면 본인 파일임을 확인하고 실행 서비스가 없는 대상의 `.env`로 권한 0600을 유지해 복사합니다. 내용은 출력하지 않습니다.

## 5. Jira 연결

1. 서비스 `status`의 URL에서 화면이 열리는지 확인합니다. `/api/health`는 Jira를 조회하지 않는 로컬 생존 확인입니다.
2. 사용자에게 https://id.atlassian.com/manage-profile/security/api-tokens 에서 **scopes 없는 API 토큰**을 발급하도록 안내합니다. 본인 Atlassian 계정 로그인 → Create API token → 이름·만료일 → 생성·복사 순서입니다.
3. 앱의 Jira 연결 설정에 사이트(`your-site.atlassian.net`), Atlassian 이메일, 토큰을 직접 입력하도록 안내합니다. 채팅으로 토큰을 요청하거나 로그·파일 값을 출력하지 마세요.
4. 입력 완료 후 읽기 전용 `/api/projects` 응답과 화면의 계정·프로젝트로 연결을 확인합니다. 401이면 이메일·만료·토큰 종류, 403이면 권한·조직 정책을 확인합니다. 실제 댓글 등록이나 이슈 수정으로 테스트하지 않습니다.

## 관리와 업데이트

설치된 관리 CLI의 고정 위치는 `~/Library/Application Support/Fast Jira/runtime/dist/cli/main.js`입니다.

- `status`: 설치·서비스 등록·HTTP 정상 응답을 각각 확인합니다.
- `start` / `stop` / `open`: 실행·종료·화면 열기. 이미 정상 실행 중이면 중복 시작하지 않습니다.
- `update`: 새 플러그인/새로 빌드한 소스의 CLI로 실행해 실행본을 교체합니다. 명시적인 업데이트 요청일 때만 합니다. 실패하면 이전 실행본·설정 복구를 시도합니다.
- `remove`: 서비스·실행 파일을 제거하며 개인 `.env`와 로그는 남깁니다. 플러그인 제거는 해당 플랫폼의 공식 명령으로 별도로 수행합니다.
- `service.lock` 오류: 다른 관리 명령이 실행 중인지 기록된 PID를 확인합니다. 진행 중인 작업의 잠금을 지우지 않습니다.

플러그인 업데이트도 각 플랫폼의 공식 marketplace 갱신·플러그인 업데이트 명령을 따릅니다. 로컬 폴더 marketplace를 다시 빌드했다면 Codex의 `marketplace upgrade`는 사용하지 않습니다(Git 소스 전용). 새 배포본을 만든 뒤 `codex plugin remove fast-jira@fast-jira-local` → `codex plugin add fast-jira@fast-jira-local`로 다시 설치합니다. Claude의 동일 버전 로컬 테스트도 `claude plugin uninstall fast-jira@fast-jira-local --scope user` → `claude plugin install fast-jira@fast-jira-local --scope user`로 반영합니다. 모두 업데이트 요청 범위에서만 실행합니다. 소스 checkout에 변경이 있으면 자동 reset/clean 하지 않습니다. 원격 게시·커밋·태그·푸시는 설치 요청에 포함되지 않습니다.

## 최종 안내

설치 버전, 설치된 플랫폼, 실제 URL, 서비스 실행 여부, 인증 여부를 짧게 보고합니다. 인증 미완료는 “설치 완료·Jira 연결 대기”입니다. 실패한 단계나 OS 미지원은 명시하며 성공으로 묶어 보고하지 않습니다.
