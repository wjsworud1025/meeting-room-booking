# Railway 운영

- 웹: https://booking-web-production-d872.up.railway.app
- 관리자: https://booking-web-production-d872.up.railway.app/admin/login
- 프로젝트: meeting-room-booking (ed7b8244-914b-443a-b476-de632a33fdcb)
- 서비스: booking-web + Postgres
- 웹과 Slack Socket Mode는 한 컨테이너에서 실행하며 어느 프로세스든 종료되면 함께 재시작합니다.
- RUN_JOBS=true, 단일 replica, 서버 절전 비활성 상태를 유지합니다.
- PostgreSQL은 Railway 내부 연결을 사용합니다. 공개 TCP 프록시는 생성하지 않았습니다.

## 배포

공식 Railway CLI 로그인 후 `railway up --service booking-web`를 실행합니다. Docker 빌드에 소스만 포함하며 .env, 로컬 DB, 이메일함, 테스트 결과는 업로드하지 않습니다. DB 마이그레이션은 시작 전에 실행됩니다. 운영에서 seed를 실행하지 않습니다.

초기 이관은 완료되었고 복호화키는 Railway에서 제거했습니다. 암호화된 원본 스냅샷은 .local에 보관합니다. 로컬 서버와 Slack 프로세스는 중지했습니다. 운영 이후 로컬 DB를 다시 덮어쓰지 마세요.

## 검증 결과 / 남은 확인

HTTPS, 운영 모드, DB health, 로컬 메일함 404, 비로그인 관리자 API 401, Slack Socket Mode 연결 및 HRI 학생의 자동 로그인·시간표 표시를 확인했습니다.

관리자 Supabase 이메일 로그인 실인증과 SMTP 알림 발송은 별도 검증이 필요합니다. 운영용 SMTP·Supabase 서비스 역할 키는 기존 준비 파일에 없어 이전하지 않았습니다. Slack에서 웹으로 이동하는 학생 인증은 이 설정 없이 검증되었습니다.

Railway CLI는 railway.json 지원 종료일을 2026-12-01로 안내하고 있습니다. 해당 날짜 전 공식 `railway config migrate`로 IaC 설정을 전환하세요.
