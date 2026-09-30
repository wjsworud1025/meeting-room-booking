# Slack 인앱 확장 — 2026-09-29

기준 커밋: `84d2a7a` (기존 웹 예약 시스템과 단일 워크스페이스 Slack 시제품).
개발 브랜치: `codex/slack-in-app`.

## 현재 사용 흐름 — Slack → 웹 (최신)

Slack 홈은 회의실 예약하기, 새로고침, 내 예약 최대 3건과 예약 관리만 표시한다. 이미지 생성·업로드 및 Slack 내부 시간표 코드를 제거했다. 회의실 예약하기를 한 번 누르면 기존 웹 시간표가 바로 열린다. 중간 팝업과 이메일·비밀번호 입력은 없다. 기존 Slack 팝업 제출은 차단하고 새 흐름으로 안내한다.

- 32바이트 난수 링크는 클릭 대기 상태로 최대 12시간 유지하며 이 상태에서는 로그인할 수 없다. 인증된 Slack 클릭 이벤트의 workspace·사용자와 일치해야 2분 유효·1회용으로 활성화한다. DB에는 SHA-256 해시만 보관한다. URL fragment로 전달하고 진입 즉시 주소에서 제거한 뒤 동일 출처 POST로 교환한다. 웹은 클릭 이벤트 처리를 최대 10초간 자동 대기하며 동시 재사용은 DELETE RETURNING으로 차단한다.
- Slack 학생 웹 세션은 8시간 유효하다. 요청마다 승인 workspace·설치 해제·클래스·계정 상태·접근 버전·학생 역할을 검사하고 Slack 활성 상태는 최대 60초 캐시로 확인한다. 관리자 인증으로 인정하지 않는다.
- SLACK_WEB_BASE_URL을 봇과 웹에 동일하게 지정한다. 운영은 HTTPS 필수, 현재 LAN 테스트는 http://192.168.10.64:3002. 웹 서버에도 SLACK_ALLOWED_WORKSPACE_IDS와 SLACK_TOKEN_ENCRYPTION_KEY가 필요하다. migration 005·006을 적용한다.
- 실제 HRI 전재경 계정으로 Slack → 웹 자동 연결, 기존 확정 예약 상세와 시간·방 변경 및 취소 버튼 표시를 확인했다. 기존 예약을 실제 변경·취소하지 않았다. 잘못된 Origin은 403, 1회용 링크 동시 요청은 200/401을 확인했다.
- 웹의 신규 예약·기존 예약 초대에서 이름으로 구성원을 검색한다. Slack 세션은 해당 workspace의 users.list를 페이지별 조회해 활성 구성원 이름만 최대 60초 캐시하며, 검색만으로 전체 명단을 DB에 등록하지 않는다. 선택할 때 users.info로 다시 확인하고 선택한 구성원만 자동 등록한다. 봇·외부 구성원·비활성 계정·기존 관리자 및 이미 참여 중인 사람은 제외한다. 일반 웹 세션은 기존 등록 학생을 검색한다. 기존 users:read 권한을 사용하므로 재설치가 필요 없다.
- 이전 files:write 권한으로 업로드한 파일이나 Slack 권한 자체는 삭제·회수하지 않았다. 현재 실행 코드에는 이미지 업로드 기능이 없고 이후 설치 요청에는 files:write를 요청하지 않는다.

아래 내용은 이전 구현 이력이며 위 흐름이 우선한다.

### 원클릭 및 사이드바 검증

2026-09-29 HRI 앱의 회의실 예약하기 한 번 클릭으로 전재경 교육생의 `/schedule`이 열린 것을 확인했다. 타입 검사 및 단위 테스트 93개 통과. HRI 웹에서 미등록 구성원 이름 검색 결과도 확인했다. 실제 서버에서도 클릭 전 202 대기, 다른 사용자 활성화 차단, 본인 활성화 후 동시 교환 200/401을 확인했다.

현재 HRI 예약 앱은 이미 사이드바 즐겨찾기에 등록되어 있다. 즐겨찾기는 앱 홈을 열며 외부 웹으로 직접 이동하는 버튼은 아니다. Slack의 홈·DM 같은 전역 탐색 탭에 임의의 외부 웹 버튼을 추가하는 공식 방식은 확인되지 않았다. 채널 상단에는 링크 탭을 추가할 수 있지만 사이드바와는 별개다. 공유 링크에는 개인별 일회용 인증 링크를 사용하지 않는다.

공식 근거: [URL 버튼 및 클릭 이벤트](https://docs.slack.dev/reference/block-kit/block-elements/button-element), [사이드바 설정](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences), [채널 상단 탭](https://slack.com/help/articles/32562841868307-Add-and-manage-tabs-in-channels-and-direct-messages).

## HRI 단일 클래스 시범 적용 준비 (최신 변경)

대상: `hri-ser1.slack.com` / `T0BFUQGG5UN` / **AI 서비스 개발_1회차**. `config/slack-hri-test.json`에 기록했다. migration 004 및 `scripts/slack-prepare-class.ts`로 기존 공통 회의실에 클래스 매핑을 추가했다. 테스트 클래스의 종료일은 미정이므로 로컬 준비 스크립트에서는 9999-12-31을 사용한다. 실제 종료 시에는 기존 기수 종료 기능으로 접근을 회수한다.

이 클래스의 자동 등록 모드는 아래의 기존 웹 계정 연결 절차를 대체한다. 앱을 열거나 예약할 때 Slack `users.info`로 본인 및 선택한 참여자의 소속·활성 상태를 검증하고 이메일 없이 STUDENT 계정을 생성한다. 전체 명단을 가져오지 않는다. 같은 workspace의 활성 게스트는 허용하며 봇·Slackbot·비활성·외부 workspace 사용자는 거절한다. 이미 비활성화한 내부 계정을 자동으로 재활성화하지 않는다. 기존 관리자의 역할도 변경하지 않는다.

예약 모달은 Slack 구성원 선택기를 사용한다. 초대받는 사람의 최초 웹 로그인도 필요 없다. 동일 시설의 회의실·시간 충돌 검사는 그대로 공유한다. 현재 관리자 계정 자체의 예약 및 여러 workspace에 걸친 동일인 병합은 별도 구현이 필요하다. 이번 실제 시범 대상은 HRI 한 곳으로 제한한다. 웹 이메일 로그인은 이메일 없는 자동 등록 계정에 제공하지 않는다.

필요한 bot scopes는 `chat:write`, `users:read`이다. 이메일 조회·채널 대화 읽기 권한은 요청하지 않는다. 기존 설치 OAuth의 요청·검증과 참고 manifest를 변경했으며, 실제 Slack 앱과 HRI 설치에 두 권한을 반영했다. Slack 비활성화는 다음 앱 사용/예약 검증 때 차단하며 기존 예약 자동 정리는 아직 Slack 계정 상태 변경 이벤트와 연동하지 않았다.

검증: 단위 테스트 82개, PostgreSQL 통합 검사 51개, 타입 검사 및 운영 SQL 반복 적용 통과. 자동 등록 경합, 차단 계정 보존, 외부 참가자 거절, 4개 클래스 동시 신청 시 공용 회의실 1건 확정을 검증했다. 기존 회원과 예약은 변경하지 않았다. 이후 실제 앱 홈 접속으로 본인 1명의 HRI 학생 계정 자동 등록을 확인했다.

### 실제 설치 진행 상태

사용자 승인 후 기존 앱에 `users:read`와 설치 전용 HTTPS callback을 추가하고 외부 workspace 배포를 활성화했다. 기존 Supabase callback 및 로그인 scope는 보존했다. HRI 설치 요청에는 bot scope `chat:write`, `users:read`만 포함하며 개인 OIDC scope를 요청하지 않는다.

Cloudflare 공식 실행 파일을 `.local/tools/cloudflared.exe`에 받아 설치 전용 포트 3003에 연결했다. 공개 주소에서 `/dev/mailbox`, `/api/config`는 404, 미승인 workspace의 설치 시작은 403으로 차단됨을 확인했다. 기존 client secret은 `.env.slack-install.local`에만 저장했다.

사용자의 약관 동의 승인을 받아 HRI 설치를 완료했다. 설치 토큰은 DB에 암호화 저장했으며 본인 전재경의 ACTIVE STUDENT 자동 등록과 앱 홈 표시를 확인했다. 기존 관리자 권한은 유지했다. 이후 사용자가 지정한 참여자와 시간으로 실제 테스트 예약을 생성했다.

사용자가 직접 클릭하여 예약 팝업이 열리는 것을 확인했다. 서버에서도 block_actions와 view_submission 이벤트 수신을 확인했다. 앞선 자동 클릭의 무응답은 실제 이용에서도 발생하는 장애로 재현되지 않았다. 2026-09-29 실제 Slack UI에서 18:00–19:00 회의실 02, 신청자와 사용자가 지정한 참여자 총 2명 예약을 확정했다. 성공 모달, 앱 홈의 예약 확정·2명 표시, DB CONFIRMED 및 ACCEPTED 2건, 명령 응답 200을 확인했다. 예약 ID: 0314a57f-051c-44a0-83c0-6374ac2d4d11. 앞선 중복 시간 제출은 ROOM_UNAVAILABLE/409로 거절됐고 추가 예약이 생성되지 않았다. SLACK_DIAGNOSTICS=true에서는 요청 유형만 기록한다.

설치 후 Cloudflare 터널과 포트 3003 listener를 종료하고 SLACK_INSTALL_ENABLED=false로 되돌렸다. Socket Mode 봇은 독립적으로 실행 중이다. 추후 재설치 시 새 설치 전용 HTTPS 주소를 등록해야 한다.

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
- HRI 실제 설치와 학생 자동 등록은 완료했다. 학생 모달 열기와 제출 이벤트 수신도 확인했다. 실예약 저장·앱 홈 표시 및 중복 거절도 확인했다. 위의 최신 진행 상태를 참고한다.

공식 문서: [OAuth 설치](https://docs.slack.dev/authentication/installing-with-oauth/), [요청별 인증](https://docs.slack.dev/tools/bolt-js/concepts/authorization/), [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/).




## Slack 시간표 UI 반영

홈에 날짜 선택·이전/오늘/다음 이동, 기본 운영시간·공휴일 이름, 회의실별 점유 시간·예외 개방·휴관, 예약 가능한 시작 시간 버튼을 추가했다. 웹과 동일한 availableDurations/calendarSlots를 사용하며 서버는 제출 시 다시 검증한다. 시간 버튼 클릭 시 최신 상태를 조회하고 회의실·날짜·시작 시간 및 기본 이용 시간(가능하면 60분, 아니면 30분)을 채운 모달을 연다. 내 예약은 하단에서 최근 5건을 표시한다. Slack 블록 제한에 맞춰 회의실은 5개, 시간 버튼은 행당 5개로 구성했다.

실제 HRI 홈 표시와 회의실 02의 19:00 선택 → 30분 자동 입력을 확인했다. 기존 예약은 유지했고 UI 검증용 추가 예약은 생성하지 않았다. 타입 검사 및 단위 테스트 86개 통과. 이번 범위는 시간표 조회와 신규 예약 흐름이며 Slack 내 예약 변경·취소 버튼은 후속 구현 대상이다.

## 웹 스타일 시각화 리팩터링 (2026-09-29)

- 웹의 배경·선·청록 강조·예약 상태 색상을 반영한 PNG 시간표를 실제 DB snapshot에서 생성한다. 같은 availability 함수와 시간 단위를 사용하며 SVG 라벨을 이스케이프한다. 타인의 이름은 이미지에 넣지 않고 내 예약은 테두리와 문구로 강조한다.
- 전체 회의실 또는 회의실 하나를 선택해 크게 볼 수 있다. 이미지 아래 텍스트 현황·시간 버튼을 유지해 색상과 이미지에만 의존하지 않는다. 예약 입력 및 제출 시 서버 검증은 그대로 유지한다.
- HRI에 files:write를 승인받아 재설치했다. SLACK_TIMETABLE_IMAGES=true일 때 채널 지정 없이 Slack 파일로 업로드해 앱 홈에 표시한다. 외부 공개 이미지 서버는 사용하지 않는다. workspace와 이미지 내용별 메모리 캐시(최대 100개)로 같은 이미지 재업로드를 줄인다. 봇 재시작 시 캐시는 초기화되며 업로드한 파일의 자동 삭제는 아직 구현하지 않았다.
- Slack 이미지 처리 지연에만 최대 2회 재시도하고 계속 실패하면 텍스트 시간표를 표시한다. 업로드 실패도 기존 예약 UI를 유지한다. 재설치용 HTTPS 터널·listener는 종료하고 설치를 비활성화했으며 임시 callback을 Slack manifest에서 제거했다.
- 실제 HRI 앱 홈의 전체 이미지와 회의실 02 확대 이미지 표시를 확인했다. Slack의 이미지 미리보기 축소, 기본 글꼴·버튼·팝업 및 이미지 직접 드래그 불가 제약은 유지된다. 전체 화면 90% 유사도 달성을 주장하지 않는다. 정확한 웹 조작은 별도 웹 화면이 필요하다.

로컬 미리보기: npx tsx --env-file=.env.slack-app.local scripts/preview-slack-timetable.ts TEAM_ID USER_ID
결과: test-results/slack-visual-timetable.png, test-results/slack-visual-room.png

최종 검증: 타입 검사 및 단위 테스트 90개 통과.
