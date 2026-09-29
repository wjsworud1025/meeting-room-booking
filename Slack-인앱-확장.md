# Slack 인앱 확장 — 2026-09-29

기준 커밋: `84d2a7a` (기존 웹 예약 시스템과 단일 워크스페이스 Slack 시제품).
개발 브랜치: `codex/slack-in-app`.

## HRI 단일 클래스 시범 적용 준비 (최신 변경)

대상: `hri-ser1.slack.com` / `T0BFUQGG5UN` / **AI 서비스 개발_1회차**. `config/slack-hri-test.json`에 기록했다. migration 004 및 `scripts/slack-prepare-class.ts`로 기존 공통 회의실에 클래스 매핑을 추가했다. 테스트 클래스의 종료일은 미정이므로 로컬 준비 스크립트에서는 9999-12-31을 사용한다. 실제 종료 시에는 기존 기수 종료 기능으로 접근을 회수한다.

이 클래스의 자동 등록 모드는 아래의 기존 웹 계정 연결 절차를 대체한다. 앱을 열거나 예약할 때 Slack `users.info`로 본인 및 선택한 참여자의 소속·활성 상태를 검증하고 이메일 없이 STUDENT 계정을 생성한다. 전체 명단을 가져오지 않는다. 같은 workspace의 활성 게스트는 허용하며 봇·Slackbot·비활성·외부 workspace 사용자는 거절한다. 이미 비활성화한 내부 계정을 자동으로 재활성화하지 않는다. 기존 관리자의 역할도 변경하지 않는다.

예약 모달은 Slack 구성원 선택기를 사용한다. 초대받는 사람의 최초 웹 로그인도 필요 없다. 동일 시설의 회의실·시간 충돌 검사는 그대로 공유한다. 현재 관리자 계정 자체의 예약 및 여러 workspace에 걸친 동일인 병합은 별도 구현이 필요하다. 이번 실제 시범 대상은 HRI 한 곳으로 제한한다. 웹 이메일 로그인은 이메일 없는 자동 등록 계정에 제공하지 않는다.

필요한 bot scopes는 `chat:write`, `users:read`이다. 이메일 조회·채널 대화 읽기 권한은 요청하지 않는다. 기존 설치 OAuth의 요청·검증과 참고 manifest를 변경했으며, 실제 Slack 앱 권한은 아직 변경하지 않았다. Slack 비활성화는 다음 앱 사용/예약 검증 때 차단하며 기존 예약 자동 정리는 아직 Slack 계정 상태 변경 이벤트와 연동하지 않았다.

검증: 단위 테스트 82개, PostgreSQL 통합 검사 51개, 타입 검사 및 운영 SQL 반복 적용 통과. 자동 등록 경합, 차단 계정 보존, 외부 참가자 거절, 4개 클래스 동시 신청 시 공용 회의실 1건 확정을 검증했다. 기존 회원과 예약은 변경하지 않았고 실제 HRI 구성원도 아직 가져오지 않았다.

실제 설치의 남은 조건: 기존 앱의 배포 활성화, `users:read` 승인, 대상 workspace 설치 및 설치용 HTTPS 주소. 로컬 `.env.slack-install.local`은 비밀값을 Git에서 제외하고 설치 비활성 상태로 준비했다. `scripts/slack-install-server.ts`는 127.0.0.1:3003에서 설치 시작·callback 두 경로만 제공한다. 공개 터널을 사용한다면 이 전용 listener만 연결하며 로컬 웹앱·개발 이메일함은 노출하지 않는다. 아직 터널은 시작하지 않았다.

## 범위

이번 버전은 **동일 시설·동일 등록 학생 명단을 공유하는 승인된 워크스페이스**를 지원한다. 다른 학교·기관의 데이터를 분리하는 멀티테넌트 서비스는 아니다. `SLACK_ALLOWED_WORKSPACE_IDS`에 추가하면 그 워크스페이스에 연결된 등록 계정도 기존 시설·학생 명단을 사용할 수 있으므로 같은 운영 범위의 워크스페이스만 추가한다. Slack 설치 자체로 계정이나 관리자 권한을 생성하지 않는다.

## 사용자 흐름

1. 운영자가 대상 워크스페이스 ID를 승인 목록에 등록한다.
2. 설치 담당자가 `https://서비스주소/api/slack/install?team=워크스페이스ID`에서 Slack 설치 동의를 완료한다.
3. 설치 완료 후 해당 워크스페이스의 앱 홈으로 돌아온다.
4. 학생이 앱 홈의 계정 연결을 눌러 Slack 개인 인증을 완료한다. 기존 ACTIVE 회원의 인증 ID·검증된 이메일을 확인하고 연결한 뒤 앱 홈으로 돌아온다.
5. 예약 신청 버튼에서 날짜·회의실·시작 시간·30~120분·참여자를 선택한다. 기존 예약 엔진으로 검증·저장하며 초대 인원은 자동 참여한다.

설치 OAuth와 개인 로그인 OIDC는 별도 동의 과정이다. 기존에 다른 Slack 계정에 연결된 회원은 자동으로 덮어쓰지 않는다. 현재 회원당 Slack 계정 하나만 연결할 수 있다. 관리자 계정은 관리자 웹 링크만 제공한다.

## 구현

- 설치: `/api/slack/install` 및 `/api/slack/install/callback`. 요청과 브라우저 쿠키에 연결한 서명 state(10분), 허용 workspace, 응답 app ID, bot scope를 검사한다. Enterprise 조직 단위 설치와 토큰 rotation은 현재 지원하지 않으며 해당 응답은 거절한다.
- 저장: `003_slack_installations.sql`. 워크스페이스별 봇 토큰을 AES-256-GCM으로 암호화하며 workspace ID를 인증 데이터로 사용한다. DB ciphertext를 다른 workspace로 옮기면 복호화가 실패한다.
- 실행: Bolt `authorize`로 요청별 토큰을 선택하고 listener의 `client`로만 Slack API를 호출한다. 기존 단일 workspace 환경 토큰은 이전용 fallback이며 다른 workspace에는 재사용하지 않는다.
- 해제: `app_uninstalled` 이벤트로 토큰을 지우고 해제 상태를 남긴다. 해제한 설치는 환경 토큰 fallback도 차단한다. 재설치 시 새 토큰으로 복구한다.
- 로그인: 앱 홈의 workspace 정보를 개인 인증 요청과 서명된 흐름 쿠키에 보존한다. 허용된 다른 workspace로 바꿔 로그인해도 요청과 다르면 거절한다. 성공 후 `SLACK_APP_ID`가 설정되어 있으면 원래 Slack 앱으로 돌아온다.

## 설정과 활성화

웹 OAuth 프로세스: `APP_BASE_URL`(HTTPS), `SLACK_INSTALL_ENABLED=true`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_APP_ID`, `SESSION_SECRET`, `SLACK_TOKEN_ENCRYPTION_KEY`, `SLACK_ALLOWED_WORKSPACE_IDS`, `DATABASE_URL`.

Socket Mode 프로세스: `SLACK_APP_TOKEN`, `SLACK_APP_ENABLED=true`, 같은 `DATABASE_URL`, `SLACK_TOKEN_ENCRYPTION_KEY`, `SLACK_ALLOWED_WORKSPACE_IDS`, `SLACK_APP_ID`, `APP_BASE_URL`. 기존 `SLACK_WORKSPACE_ID`는 승인 목록에 자동 포함한다. 암호화 키는 안전하게 생성한 32바이트의 hex 64자이며 웹과 봇에 동일하게 설정한다. 키를 교체하면 저장된 토큰 재암호화 또는 앱 재설치가 필요하다.

1. `npm run db:migrate`를 실행한다. 운영의 SQL 직접 적용본 `scripts/production-schema.sql`에도 새 migration이 포함되어 있다.
2. Slack 앱의 기존 Supabase 로그인 callback을 보존하고, OAuth Redirect URLs에 `https://서비스주소/api/slack/install/callback`을 추가한다.
3. 배포 설정을 활성화하고 bot scope `chat:write`, Home Tab, Socket Mode, Interactivity 및 bot events `app_home_opened`, `app_uninstalled`를 확인한다. manifest 참고 파일 전체로 기존 로그인 설정을 덮어쓰지 않는다.
4. Supabase 로그인 callback 허용 목록에는 `https://서비스주소/api/auth/slack/callback`을 추가한다. 등록 학생의 `auth_user_id`는 실제 Supabase 사용자와 일치해야 한다. 로컬 자동 등록의 임의 ID만으로는 Slack 개인 로그인이 연결되지 않는다.
5. 웹과 `npm run dev:slack-app`을 실행하고 설치 링크를 연다. 설치 승인·학생 로그인·실예약을 각각 확인한다.

Socket Mode의 예약 팝업은 PC의 외부 WebSocket 연결로 동작한다. 그러나 외부 사용자의 설치·개인 로그인 callback에는 접근 가능한 HTTPS 주소가 필요하다. 현재 LAN HTTP 주소는 설치 경로에서 명시적으로 거절한다. PC와 DB·봇 프로세스가 종료되면 사용할 수 없다.

## 검증 결과 및 남은 작업

- 단위 테스트 70개, 타입 검사 통과. 설치 state 변조·만료·브라우저 불일치, 잘못된 workspace/app/scope, 암호화 무결성, workspace별 토큰 선택, 개인 인증 workspace 변경 차단을 포함한다.
- 분리된 실제 PostgreSQL에서 통합 검사 49개 통과. 두 workspace의 토큰 분리, 해제·재설치와 기존 예약 동시성·중복 방지 회귀를 포함한다.
- 운영 SQL을 별도 DB에 두 번 적용하는 검사 통과. 테스트 중 기존 회원·예약 데이터는 변경하지 않았다.
- 로컬 DB에 migration 003 적용 후 새 봇을 재시작했다. 기존 승인 workspace의 Socket Mode 연결과 실제 관리자 앱 홈 새로고침을 확인했다.
- 다른 workspace의 실제 설치 및 학생 모달 종단 검증은 아직 수행하지 않았다. 대상 workspace ID, HTTPS 주소, 실제 등록 학생의 인증 연결이 필요하다. 외부 Slack 앱 배포 설정은 이번 코드 변경만으로 자동 활성화되지 않는다.

공식 문서: [OAuth 설치](https://docs.slack.dev/authentication/installing-with-oauth/), [요청별 인증](https://docs.slack.dev/tools/bolt-js/concepts/authorization/), [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/).
