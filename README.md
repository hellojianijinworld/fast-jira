<div align="center">

# 🦓 Fast Jira

### Jira의 복잡함은 줄이고, 내 작업에 집중하세요.

프로젝트와 하위 작업을 한눈에 탐색하고, 필요한 변경을 바로 처리하는 로컬 워크스페이스.

**Local first · Your Jira account · Codex & Claude Code · [MIT](LICENSE)**

[둘러보기](#내-작업을-빠르게) · [AI에게 설치 맡기기](#ai에게-맡기세요) · [기여하기](CONTRIBUTING.md)

</div>

---

## 내 작업을 빠르게

| 찾고 | 살펴보고 | 처리하세요 |
| --- | --- | --- |
| 프로젝트별 계층 탐색 | 목록과 상세를 나란히 | 제목·담당자·상태·우선순위 수정 |
| 내 작업과 작업 관계자 필터 | 본문·첨부 이미지·변경 기록 | 여러 이슈를 선택해 일괄 변경 |
| 프로젝트·필터를 기억하는 뷰 탭 | 상위 경로와 하위 작업 | 댓글·답글·키보드 @멘션 |
| 즐겨찾기와 최근 본 이슈 | 최근 활동과 변경분 확인 | 결과 알림과 되돌리기 |
| 검색과 명령 팔레트 | Codex·Claude AI 대화 | 프로젝트 이슈·하위 작업 생성 |

### 기다림을 줄였습니다

- 저장된 목록을 먼저 보여주고, 변경된 내용을 확인해 반영합니다.
- 필드를 수정할 때마다 전체 목록을 다시 불러오지 않습니다.
- 화면을 보고 있지 않을 때는 주기 조회를 쉽니다.
- 좁은 화면에서도 목록과 상세를 이어서 탐색할 수 있습니다.

### 내 컴퓨터에서, 내 권한으로

각자의 Jira 계정으로 연결합니다. API 토큰은 로컬 서버에 보관하며 브라우저 저장소나 공유 배포본에 넣지 않습니다. 별도 클라우드 서버나 ACLI 없이 동작합니다.

## AI에게 맡기세요

아래 문장을 **Codex 또는 Claude Code**에 전달하세요.

```text
https://github.com/hellojianijinworld/fast-jira 를 읽고 이 컴퓨터에 설치해줘.
README의 AI 설치 가이드를 따라 최신 정식 릴리스를 설치하고,
지금 사용하는 AI에 플러그인과 MCP를 등록한 뒤 앱을 열어줘.
기존 설정은 보존하고 Jira 토큰은 내가 앱에 직접 입력할게.
```

| 스킬 | 이렇게 요청하세요 |
| --- | --- |
| **Setup** | “Fast Jira 설치하고 열어줘.” |
| **Managing** | “실행 상태 확인해줘.” “업데이트해줘.” “종료해줘.” |
| **Contribute** | “Fast Jira 개발 환경을 준비해줘.” |

설치는 AI가 정식 Release의 실행용 ZIP을 받아 진행합니다. 일반 설치·업데이트에는 Git이나 npm 빌드가 필요하지 않고 Node 24.22.2를 사용합니다. 선택 도메인의 최초 설정에는 npm이 필요하고 Windows에서는 OpenSSL도 필요합니다. Codex 또는 Claude Code처럼 로컬 명령을 실행할 수 있는 환경이 필요합니다. 일반 ChatGPT·Claude 웹채팅만으로 설치되는 방식은 아닙니다. Jira 연결 정보는 앱에 직접 입력하고, macOS·Windows의 선택 도메인 설정은 OS 승인창에서 승인합니다. 터미널을 열어 명령을 실행할 필요가 없습니다. 승인하지 않으면 localhost 주소로 사용합니다.

설치와 실행 절차는 [AI 설치 가이드](INSTALL.md), 개발 방법은 [기여 가이드](CONTRIBUTING.md)에 모았습니다.

Windows 로컬 도메인 자동 설정은 현재 `main`의 변경 사항이며 다음 Release부터 배포됩니다. 기존 `v0.1.0` 설치 파일은 그대로 유지하며, Windows에서는 localhost로 이용합니다.

## 처음 열었다면

1. 앱에서 Jira 사이트·Atlassian 이메일·API 토큰을 입력해 연결합니다. [토큰 발급](https://id.atlassian.com/manage-profile/security/api-tokens)은 본인이 진행하고, 토큰은 AI 대화에 붙여넣지 않습니다.
2. **프로젝트 선택**에서 현재 뷰에 볼 프로젝트를 고릅니다.
3. 필터와 화면 표시는 필요할 때 설정하세요. 바로 시작한 뒤에도 바꿀 수 있습니다.

컴퓨터를 다시 켠 뒤에는 AI에게 “Fast Jira 실행해줘”라고 요청하세요. OS 자동 시작은 등록하지 않습니다.

## 업데이트와 의견 보내기

새 정식 릴리스가 있으면 앱에 업데이트 아이콘과 파비콘의 주황색 점이 나타납니다. **메뉴 → 업데이트 확인**에서 변경 내용을 보고 직접 실행하세요. 앱과 이미 설치한 Fast Jira 플러그인을 함께 갱신하며 Jira 연결 설정은 보존합니다. 코드를 GitHub에 푸시하는 것만으로 기존 설치본이 갱신되지는 않습니다.

앱의 **메뉴 → 의견 보내기** 또는 아래 링크로 알려주세요. GitHub에서 내용을 확인한 뒤 제출합니다.

- [버그 제보](https://github.com/hellojianijinworld/fast-jira/issues/new?template=bug.yml)
- [개선·기능 제안](https://github.com/hellojianijinworld/fast-jira/issues/new?template=feature.yml)
- [설치·사용 문의](https://github.com/hellojianijinworld/fast-jira/issues/new?template=question.yml)

API 토큰이나 회사의 이슈 본문·대화·원본 로그는 올리지 마세요. 민감한 정보를 가린 캡처만 첨부해 주세요.

## 지원 범위

- Jira Cloud · 개인 계정의 접근 권한에 따라 동작
- Codex·Claude Code 플러그인 · 공통 로컬 웹·MCP 서버
- macOS에서 실제 설치 검증 · Windows·Linux용 실행 경로와 모의 검사는 제공하지만 실기기 검증은 별도
- Node 백그라운드 실행 · OS 자동 시작 등록 없이 Managing으로 제어
- 기본 접속은 localhost · macOS·Windows에서 선택적으로 `https://fast-jira.local` 자동 설정 시도(승인 취소·검증 실패 시 localhost 사용). Windows UAC·브라우저 실기기 검증은 별도
- MCP 조회·수정 · 수정은 지원 클라이언트의 확인 UI에서 사용자 승인 필요
- 댓글 좋아요·이모지 반응 미지원. 답글은 Jira의 미문서화 동작에 의존

---

<div align="center">

Made by [hellojianijinworld](https://github.com/hellojianijinworld) · Jira와 Atlassian의 공식 제품이 아닙니다.

</div>
