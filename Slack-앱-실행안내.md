# Slack 예약 앱 실행 안내

워크스페이스별 설치 확장 코드와 설정은 [Slack 인앱 확장](Slack-인앱-확장.md)을 참고한다. 새 브랜치에서는 실행 전 migration 003 적용이 필요하다. 아래 실제 연결 기록은 기존 단일 워크스페이스에서 확인한 결과다.

2026-09-29 구현. 현재 상태: 로컬 코드·타입·단위 테스트 54개 통과. 2026-09-29 사용자 승인 후 기존 앱 재설치, chat:write, Socket Mode, app_home_opened, Home Tab 연결 완료. 관리자 계정의 실제 앱 홈 표시 확인. 학생 계정의 Slack 실예약은 미검증.

## 제공 범위
- 앱 홈: 내 예약과 초대받아 참여 중인 예약, 새로고침, 웹 시간표 링크.
- 학생 예약 모달: 날짜, 회의실, 한국 시간 기준 시작 시간, 30/60/90/120분, 학생 검색·초대.
- 신청 시 기존 execute → booking.create 사용: 운영시간·휴관·정원·개인 중복·같은 모임 간격·제재 검증.
- 충돌 시 학생 이름·기존 시간 표시, 입력 내용을 유지한 재시도.
- Slack 재전송은 같은 모달·입력의 명령 키를 재사용. 웹과 동일 DB 트랜잭션 및 중복방지 적용.
- 관리자 계정은 관리자 웹 링크만 제공. Slack 자체에서 관리자 권한 변경이나 최근 인증을 부여하지 않음.

## 연결 준비
1. 기존 Slack 앱의 로그인 설정(openid/profile/email, Supabase callback)은 유지한다. config/slack-app-manifest.json은 봇 기능 참고용이다. 기존 manifest 전체를 덮어쓰지 않는다.
2. Bot Token Scope chat:write, App Home Home Tab, app_home_opened 이벤트, Interactivity, Socket Mode를 추가한다. 채널 메시지 읽기·이메일 조회 권한은 요청하지 않는다. 권한 추가 및 설치는 사용자 승인 후 실행한다.
3. 워크스페이스에 앱을 설치/재설치한다. Bot token(xoxb)과 connections:write가 있는 app-level token(xapp)을 .env.slack-app.local에 직접 저장한다. 채팅이나 Git에 기록하지 않는다.
4. SLACK_APP_ENABLED=true로 변경 후 npm run dev:slack-app 실행. 서버가 Slack에 나가는 WebSocket 연결을 사용하므로 공개 수신 URL은 필요하지 않다.
5. 등록된 학생이 웹의 Slack 로그인을 한 번 완료한 뒤 앱 홈을 연다. workspace ID + Slack user ID에 정확히 연결된 ACTIVE 계정만 허용한다. 현재 임시 이메일 전용 학생은 Slack에 연결되지 않아 사용할 수 없다.

## 검증
- npm run typecheck / npm test: 타입 검사 및 단위 테스트 54개 통과.
- npm run test:db: 분리된 PostgreSQL 테스트 DB에서 통합 검사 48개 통과. Slack 학생 계정 연결, 예약 생성, 동일 요청 중복 제출, 참여자 충돌, 종료 시각 경계, 휴관, 비활성 계정 차단 포함. 실제 Slack 학생 모달 조작 검증과는 별도다.
- 설치 후 연결 로그 확인, 미연결 사용자 거절, 학생 홈, 정상 예약, 개인 충돌, 휴관·정원 초과, 중복 제출을 검증한다.
- 실제 예약은 테스트용 학생과 시간으로만 생성한다. 통합 검사는 별도 테스트 DB에서 예약을 생성하고 DB를 정리했다. 기존 로컬 예약 데이터는 변경하지 않았으며 Slack 메시지는 발송하지 않았다.

## 운영 조건 및 제한
- PC, DB, Socket Mode 프로세스가 켜져 있어야 한다. 웹 링크는 현재 동일 Wi-Fi에서만 접근 가능하다.
- 홈은 열기·새로고침·성공한 예약 직후 갱신한다. 실시간 구독이나 드래그 시간표는 제공하지 않는다.
- 예약 처리 중 모달을 닫아도 요청은 처리될 수 있다. 결과는 홈에서 확인한다.
- 첫 버전의 예약 폼은 서버에서 신청 시 검증한다. 가능한 시간만 미리 필터링하는 UI는 기존 웹에서 제공한다.
- 기존 알림 작업은 로컬 모드에서 실제 Slack 전송을 하지 않는다. 앱 모달의 처리 결과와 홈 갱신은 작동한다. 운영 알림은 기존 jobs 설정과 별도로 검증해야 한다.
- SDK 설치: @slack/bolt. Next 개발 서버에 봇을 넣지 않고 별도 프로세스로 실행하여 HMR에 의한 중복 연결을 방지한다.

공식 참고: https://docs.slack.dev/tools/bolt-js/concepts/socket-mode/ · https://docs.slack.dev/surfaces/app-home/

## 연결 확인 결과 (2026-09-29)
- 기존 로그인 callback과 openid/profile/email 설정 유지.
- 봇 및 앱 레벨 토큰은 Git에서 제외된 .env.slack-app.local에 저장, 앱 실행 활성화.
- npm run dev:slack-app 실행 중. PC 또는 프로세스 종료 시 다시 실행해야 한다.
- 앱 홈: https://app.slack.com/client/T0C4QQ11V2B/D0C51HWAGA1
- 현재 Slack 로그인 사용자는 등록된 관리자. 학생 예약 버튼 검증에는 별도의 등록·연결된 학생 계정이 필요하다.
- 학생 9명 모두 아직 Slack 미연결. 별도 학생 이메일 확정 및 초대 승인 후 가입·이메일 인증을 진행한다. 기존 관리자 권한은 유지한다.
- 로컬 MEMBER_PROVISION은 임의 인증 ID를 만들므로 학생 등록만으로 Supabase Slack 로그인이 연결되지 않는다. 실제 인증 사용자 ID와 로컬 학생 계정의 연결도 확인해야 한다.
