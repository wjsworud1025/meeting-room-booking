# Supabase 운영 준비 진행 상태

- 프로젝트: meeting-room-booking
- 조직: Meeting Room Booking (Free)
- 프로젝트 ID: ufflzvtktyhmyucnqrsr
- 리전: Seoul / ap-northeast-2
- 프로젝트 URL: https://ufflzvtktyhmyucnqrsr.supabase.co
- 프로젝트 상태 Healthy 확인. 원격 DB에 001_initial.sql 및 002_holidays.sql 적용 완료.
- 별도 운영 환경 파일에 프로젝트 URL 반영. API 키·DB 비밀번호는 아직 미입력.
- scripts/production-schema.sql 준비: 001·002 마이그레이션과 적용 이력 포함. 임시 PostgreSQL에 두 번 실행 성공. 샘플 사용자·예약 생성 없음. 원격 DB 적용 완료. members=0, reservations=0, public.booking_migrations RLS=true 검증. 이력 조회를 최소 권한 앱 계정에서 실행하려면 명시적인 읽기 정책 또는 별도 운영 점검 계정이 필요합니다.

## 도메인 없이 시작하는 순서

1. Resend 가입·로그인으로 메일 서비스 계정을 준비합니다.
2. 기관 소유 도메인의 하위 도메인을 쓸 수 있는지 확인합니다. 없다면 원하는 도메인을 등록해야 하며 구매 비용과 소유자를 먼저 결정합니다.
3. 도메인 확보 후 Resend가 보여주는 실제 DNS 레코드로 소유권·발신 인증을 완료합니다. 기존 레코드를 임의로 대체하지 않습니다.
4. 검증된 발신 주소로 Supabase 인증용 SMTP와 앱 알림용 SMTP를 각각 설정하고 시험 계정으로 수신을 확인합니다.

Resend 운영 발신은 소유한 도메인의 검증이 필요합니다. gmail.com은 본인이 소유한 발신 도메인이 아니므로 등록할 수 없습니다. https://resend.com/docs/dashboard/domains/introduction

Supabase 프로젝트용 유료 Custom Domain 추가 기능을 구매할 필요는 없습니다. 이번 발신 도메인 준비와 Supabase API의 커스텀 도메인은 별개입니다. Supabase 프로젝트 주소는 이미 발급됐습니다.
