# SaaS 데이터 이관·복구 리허설

검증일: 2026-09-30

## 판정
로컬 리허설에 이어 Railway 운영 데이터 중 승인된 16개 테이블의 암호화 백업과 별도 PostgreSQL 18 복원을 통과했다. 복원된 117행을 대상으로 로그인·고객 격리·Slack 작업 분리 마이그레이션 및 롤백 검증도 통과했다. 제한된 데이터 범위의 검증이며 전체 재해 복구 또는 운영 SaaS 전환 완료를 의미하지 않는다.

## 실측 결과
| 항목 | 결과 |
|---|---|
| 원본 | 기존 로컬 애플리케이션 DB, 읽기 전용 트랜잭션 |
| 보관 범위 | booking·identity 스키마의 25개 테이블, 166행 및 시퀀스 |
| 암호화 | AES-256-GCM, 복호화 키는 별도 Git 제외 경로에 저장 |
| 변조 탐지 | 암호문 1바이트 변경 시 복호화 거절 |
| 복원 검증 | 신규 DB에서 모든 FK 재검증, 전체 테이블 SHA-256 지문 일치 |
| SaaS 이관 | 고객 테이블 21개, 기존 업무 데이터 164행 보존 |
| 소유권 | hyundai_1st의 기존 account UUID와 첫 tenant OWNER 연결 보존 |
| 복구 | 두 번째 신규 DB로 사전 백업 복원, 지문 일치 및 saas_control 부재 확인 |
| 외부 작업 | Slack·메일·자동 작업 실행 없음 |

## 재실행
`npm run saas:rehearse:recovery`

APP_ENV=local 및 루프백 DB만 허용한다. 원본은 읽기 전용이고, 새 이름의 이관용·복구용 DB를 생성하여 보관한다. 기존 DB를 삭제하거나 덮어쓰지 않는다. 새 복원 DB의 초기 데이터만 비운 뒤 원본 행을 적재한다. 복원할 때 마이그레이션 파일 지문을 대조하여 코드 버전이 달라지면 중단한다.

검증 도구: scripts/saas/rehearse-recovery.ts

이번 백업: .local/backups/saas-recovery-1790739295511/application-snapshot.enc
검증 결과: .local/backups/saas-recovery-1790739295511/report.json
복호화 키: .local/recovery-keys/1790739295511.key

백업·키는 Git에 포함하지 않는다. 백업 전달 시 키를 같은 묶음으로 전달하지 않는다. 이것은 애플리케이션 데이터 복구 리허설이며 PostgreSQL 전체 물리 백업이 아니다. 서버 역할, 확장, WAL, Railway 볼륨, 외부 인증 서비스, 환경변수·암호화키, public 마이그레이션 원장은 별도로 보존·복구해야 한다. DB 복제본은 서비스에 연결하지 않는다.

## 최초 Railway 시도 및 정리 (후속 검증으로 해결)
- 운영 PostgreSQL의 외부 공개 주소가 없음을 확인했다. 외부 노출은 추가하지 않았다.
- 승인받은 임시 SSH 공개키를 등록했다. CLI 계정과 브라우저 계정, 등록 키 지문 일치를 확인했다.
- 기존 키의 Windows 권한 문제를 해결하기 위해 현재 사용자 전용 임시 키 파일을 사용했다.
- 공식 CLI 및 공식 연결 설정의 비대화형 SSH 모두 운영 DB 백업 명령 실행을 완료하지 못했다. 명시적인 인증 진단은 publickey 인증 거절이다. 근본 원인은 확정하지 않았다.
- 운영 데이터 다운로드·변경·배포는 하지 않았다.
- 임시 SSH 키 등록을 해제하고 Railway의 등록 키 0개를 확인했다.

## 운영 전환 전 필요한 작업
1. 전체 재해 복구 범위 확정: 이번 승인 범위 밖 데이터, public 마이그레이션 원장, 역할·환경변수·암호화키를 별도 보존해야 한다.
2. 이번 복원은 PostgreSQL 18.4, 운영은 18.6이다. 운영 전환 전에 같은 패치 버전 및 실제 제한 역할을 포함해 검증해야 한다.
3. 유지보수 시간에 쓰기·워커 중지, 최종 백업, 제한 런타임 역할과 앱을 함께 전환. 전환 후 새 쓰기가 발생하면 단순 과거 백업 복원으로 데이터가 사라지므로 별도 재처리 계획 필요.
4. 스키마·앱·환경변수·Slack 토큰 암호화키를 함께 복구하는 운영 절차 확정. 현재 SaaS 운영 출시 차단은 유지한다.


## 실제 운영 승인 데이터 복원 결과 (2026-09-30 후속)

- SSH: 기존 개인키를 여는 단계에서 암호 오류 확인. 새 임시 키와 Git OpenSSH 10.5로 `pg_dump --version` 성공. 기존 키는 변경하지 않았다. 기존 Windows SSH 9.5 실패의 모든 원인을 단정하지 않는다.
- 원본: Railway PostgreSQL 18.6, pg_dump에 `default_transaction_read_only=on` 적용. 구조와 데이터는 별도 호출이므로 운영 DDL 동결을 보장하는 최종 전환 스냅샷은 아니다.
- 범위: audit_events, cohorts, holiday_overrides, holiday_sync, holiday_years, member_claims, members, opening_exceptions, policy_versions, reservation_members, reservations, rooms, settings, slack_installations, slack_workspace_classes, venues의 데이터만 명시적 허용 목록으로 추출. booking 구조는 의존성 복원을 위해 함께 보관했다.
- 제외: class_install_requests, command_receipts, reports, sanctions, slack_web_links, tasks는 구조만 포함한다. public 스키마·서버 역할·환경변수는 포함하지 않는다. 운영 DB에는 identity 스키마가 없어 로그인 해시 백업은 발생하지 않았다.
- 암호화: AES-256-GCM, 평문 디스크 저장 없음. 77,547바이트 원본 SQL의 복호화 SHA-256 일치 및 변조 거부 통과. 키는 Git 제외 별도 폴더에 보관한다.
- 복원: 별도 루프백 PostgreSQL 18.4, 117행, FK 34개 재검증. 제외 테이블에 데이터가 없는 것도 확인했다.
- 이관: 016_login_accounts → 001_candidate → 002_web_runtime → 003_slack_workers를 복제본 트랜잭션에서 실행. 고객 테이블 21개에서 데이터 보존, ROLLBACK 후 테이블 지문 일치.
- 안전 정리: 등록한 두 임시 SSH 키 모두 해제, 등록 키 0개 확인. 새 임시 개인키와 테스트 복사본 삭제. 복원 서버 종료, Slack·메일·워커 실행 없음. 운영 DB 변경·코드 배포 없음.

백업: `.local/backups/railway-1790740045509/approved-data.sql.enc`

검증 보고서: `.local/backups/railway-1790740045509/report.json`

최종 복원 DB: `production_restore_1790740228793` (종료된 별도 로컬 서버)

전체 DB 내보내기는 자동 승인 검토에서 승인 범위를 초과할 수 있다는 이유로 거절되어 실행하지 않았다. 위 허용 목록으로 좁힌 백업만 수행했다. 이 백업만으로 제외 데이터를 포함한 전체 서비스를 복구할 수 있다고 주장하지 않는다.


## 2026-09-30 최종 후속 검증

이 절은 앞선 중간 점검의 미완료 목록을 갱신한다. 공휴일 공유 작업(004), 내보내기·ID 기반 소유권 이전·삭제 대기/취소(005), 비특권 역할 설치·검사와 별도 워커를 구현했다. 실제 API·DB의 고객 A/B 격리와 수명주기 통합 검사를 통과했다. 영구 삭제는 합성 DB에서만 검증했고 운영 실행은 차단한다.

승인된 최신 암호화 백업 railway-1790744899443은 24개 테이블(업무 274행, 마이그레이션 15행, import 1행)과 공휴일 시퀀스를 포함한다. 네트워크 없는 PostgreSQL 18.6 컨테이너에서 016 및 후보 001–005 적용·롤백 후 24개 테이블 지문이 일치했다. 설치 토큰의 현재 키 복호화도 확인했다. 임시 컨테이너와 SSH 키 등록은 정리했다. 운영 원본은 변경하지 않았다.

운영 전환에는 별도 삭제 원장 보존·백업 30일 만료 검증, 운영용 제한 역할 적용, 두 실제 Slack 구성원 검증이 남아 있다. 현재 두 번째 Slack 계정이 없어 모의 검증으로 대체 완료하지 않는다. 상세 기준은 [수명주기 검증](SaaS-수명주기-검증.md)과 [운영 전환 절차](SaaS-운영전환-복구절차.md)를 따른다.
