# 운영 유지보수

현재 Railway Postgres 서비스 전용 도구. 앱 배포·부팅 시 자동 실행하지 않는다.

## 상시 키
- Railway 개인 계정 등록명: `meeting-room-maintenance`
- 지문: `SHA256:/8bbkJPlR3sDmzo4vLHTInM8JIrVMDfAqH5WXZ4ZbpI`
- 개인키: Git 제외 `.local/maintenance/railway-maintenance.dpapi`. 현재 Windows 사용자 DPAPI 암호화, 디렉터리 ACL 제한.
- 명령 실행 중에만 사용자 SSH 폴더에 복호화하며 finally에서 제거한다. 프로세스 강제 종료 시 `booking-maintenance-session-*` 잔여 파일을 확인한다.
- 이 암호화본은 다른 Windows 계정·기기로 단순 복사해서 쓸 수 없다. 기기 변경 시 본인 Railway 계정에서 새 키 등록 후 이전 키를 해제한다.
- SSH 자체는 Railway 계정이 접근 가능한 서비스에 대한 넓은 서버 권한이다. 아래 역할은 일상 작업의 실수 방지 경로이며 SSH 소유자의 우회까지 차단하지 않는다. 키를 고객 ADMIN에게 공유하지 않는다.

## 명령 (프로젝트 루트)
```powershell
pwsh -NoProfile -File scripts/maintenance/run.ps1 -Action List
pwsh -NoProfile -File scripts/maintenance/run.ps1 -Action Inspect -LoginId hyundai_1st
pwsh -NoProfile -File scripts/maintenance/run.ps1 -Action Members -LoginId hyundai_1st
pwsh -NoProfile -File scripts/maintenance/run.ps1 -Action Rooms -LoginId hyundai_1st
pwsh -NoProfile -File scripts/maintenance/run.ps1 -Action Reservations -LoginId hyundai_1st
pwsh -NoProfile -File scripts/maintenance/run.ps1 -Action History -LoginId hyundai_1st
pwsh -NoProfile -File scripts/maintenance/run.ps1 -Action Verify
```
조회 역할은 원본 테이블·계정 해시·토큰·메시지 payload에 접근하지 않는다. 명시한 뷰의 업무 필드만 조회하며 상세 조회는 고객 ID와 200건 제한을 사용한다. 신규 고객은 같은 DB에 생성되면 자동 조회 대상이 된다. 새 테이블·새 필드는 자동 공개하지 않는다.

## 변경 작업
`ClearHistory -LoginId <ID> -Reason <승인된 작업 사유>`는 명시적으로 승인받은 고객의 기존 변경 이력만 영구 삭제한다. `maintenance.operations`에 대상·건수·사유·시각·DB 접속 주체를 별도로 기록한다. 조회 역할과 웹/작업 프로세스에는 실행 권한이 없다. 삭제 전 Inspect, 삭제 후 Inspect 및 Verify를 실행한다.

유지보수 변경 역할은 현재 이력 삭제 함수만 실행할 수 있다. 다른 복구·수정은 별도 검토된 명령으로 추가한다. Install은 1회용이며 기존 역할/스키마가 있으면 실패하고 트랜잭션이 취소된다.

유지보수 기록은 동일 DB의 별도 스키마에 있다. 고객 변경 이력 삭제와 분리되지만 DB 소유자는 수정할 수 있으므로 외부 불변 감사 저장소를 뜻하지 않는다. 전체 재해 복구 시 maintenance 스키마와 권한도 백업 범위에 포함해야 한다.

## 2026-09-30 적용
상시 키 등록 및 2개 NOLOGIN/NOSUPERUSER/NOBYPASSRLS 역할 구성. 사용자 승인으로 hyundai_1st 변경 이력 42건 삭제, 직후 0건 확인. 구성원 104·회의실 5·예약 6건 유지. 21개 테넌트 테이블 강제 RLS 유지.
