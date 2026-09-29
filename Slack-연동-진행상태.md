# Slack 로그인 연결 상태

## 최신 결과: 관리자 Slack 로그인 성공

사용자 승인으로 기존 ACTIVE 관리자도 Slack 로그인을 허용했다. 학생은 /schedule, 관리자는 /admin/reservations로 이동한다. 관리자 역할은 DB에서만 읽으며 Slack 지위로 승격하지 않는다. verifiedAt=0을 유지하므로 민감한 작업에는 이메일 재인증이 필요하다.

로컬 관리자의 기존 인증 ID와 Supabase 인증 ID가 달랐다. 동일 이메일을 Supabase Users에서 확인하여 기존 로컬 관리자 계정을 연결하고 access_version을 올렸으며 감사 이력을 남겼다. 역할과 상태는 변경하지 않았다.

실제 Slack 인증 후 관리자 예약 현황에 진입하여 이름과 예약 데이터 로딩을 확인했다. 테스트 총 41개 및 타입 검사 통과. 이 검증은 127.0.0.1:3001 로컬 테스트 환경이며 운영 배포 검증은 아니다. 아래 학생 전용 차단 기록은 관리자 허용 이전의 진단 이력이다.

## 이전 설정 및 진단 이력

확인일: 2026-09-29

- 워크스페이스: 연결 테스트 (`T0C4QQ11V2B`)
- 앱: Meeting Room Booking Login (`A0C4QRGDJ0P`)
- Client ID: `12160817063079.12160866460023`
- 콜백 URL 저장 완료: `https://ufflzvtktyhmyucnqrsr.supabase.co/auth/v1/callback`
- 사용자 요청 범위 저장 완료: `openid`, `profile`, `email`
- 봇 권한 없음. 앱 설치 및 사용자 동의는 아직 수행하지 않음.
- Supabase Slack (OIDC) 활성화 완료. 사용자가 인증정보를 저장한 뒤 공급자 목록에서 Enabled 상태를 확인했다. 실제 OAuth 로그인으로 Client Secret의 유효성을 검증한 상태는 아니다.

## 다음 작업

1. 완료: 사용자가 Slack Client ID와 Client Secret을 Supabase Slack (OIDC)에 입력하고 활성화하여 저장했다. 비밀값은 문서나 채팅에 기록하지 않는다.
2. 완료: 예약 앱에 학생 Slack 로그인 버튼, POST 시작 API, PKCE 콜백, 기존 세션 발급을 구현했다. Slack userInfo API로 직접 워크스페이스와 검증된 이메일을 확인한다. 기존 활성 학생의 auth_user_id가 일치해야 하며 자동 회원 생성 및 관리자 권한 부여는 하지 않는다. 최초 연결 이후 다른 Slack 계정으로 바꿀 수 없다.
3. 완료: 모의 제공자·DB를 이용한 인증 테스트 16개 및 기존 테스트 포함 총 40개 통과. 실제 Slack 계정의 로그인 및 운영 DB 접속은 아직 검증 전이다.

## 실행 환경 연결에 필요한 작업

### 별도 로컬 테스트 환경 준비 완료

- `.env.slack.local` 생성: 기존 로컬 DB를 사용하고 작업 발송 루프는 `RUN_JOBS=false`로 비활성화한다. 운영 DB에는 연결하지 않는다.
- `npm run dev:slack`으로 `http://127.0.0.1:3001` 실행. 빌드 캐시는 `.next-slack`으로 분리한다.
- 공개 API 키 미입력 시 로그인 시작 API가 503 CONFIGURATION으로 차단되는 것을 확인했다. 이후 기존 Publishable key를 테스트 환경에 연결하고 서버를 재시작했다. 관리자 Secret key는 사용하지 않았다.
- Supabase 콜백 `http://127.0.0.1:3001/api/auth/slack/callback` 등록 완료. 성공 알림과 등록 목록을 확인했다.
- 실제 로그인 버튼에서 Supabase를 거쳐 연결 테스트 워크스페이스의 Slack 사용자 동의 화면까지 진입했다. 현재 사용자 동의 대기 중이며 코드 교환·앱 세션 발급은 아직 검증 전이다.
- 실제 테스트 학생의 Auth ID 연결은 별도 검증이 필요하다. 현재 계정이 예약 DB에 활성 학생으로 등록돼 있지 않다면 인증을 승인해도 예약 앱은 로그인을 거부한다. 기존 관리자 계정을 학생으로 변경하지 않는다.

### 실제 인증 검증 결과

- Slack 이메일 본인 확인과 사용자 동의 완료.
- 초기 테스트 서버의 외부 HTTPS 접근이 EACCES로 차단되어 인증 코드 교환이 실패했다. 네트워크 접근이 허용된 실행 환경으로 테스트 서버를 재시작해 해결했다.
- 재검증에서 Supabase 코드 교환, Supabase 사용자 검증, Slack userInfo 조회 및 응답 검증, DB 접속을 통과했다. 마지막 단계는 `member / ACCOUNT_DENIED`다.
- 로그인에 사용한 계정은 로컬 예약 DB의 ACTIVE ADMIN이다. 현재 Slack 로그인은 학생 전용이므로 세션 발급을 거부하는 것이 의도한 동작이다. 관리자 역할이나 상태는 변경하지 않았다.
- 실제 학생 로그인 성공 검증에는 별도의 Slack 학생 테스트 계정 및 기존 예약 계정의 Auth ID 연결이 필요하다.
- 실패 단계와 고정 오류 코드만 기록하는 진단 로그를 추가했다. 임시 디버그 로그는 제거했고 타입 검사 및 인증 테스트 16개가 통과했다.

1. `.env.release.local`에 `APP_BASE_URL`, `DATABASE_URL`, `SUPABASE_ANON_KEY`를 입력한다. 기존 계정 프로비저닝에는 `SUPABASE_SERVICE_ROLE_KEY`도 필요하다. Slack Client Secret은 Supabase에만 보관하고 예약 앱에 복사하지 않는다.
2. `SLACK_WORKSPACE_ID=T0C4QQ11V2B`, `SLACK_LOGIN_ENABLED=true`를 설정한다. 준비되지 않은 환경은 false로 유지한다.
3. Supabase Authentication → URL Configuration → Redirect URLs에 `APP_BASE_URL` 뒤에 `/api/auth/slack/callback`을 붙인 정확한 주소를 추가한다. Slack 앱의 콜백은 기존 Supabase `/auth/v1/callback` 주소를 유지한다. 두 콜백은 서로 다르다.
4. 등록된 활성 학생의 Supabase Auth ID가 예약 DB의 auth_user_id와 일치하는지 확인하고 실제 로그인을 수행한다. 관리자 계정은 이메일 OTP를 유지한다.

로컬 실연동 테스트를 한다면 `.env.local`에 별도로 Supabase URL/API 키와 허용 워크스페이스를 설정하고, 실제 Supabase에 프로비저닝된 테스트 학생을 사용한다. 로컬 샘플 계정만으로 실제 Slack 인증은 통과할 수 없다. 로컬 콜백도 Supabase 허용 목록에 정확하게 추가해야 한다.

로그인 흐름 쿠키는 HttpOnly·SameSite=Lax, 운영 Secure, 10분 만료 및 HMAC 검증을 적용한다. PKCE 인증 코드는 제공자에서 한 번만 교환할 수 있으며 콜백 성공/실패 시 임시 쿠키를 삭제한다. Slack 토큰은 서버에서만 사용하며 브라우저 URL·로그에 기록하지 않는다. 기존 인증 세션 수명 안에서 로그인 상태를 유지하고 만료 후 재인증한다.

참고: [Supabase Slack OIDC](https://supabase.com/docs/guides/auth/social-login/auth-slack), [Slack userInfo](https://docs.slack.dev/reference/methods/openid.connect.userInfo/).
