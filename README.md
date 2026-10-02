# Fast Jira

Jira Cloud를 빠르게 탐색하고 수정하는 **로컬 앱**입니다. 각 사용자가 자신의 컴퓨터에서 실행하고 자신의 Jira 계정으로 연결합니다. ACLI 설치나 별도의 클라우드 서버가 필요하지 않습니다.

- 프로젝트·상태·담당자 필터와 다중 정렬, 부모·하위 이슈 트리, 무한 스크롤
- 목록과 상세 분할, 최근 본 이슈, 완료 항목 간단히 보기
- 제목·상태·담당자·우선순위·마감일 수정과 일괄 변경·되돌리기
- 본문·댓글 편집, 키보드 `@` 멘션, 답글, 이미지·표·링크 표시
- 변경 기록, 최근 변경 묶음 확인, 개발자 요청·응답 로그

Jira 계정이 가진 권한 범위에서 동작합니다. 댓글 좋아요·이모지 반응은 지원하지 않습니다. 답글은 Jira의 미문서화 동작에 의존하므로 서비스 변경에 영향을 받을 수 있습니다.

## 1. 설치

**Node.js 22.12 이상**, npm, Git이 필요합니다. 프라이빗 저장소 접근 권한이 있는 GitHub 계정으로 복제하세요.

```sh
git clone https://github.com/jinimong/fast-jira.git
cd fast-jira
npm ci
```

## 2. Jira API 토큰 발급

1. 연결할 Jira 사이트에 접근할 수 있는 **본인 Atlassian 계정**으로 [API 토큰 관리](https://id.atlassian.com/manage-profile/security/api-tokens)에 로그인합니다.
2. **Create API token**을 선택합니다. 현재 앱은 사이트 주소에 직접 연결하므로 **scopes 없는 토큰**을 사용합니다. `Create API token with scopes`는 현재 연결 방식에서 지원하지 않습니다.
3. 이름(예: `Fast Jira`)과 만료일을 정하고 생성합니다.
4. 표시된 토큰을 복사해 아래 `.env`에 직접 입력합니다. 생성 후 토큰을 다시 볼 수 없으므로 필요한 경우 개인 비밀번호 관리자에 보관하세요.

발급 절차와 scopes 차이는 [Atlassian 공식 안내](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/)를 참고하세요. 이메일과 토큰 조합은 [Jira REST Basic 인증](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)에 사용됩니다.

## 3. 연결 설정

처음에만 `.env.example`을 `.env`로 복사합니다. **기존 `.env`가 있으면 덮어쓰지 마세요.**

```sh
cp .env.example .env
```

편집기로 `.env`를 열어 다음 값을 입력하세요.

```dotenv
JIRA_SITE=your-site.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=발급받은_토큰
PORT=4173
```

- `JIRA_SITE`: Jira 사이트의 호스트 이름만 입력합니다. `https://`나 `/browse/...`는 제외합니다.
- `JIRA_EMAIL`: 토큰을 발급한 Atlassian 계정 이메일입니다.
- `JIRA_API_TOKEN`: scopes 없는 API 토큰입니다. 따옴표 없이 한 줄로 입력합니다.
- `PORT`: 로컬 서버 포트입니다. 기본값은 `4173`입니다.

macOS/Linux에서는 `chmod 600 .env`로 본인만 파일을 읽게 할 수 있습니다. `.env`는 Git에서 제외됩니다. 토큰을 채팅·스크린샷·커밋에 넣지 마세요. 팀원마다 자신의 토큰을 설정합니다.

## 4. 실행

```sh
npm run build
npm start
```

브라우저에서 **<http://127.0.0.1:4173>**을 엽니다. `index.html` 파일을 직접 열지 마세요. 실행 터미널을 닫으면 서비스도 종료됩니다.

처음 연결하면 계정을 확인하고 시작합니다. 상단 필터에서 프로젝트와 표시할 상태·담당자를 선택한 뒤 **적용**을 누르세요. 카드 클릭은 상세 조회, 상위 카드 옆 필터는 하위 조건 설정입니다. 화면 설정·필터·최근 이슈는 계정별로 브라우저에 저장됩니다.

토큰은 로컬 서버가 읽습니다. 브라우저에는 토큰을 전달하지 않으며 Jira 호출은 로컬 서버를 통합니다. 서버는 `127.0.0.1`에만 열립니다. 이 앱을 공용 서버나 외부 도메인에 그대로 노출하지 마세요.

### 연결이 안 될 때

| 증상 | 확인할 내용 |
| --- | --- |
| 시작 시 환경변수 오류 | 프로젝트 폴더에서 실행했는지, `.env`의 세 인증 값이 채워졌는지 확인 |
| `401` | 이메일·토큰 조합, 토큰 만료, scopes 없는 토큰인지 확인 |
| `403` | 해당 프로젝트·이슈 권한 또는 조직의 API 접근 정책 확인 |
| 포트 사용 중 | 기존 실행을 종료하거나 `.env`의 `PORT` 변경 |
| 사이트가 열리지 않음 | 터미널 프로세스가 살아 있는지, `127.0.0.1`과 설정한 포트인지 확인 |

`.env`를 변경한 뒤에는 서버를 재시작하세요. 토큰 갱신도 같은 방식으로 진행합니다.

## AI 에이전트를 위한 설치 절차

1. 이 README를 읽고 Node/npm/Git 및 저장소 경로를 확인합니다.
2. `npm ci`를 실행합니다. 기존 `.env`는 보존하고, 없을 때만 `.env.example`을 복사합니다.
3. 인증 값이 없으면 사용자에게 위 발급 안내를 제공하고 **사용자가 편집기로 `.env`에 직접 입력하도록** 합니다. 토큰을 채팅으로 요청하거나 파일·환경변수 값을 출력하지 않습니다.
4. `npm run check`를 실행합니다. 이 검사는 가짜 HTTP 응답을 사용하며 실제 Jira를 수정하지 않습니다.
5. 사용자가 인증 설정을 마치면 `npm run build`와 `npm start`를 실행하고 로컬 화면이 열리는지 확인합니다. 서버를 유지하고 접속 주소를 안내합니다.
6. 설치 확인을 위해 실제 댓글을 등록하거나 상태·담당자를 변경하지 않습니다. `.env`, 로그, 개인 작업 기록은 커밋하지 않습니다.

아래 문장을 AI에 전달하면 됩니다.

> 이 저장소의 README를 읽고 Fast Jira를 로컬에 설치해 주세요. 기존 설정은 보존하고, API 토큰은 제가 .env에 직접 입력하도록 안내해 주세요. 토큰을 출력하지 말고 모의 검사와 로컬 실행까지만 확인해 주세요. 실제 Jira 데이터는 수정하지 마세요.

## 개발과 검사

| 명령 | 용도 |
| --- | --- |
| `npm run dev` | API 서버와 Vite 화면을 함께 실행. 화면은 `http://127.0.0.1:5173` |
| `npm run dev:ui` | Jira 연결 없이 화면·브라우저 모의 검사 실행 |
| `npm run check` | TypeScript strict, Biome, 빌드, Node 자동 검사 |
| `npm run format` | Biome 포매팅 |
| `npm run mcp` | 읽기 전용 stdio MCP. `jira_context`로 이슈·직접 하위 내용을 Markdown으로 조회 |

브라우저 검사는 `npm run dev:ui` 실행 후 [공통 UI 검사](http://127.0.0.1:5173/tests/ui.html)와 [목록·상세 검사](http://127.0.0.1:5173/tests/browse.html)를 엽니다. 결과가 모두 통과해야 합니다. **Jira 토큰 없이 실행할 수 있으며, 실제 Jira 요청은 하지 않습니다.** 현재 브라우저 검사는 페이지를 열어 실행하는 방식이며 `npm run check`에 포함되지 않습니다.

코드 경계·조회 흐름·후속 검토 사항은 [구조 가이드](docs/architecture.md)에 정리했습니다.
