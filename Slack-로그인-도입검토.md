# Slack 로그인 도입 검토

결론: 구현 가능. Supabase의 slack_oidc 공급자를 이용하는 학생 로그인부터 권장. 현재 구현된 기능은 아니며 설정을 변경하지 않았습니다.

## 사용자 흐름

Slack으로 로그인 → 최초 동의/워크스페이스 선택 → Supabase 인증 → 서버에서 허용 워크스페이스·등록 계정·활성 상태 확인 → 기존 예약 세션 발급.

세션이 유효하면 재방문 시 바로 화면을 보여줄 수 있습니다. Slack 데스크톱 앱에 로그인되어 있다는 것만으로 웹 브라우저가 자동 인증되지는 않습니다. 세션 만료·브라우저 변경·Slack 정책에 따라 다시 로그인해야 합니다.

## 현재 코드에 추가할 부분

- 로그인 시작·PKCE callback 경로, 성공 후 기존 암호화 HttpOnly 세션 발급.
- 허용 workspace ID 검증. 표시 이름이 아니라 검증된 Slack 사용자 ID·워크스페이스 ID와 기존 auth_user_id를 연결.
- 최초 연결은 공급자가 검증한 이메일 및 등록 명단으로 대조. 이메일 불일치·중복·이미 연결된 다른 계정은 자동 병합하지 않고 관리자 확인.
- DB의 slack_workspace_id·slack_user_id 필드 재사용. 미등록 계정에 예약 권한·관리자 역할을 자동 부여하지 않음.
- 기존 관리자 전용 계정·민감 변경 재인증·학생 비활성화/access_version 검사를 유지. Slack 관리자라는 이유로 예약 시스템 관리자 권한을 주지 않음.

## SMTP와의 관계

학생의 Slack 로그인에는 이메일 OTP 발송이 필요 없어 학생 로그인용 SMTP 의존성을 줄일 수 있습니다. 기존 관리자 이메일 인증·초대·이메일 알림은 남아 있어 SMTP를 전부 제거할 수는 없습니다. 이를 모두 Slack으로 옮기는 것은 별도 기능·운영 범위 변경입니다. 로그인 OIDC 권한과 알림 봇 권한은 별도 연결 흐름으로 구성합니다.

## 필요한 외부 설정

학교/교육기관 Slack 워크스페이스의 앱 설치 권한, Slack OAuth 앱, openid/profile/email 권한, Supabase Slack OIDC 공급자 설정, 앱 HTTPS callback 및 허용 redirect 설정이 필요합니다. Slack 설치 승인 또는 클라이언트 비밀키 입력 단계는 사용자 참여가 필요할 수 있습니다.

Supabase 공급자 callback: https://ufflzvtktyhmyucnqrsr.supabase.co/auth/v1/callback

실제 도입 전에 워크스페이스 식별자·설치 권한과 기존 등록 이메일의 일치 여부를 확인합니다. 외부 워크스페이스 로그인·이메일 불일치·관리자 승격 시도·해지 계정·세션 만료·callback 재사용을 인수 검사에 포함합니다.

## 공식 근거

- https://supabase.com/docs/guides/auth/social-login/auth-slack
- https://docs.slack.dev/authentication/sign-in-with-slack/
