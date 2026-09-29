# Wi-Fi 로컬 테스트

접속 주소: http://192.168.10.64:3002

1. 이 PC와 휴대폰을 같은 Wi-Fi에 연결한다. 휴대폰에서 localhost는 휴대폰 자신을 가리키므로 위 IP 주소를 사용한다.
2. PC에서 `npm run dev:lan`을 실행한다. PC가 켜져 있고 절전 상태가 아니어야 한다. DB는 기존 로컬 DB를 사용하며 자동 발송 작업은 꺼져 있다.
3. 다른 기기 접속이 차단되면 관리자 PowerShell에서 `& '.\scripts\enable-lan-firewall.ps1'`을 실행한다. 이 규칙은 Wi-Fi 인터페이스·현재 PC IP·TCP 3002·로컬 서브넷만 허용한다. 공유기 포트포워딩은 하지 않는다.
4. Slack 로그인을 위해 Supabase Redirect URLs에 `http://192.168.10.64:3002/api/auth/slack/callback`을 추가한다. 기존 localhost 콜백과 Slack 앱의 Supabase 콜백은 유지한다.
5. 테스트 종료 후 서버를 중지한다. 방화벽 규칙은 관리자 PowerShell의 `Remove-NetFirewallRule -DisplayName 'Meeting Room Booking LAN Test'`로 제거할 수 있다.

LAN 테스트 전용 환경 파일은 `.env.lan.local`이다. IP가 바뀌면 `LAN_TEST_HOST`, `APP_BASE_URL`, Supabase 콜백, 방화벽 규칙의 IP를 함께 변경한다. 게스트 Wi-Fi의 기기 간 통신 차단 기능이 켜져 있으면 같은 Wi-Fi에서도 연결되지 않을 수 있다.

이 구성은 신뢰하는 동일 Wi-Fi에서 사용하는 HTTP 개발 테스트다. 운영 배포는 HTTPS·운영 DB로 전환한다. LAN 서버의 개발 이메일함은 호스트 이름과 관계없이 차단한다. 이메일 재인증 테스트는 PC의 기존 로컬 개발 이메일함에서 같은 DB에 생성된 코드를 확인해 입력한다. 서버 간 세션 키가 다르면 코드는 해당 요청 서버에서만 검증된다.

현재 PC에서 로그인 페이지와 설정 API 응답, Slack 인증 시작, 잘못된 Origin의 403 차단, 개발 이메일함의 404 차단을 검증했다. 실제 다른 기기에서의 접속은 별도 확인이 필요하다.
