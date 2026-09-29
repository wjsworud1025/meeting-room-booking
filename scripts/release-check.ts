import {writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {pool,type DB} from '../src/server/db';
import {localDate} from '../src/shared/time';
const checks:{name:string;status:'PASS'|'BLOCKED'|'REVIEW';detail:string}[]=[];
function check(name:string,ok:boolean,detail:string){checks.push({name,status:ok?'PASS':'BLOCKED',detail});}
check('운영 환경',process.env.APP_ENV==='production','APP_ENV=production 필요. 로컬 인증은 운영에서 금지.');
let https=false;try{https=new URL(process.env.APP_BASE_URL??'').protocol==='https:';}catch{}
check('HTTPS 주소',https,'APP_BASE_URL에 운영 HTTPS 주소 필요.');
check('세션 키',!!process.env.SESSION_SECRET&&process.env.SESSION_SECRET.length>=32&&!/CHANGE_ME|GENERATE|EXAMPLE/i.test(process.env.SESSION_SECRET),'32자 이상 비밀키; 실제 값은 출력하지 않음. 난수 생성·안전한 보관은 별도 확인.');
check('외부 인증 설정',['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'].every(k=>!!process.env[k]?.trim()),'설정 존재 여부만 검사. 실제 이메일 인증·관리자 온보딩 검증은 별도.');
check('메일 설정',['SMTP_HOST','SMTP_FROM'].every(k=>!!process.env[k]?.trim()),'SMTP 설정 존재 여부만 검사. 실제 수신 성공은 별도.');
check('자동 작업 설정',process.env.RUN_JOBS==='true','RUN_JOBS=true 및 상시 실행되는 Node 프로세스 필요.');
checks.push({name:'공휴일 자동 갱신',status:process.env.HOLIDAY_API_KEY?.trim()?'REVIEW':'BLOCKED',detail:'공식 API 인증 및 올해·다음 해 실응답 검증 필요. 수동 등록은 별도 기능.'});
let db:DB|undefined;try{
 if(!process.env.DATABASE_URL?.trim())throw Error('DB_NOT_CONFIGURED');
 db=await pool().connect();
 await db.query('BEGIN READ ONLY');
 const role=(await db.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];check('DB 최소 권한',!role.rolsuper&&!role.rolcreatedb&&!role.rolcreaterole,'애플리케이션 계정의 superuser·createdb·createrole 없어야 함. 테이블별 권한은 별도 확인.');
 const migrations=(await db.query('SELECT name FROM public.booking_migrations')).rows.map(x=>x.name);check('DB 마이그레이션',readdirSync('db/migrations').filter(x=>x.endsWith('.sql')).every(x=>migrations.includes(x)),'저장소 마이그레이션 적용 여부.');
 const beat=(await db.query('SELECT job_heartbeat FROM settings WHERE id=1')).rows[0]?.job_heartbeat;check('자동 작업 생존',!!beat&&Date.now()-new Date(beat).getTime()<120000,'최근 120초 안의 작업 heartbeat 필요.');
 check('현재 정책',(await db.query('SELECT 1 FROM policy_versions WHERE effective_on<=$1',[localDate()])).rowCount!>0,'오늘 적용 가능한 정책 존재.');
 check('활성 관리자',(await db.query("SELECT 1 FROM members WHERE role='ADMIN' AND status='ACTIVE'")).rowCount!>0,'활성 관리자 존재; 샘플 계정 제거·실사용자 인수는 별도 확인.');
 const tasks=(await db.query("SELECT count(*)::int n FROM tasks WHERE status='FAILED' OR (status='RUNNING' AND lease_until<clock_timestamp()) OR (status='PENDING' AND next_run_at<clock_timestamp()-interval '5 minutes')")).rows[0].n;check('실패·지연 작업',tasks===0,`확인 필요한 작업 ${tasks}건. 수신자·본문은 출력하지 않음.`);
 await db.query('COMMIT');
}catch{if(db)await db.query('ROLLBACK').catch(()=>{});checks.push({name:'DB 점검',status:'BLOCKED',detail:'DB 조회 실패. 연결·스키마·조회 권한을 확인하세요. 연결 문자열은 출력하지 않음.'});}finally{db?.release();await pool().end();}
checks.push({name:'외부 인수·복구·보존',status:'REVIEW',detail:'실제 OTP·메일·초대, 백업 복원, 90일 보존·파기, 지속 부하와 장애 복구는 자동 설정 검사로 증명되지 않음.'});
const result={checkedAt:new Date().toISOString(),verdict:checks.some(x=>x.status==='BLOCKED')?'NO-GO':'MANUAL-ACCEPTANCE-REQUIRED',checks};mkdirSync('test-results',{recursive:true});writeFileSync('test-results/release-readiness.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(result.verdict==='NO-GO')process.exitCode=1;
