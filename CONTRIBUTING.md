# Contributing to Fast Jira

AI와 함께 개발할 때의 진입점입니다. 먼저 저장소의 `AGENTS.md`를 읽으세요. 사용자용 앱 설치, 복구는 [INSTALL.md](INSTALL.md), 제품 소개는 [README.md](README.md)에서 관리합니다. Contribute는 기여자 환경을 준비하거나 기여 절차를 요청받았을 때 사용합니다. 이미 소스에서 개발 중인 경우에는 저장소 지침을 따르면 됩니다. 일반 사용자 설치에서는 이 절차를 거치지 않습니다.

## 개발 시작

```sh
git clone https://github.com/hellojianijinworld/fast-jira.git
cd fast-jira
npm ci
npm run check
npm run dev
```

Node.js 24.22.2가 필요합니다. 화면은 `http://127.0.0.1:5173`, API는 기본 4173입니다. 이미 설치 서비스가 4173을 쓰고 있다면 개발할 때 `PORT=4175 npm run dev`처럼 분리하세요. 실행 중인 개인 서비스를 임의로 종료하지 않습니다. API 토큰이 없어도 화면과 모의 검사를 실행할 수 있습니다. 토큰은 앱에서 직접 입력하며, Git과 대화에 올리지 않습니다.

## 변경과 검증

- 화면 조립, 조회, 상태, 도메인 규칙, 외부 통신의 기존 경계를 따릅니다. 공유 규칙과 공통 컴포넌트를 재사용합니다.
- 의미 있는 로직, 결함에는 결과와 경계를 검증하는 검사를 추가합니다. 실제 Jira에 댓글을 등록하거나 필드를 바꿔 테스트하지 않습니다.
- `npm run check`: TypeScript strict, Biome, 빌드와 Node 검사.
- `npm run dev:ui`: Jira 없이 브라우저 모의 검사. `/tests/ui.html`, `/tests/browse.html`, `/tests/view-ui.html`, `/tests/cache.html`에서 결과를 확인합니다. 브라우저 검사는 check에 포함되지 않습니다.
- `npm run build`: UI와 Node용 서버, 관리 CLI 생성. `npm run package:plugin`: 두 AI 플랫폼 배포본 생성.
- 커밋 시 `.githooks/pre-commit`은 실제 스테이징한 내용의 TypeScript와 Biome을 검사합니다. 게이트를 우회하지 않습니다.

## UI에 기여할 때

[DESIGN.md](DESIGN.md)는 개발자, 기여자, AI 에이전트가 공유하는 디자인 판단 기준입니다. UI, 사용자 안내를 수정할 때 먼저 읽고, 실제 값은 `src/ui/theme.css`, 컴포넌트 역할과 크기는 `src/ui/theme.ts` 및 기존 공통 컴포넌트를 확인하세요. 새로운 UI 라이브러리를 전제로 하지 않습니다.

- 유사 화면과 공통 컴포넌트를 먼저 찾고, 변경 범위의 화이트, 다크, 좁은 화면을 확인합니다.
- 제출할 때 바뀐 사용 흐름, 재사용한 컴포넌트, 실제 확인한 상태와 미확인 범위를 적습니다. 시각 비교 캡처에는 민감한 내용을 포함하지 않습니다.
- 새 디자인 기준이 필요하면 변경 이유를 먼저 논의합니다. Impeccable 같은 외부 검토 도구는 선택 사항이며 설치나 자동 훅을 요구하지 않습니다.

## 플러그인 개발

공통 기능 지침은 `skills/setup`, `skills/managing`, `skills/contribute` 한 곳에 둡니다. Codex와 Claude Code의 manifest, marketplace만 분리합니다. 빌드 산출물은 개인 인증, 소스, 테스트, 개발 의존성을 제외하는 allowlist로 만듭니다.

| 플랫폼 | 진입점, 스킬 발견 | 적용, 설치 | 검증, 지원 범위 |
| --- | --- | --- | --- |
| Codex | `.codex-plugin/plugin.json`이 `skills/` 참조 | 요청형 스킬, 공식 로컬 marketplace | 실제 설치, 새 세션 스킬 발견 검사. 공통 Node 서비스와 MCP 중계 연결 |
| Claude Code | `.claude-plugin/plugin.json`, 루트 `skills/` 자동 탐색 | 요청형 스킬, 공식 로컬 marketplace | manifest validate, 설치, 스킬 목록 검사. 공통 Node 서비스와 MCP 중계 연결 |

일반 Claude 웹채팅은 플러그인 지원 범위가 아닙니다. 여러 AI 플랫폼이 같은 개인 서비스에 연결하므로 관리 작업은 개인 경로별 잠금과 실행 인스턴스로 구분합니다. Node 독립 프로세스로 실행하며 OS 자동 시작은 등록하지 않습니다. Windows CI는 도메인과 HTTPS 구성을 확인합니다. 일반 사용자 승인창과 Windows, Linux의 앱 전체 설치는 별도 확인이 필요합니다. 인증은 `config/connection.env`, 실행본은 `runtime/`으로 분리합니다. 웹 `/api`와 MCP `/mcp`는 `JiraService`를 공유하며 수정은 MCP 기본 확인 UI로 사용자 승인을 받습니다.

로컬 설치 확인은 `INSTALL.md`의 별도 `--home`과 포트를 사용합니다. 임시 설정에서 setup > HTTP 200 > stop > start > update > remove를 검증하고 개인 설정이 남는지 확인합니다. 정상 서비스의 포트와 실제 Jira 데이터를 사용하지 않습니다.

## 변경 공유

- 요청 범위만 수정하고 기존 사용자 변경을 보존합니다. 기존 구조, 조회 흐름은 소스 저장소의 `docs/architecture.md`를 확인합니다(배포 플러그인에 개발 문서 전체를 넣지 않습니다).
- 커밋, 푸시, PR, 태그, 이력 재작성은 각각 사용자 승인 범위에서 수행합니다. 문서는 별도 문서 커밋 요청이 있을 때만 포함합니다.
- 커밋 제목은 기술 태그를 제외하고 한국어로, 본문은 배경, 의사결정 위주로 3줄 미만입니다.
- 검증 결과와 미확인 사항, 기존 동작에 미치는 영향을 짧게 설명합니다. API 토큰, 개인 파일은 공유하지 않습니다.

## 정식 배포

앱과 두 플러그인은 같은 제품 버전을 사용합니다. `package.json`, lockfile의 루트 제품 항목, 두 manifest를 함께 갱신하고 `npm run check`와 `npm run package:plugin`을 확인합니다.

배포는 저장소 소유자가 검증한 커밋의 `v0.1.1` 같은 태그를 원격에 게시해 시작합니다. 로컬 태그 생성이나 main 푸시만으로는 배포되지 않습니다. 태그 게시와 재실행 주체, main에 포함된 커밋인지, 제품 버전과 태그가 일치하는지를 확인합니다. 실제 조건은 [.github/workflows/release.yml](.github/workflows/release.yml)을 기준으로 확인합니다.

- 빌드 작업은 읽기 권한으로 고정 Node, 전체 검사, 패키징, ZIP 실행본의 HTTP와 MCP 검사를 수행합니다.
- 게시 작업만 `contents: write` 권한으로 ZIP, 검증 JSON, 설치 도우미를 첨부하고 정식 릴리스를 공개합니다. 개인 PAT와 Jira 인증은 사용하지 않습니다.
- GitHub가 자동으로 만드는 Source code ZIP은 사용자 설치 파일이 아닙니다.
- Windows 도메인 CI는 [.github/workflows/check.yml](.github/workflows/check.yml)에 별도로 있습니다. 현재 태그 배포가 이 작업의 성공을 필수 조건으로 기다리지는 않으므로, Windows 지원을 게시하기 전에 같은 커밋의 결과를 확인해야 합니다.
- 별도 태그 보호 규칙은 아직 없습니다. 저장소 권한이나 배포 정책을 바꿀 때 이 범위도 함께 확인합니다.

이미 게시한 릴리스의 태그와 설치 파일을 다른 코드로 바꾸지 않습니다. 변경 사항은 더 높은 버전의 새 릴리스로 배포합니다. 앱은 새 정식 릴리스를 확인한 뒤 업데이트를 안내합니다. 커밋, 푸시, 태그, 릴리스 생성은 각각 요청받은 범위에서만 진행합니다.

로컬 `npm run package:release`는 GitHub 이벤트 정보와 `RELEASE_COMMIT`을 검사합니다. 일반 실행만으로 게시되지 않습니다. 후보 파일 검사는 격리된 환경에서 수행하고, 실제 게시와 구분합니다. Node 기준을 바꿀 때는 `package.json`, lockfile, `.nvmrc`, 설치 안내와 검증을 함께 갱신합니다.
