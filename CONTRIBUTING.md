# Contributing to Fast Jira

AI와 함께 개발할 때의 진입점입니다. 먼저 저장소의 `AGENTS.md`를 읽으세요. 사용자용 앱 설치·복구는 [INSTALL.md](INSTALL.md), 제품 소개는 [README.md](README.md)에서 관리합니다. Contribute 스킬의 후속 제품 흐름은 앞으로 사용자와 구체화합니다. 현재 범위는 개발 환경 준비와 요청받은 변경·검증입니다.

## 개발 시작

```sh
git clone https://github.com/hellojianijinworld/fast-jira.git
cd fast-jira
npm ci
npm run check
npm run dev
```

Node.js 22.12 이상이 필요합니다. 화면은 `http://127.0.0.1:5173`, API는 기본 4173입니다. 이미 설치 서비스가 4173을 쓰고 있다면 개발할 때 `PORT=4175 npm run dev`처럼 분리하세요. 실행 중인 개인 서비스를 임의로 종료하지 않습니다. API 토큰이 없어도 화면과 모의 검사를 실행할 수 있습니다. 토큰은 앱에서 직접 입력하며, Git과 대화에 올리지 않습니다.

## 변경과 검증

- 화면 조립, 조회·상태, 도메인 규칙, 외부 통신의 기존 경계를 따릅니다. 공유 규칙과 공통 컴포넌트를 재사용합니다.
- 의미 있는 로직·결함에는 결과와 경계를 검증하는 검사를 추가합니다. 실제 Jira에 댓글을 등록하거나 필드를 바꿔 테스트하지 않습니다.
- `npm run check`: TypeScript strict, Biome, 빌드와 Node 검사.
- `npm run dev:ui`: Jira 없이 브라우저 모의 검사. `/tests/ui.html`, `/tests/browse.html`, `/tests/view-ui.html`, `/tests/cache.html`에서 결과를 확인합니다. 브라우저 검사는 check에 포함되지 않습니다.
- `npm run build`: UI와 Node용 서버·관리 CLI 생성. `npm run package:plugin`: 두 AI 플랫폼 배포본 생성.
- 커밋 시 `.githooks/pre-commit`은 실제 스테이징한 내용의 TypeScript와 Biome을 검사합니다. 게이트를 우회하지 않습니다.

## 플러그인 개발

공통 기능 지침은 `skills/setup`, `skills/managing`, `skills/contribute` 한 곳에 둡니다. Codex와 Claude Code의 manifest·marketplace만 분리합니다. 빌드 산출물은 개인 인증·소스·테스트·개발 의존성을 제외하는 allowlist로 만듭니다.

| 플랫폼 | 진입점·스킬 발견 | 적용·설치 | 검증·지원 범위 |
| --- | --- | --- | --- |
| Codex | `.codex-plugin/plugin.json`이 `skills/` 참조 | 요청형 스킬, 공식 로컬 marketplace | 실제 설치·새 세션 스킬 발견 검사. macOS 공통 서비스로 변환 지원 |
| Claude Code | `.claude-plugin/plugin.json`, 루트 `skills/` 자동 탐색 | 요청형 스킬, 공식 로컬 marketplace | manifest validate·설치·스킬 목록 검사. macOS 공통 서비스로 변환 지원 |

Windows·Linux 상주 서비스와 일반 Claude 웹채팅은 현재 미지원입니다. 여러 AI 플랫폼이 같은 개인 서비스에 연결하므로 관리 작업은 개인 경로별 잠금과 launchd 레이블로 구분합니다.

로컬 설치 확인은 `INSTALL.md`의 별도 `--home`과 포트를 사용합니다. 임시 설정에서 setup → HTTP 200 → stop → start → update → remove를 검증하고 개인 설정이 남는지 확인합니다. 정상 서비스의 포트와 실제 Jira 데이터를 사용하지 않습니다.

## 변경 공유

- 요청 범위만 수정하고 기존 사용자 변경을 보존합니다. 기존 구조·조회 흐름은 소스 저장소의 `docs/architecture.md`를 확인합니다(배포 플러그인에 개발 문서 전체를 넣지 않습니다).
- 커밋·푸시·PR·태그·이력 재작성은 각각 사용자 승인 범위에서 수행합니다. 문서는 별도 문서 커밋 요청이 있을 때만 포함합니다.
- 커밋 제목은 기술 태그를 제외하고 한국어로, 본문은 배경·의사결정 위주로 3줄 미만입니다.
- 검증 결과와 미확인 사항, 기존 동작에 미치는 영향을 짧게 설명합니다. API 토큰·개인 파일은 공유하지 않습니다.
