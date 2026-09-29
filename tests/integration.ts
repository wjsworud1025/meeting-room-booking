import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {pool,transaction} from '../src/server/db';
import {execute} from '../src/server/commands';
import {reservation,redact,member} from '../src/server/store';
import {holidayInfo,syncHolidayTask,scheduleHolidaySync} from '../src/server/holidays';
import {tick} from '../src/server/jobs';
import {boundaries,syncClaims} from '../src/server/booking';
import {adminData,snapshot} from '../src/server/queries';
import {slackSession} from '../src/slack/identity';
import {commandInput,home,bookingView} from '../src/slack/views';
import {memberConflicts} from '../src/server/queries';
import {defaultRules} from '../src/server/policy';
import {at,localDate,addDays} from '../src/shared/time';
import type {Session} from '../src/shared/types';
assert.equal(process.env.APP_ENV,'local','Integration tests only run locally');
const dbName='booking_test_'+process.pid;
const base=new URL(process.env.DATABASE_URL!);base.pathname='/postgres';const control=new pg.Client({connectionString:base.toString()});await control.connect();await control.query(`CREATE DATABASE "${dbName}"`);
const testURL=new URL(process.env.DATABASE_URL!);testURL.pathname='/'+dbName;process.env.DATABASE_URL=testURL.toString();
const db=await pool().connect();await db.query(readFileSync('db/migrations/001_initial.sql','utf8'));await db.query(readFileSync('db/migrations/002_holidays.sql','utf8'));db.release();
const now=at('2026-10-06','17:00');let ids:string[]=[],rooms:string[]=[],admins:string[]=[],cohort='';
const session=(id:string,verifiedAt=now.getTime()):Session=>({memberId:id,accessVersion:1,verifiedAt,expiresAt:now.getTime()+86400000,sessionId:randomUUID()});
async function reset(count=8){
 await pool().query('TRUNCATE holiday_years,holiday_overrides,holiday_sync,settings,cohorts,members,rooms,policy_versions,opening_exceptions,reservations,reservation_members,member_claims,reports,sanctions,audit_events,command_receipts,tasks CASCADE');
 await pool().query('INSERT INTO settings(id) VALUES(1)');await pool().query('INSERT INTO holiday_sync(id) VALUES(1)');cohort=randomUUID();await pool().query("INSERT INTO cohorts(id,name,starts_on,ends_on) VALUES($1,'시험','2026-01-01','2026-12-31')",[cohort]);ids=Array.from({length:count},()=>randomUUID());admins=[randomUUID(),randomUUID()];rooms=Array.from({length:5},()=>randomUUID());
 for(let i=0;i<ids.length;i++)await pool().query("INSERT INTO members(id,auth_user_id,cohort_id,email,display_name,role,status) VALUES($1,$2,$3,$4,$5,'STUDENT','ACTIVE')",[ids[i],randomUUID(),cohort,`test${i}@example.com`,`학생${i}`]);
 for(let i=0;i<admins.length;i++)await pool().query("INSERT INTO members(id,auth_user_id,email,display_name,role,status,invite_accepted_at) VALUES($1,$2,$3,$4,'ADMIN','ACTIVE',$5)",[admins[i],randomUUID(),`admin${i}@example.com`,`관리자${i}`,now]);
 for(let i=0;i<rooms.length;i++)await pool().query('INSERT INTO rooms(id,name,display_order) VALUES($1,$2,$3)',[rooms[i],`회의실 ${i+1}`,i]);
 await pool().query("INSERT INTO policy_versions(effective_on,rules_json) VALUES('2026-01-01',$1)",[JSON.stringify({...defaultRules,rooms:Object.fromEntries(rooms.map((id,i)=>[id,{capacity:i===4?8:4,minimum:i===4?4:2}]))})]);
}
const create=(owner=0,guests=[1],room=0,start='18:00',end='19:00',key=randomUUID(),time=now)=>execute(session(ids[owner]),'booking.create',{roomId:rooms[room],startsAt:at('2026-10-06',start).toISOString(),endsAt:at('2026-10-06',end).toISOString(),inviteeIds:guests.map(i=>ids[i])},key,time);
async function get(id:string){const c=await pool().connect();try{return await reservation(c,id);}finally{c.release();}}
function success(r:Awaited<ReturnType<typeof execute>>){assert.equal(r.status,200,JSON.stringify(r.error));return (r.data as {id:string}).id;}
async function accept(id:string,index:number,time=now){const r=await get(id),p=r.participants.find(p=>p.member_id===ids[index])!;return execute(session(ids[index]),'booking.respond',{id:p.id,invitationGeneration:p.invitation_generation,accept:true},randomUUID(),time);}
let passed=0;async function test(name:string,fn:()=>Promise<void>,count=8){await reset(count);await fn();passed++;console.log('PASS',name);}
try{
 await test('Slack / 계정 연결·예약 생성·중복 제출·충돌·휴관·비활성 차단',async()=>{
  const oldTeam=process.env.SLACK_WORKSPACE_ID;process.env.SLACK_WORKSPACE_ID='T_LOCAL_TEST';
  try{
   await pool().query("UPDATE members SET slack_workspace_id='T_LOCAL_TEST',slack_user_id='U_TEST_STUDENT' WHERE id=$1",[ids[0]]);
   await assert.rejects(slackSession('OTHER','U_TEST_STUDENT'));
   await assert.rejects(slackSession('T_LOCAL_TEST','U_UNLINKED'));
   const linked=await slackSession('T_LOCAL_TEST','U_TEST_STUDENT');
   let day=addDays(localDate(),1);while([0,6].includes(new Date(day+'T00:00:00Z').getUTCDay()))day=addDays(day,1);
   const draft={date:day,time:'18:00',duration:60 as const,roomId:rooms[0],inviteeIds:[ids[1]]},input=commandInput(draft),key=randomUUID();
   const id=success(await execute(linked,'booking.create',input,key));
   assert.equal(success(await execute(linked,'booking.create',input,key)),id);
   assert.equal((await pool().query('SELECT count(*)::int n FROM reservations')).rows[0].n,1);
   assert.equal((await get(id)).accepted_count,2);
   const snap=await snapshot(linked,day);assert.ok(JSON.stringify(home(snap,'http://localhost:3002')).includes('new_booking'));assert.ok(JSON.stringify(bookingView(snap,draft)).includes('booking_submit'));
   const conflict=await execute(linked,'booking.create',{...input,roomId:rooms[1]},randomUUID());assert.equal(conflict.error?.code,'MEMBER_TIME_CONFLICT');assert.ok(conflict.error?.message.includes('학생0'));
   assert.equal((await memberConflicts(linked,[ids[0],ids[1]],input.startsAt,input.endsAt)).length,2);
   assert.equal((await memberConflicts(linked,[ids[0]],input.endsAt,at(day,'19:30').toISOString())).length,0);
   await pool().query("INSERT INTO opening_exceptions(id,local_date,room_id,kind,local_start,local_end,reason) VALUES($1,$2,$3,'CLOSED','20:00','21:00','Slack test')",[randomUUID(),day,rooms[1]]);
   const blocked=await execute(linked,'booking.create',commandInput({...draft,roomId:rooms[1],time:'20:00'}),randomUUID());assert.equal(blocked.error?.code,'OUTSIDE_OPENING_HOURS');
   await pool().query("UPDATE members SET status='INACTIVE',access_version=access_version+1 WHERE id=$1",[ids[0]]);
   await assert.rejects(slackSession('T_LOCAL_TEST','U_TEST_STUDENT'));await assert.rejects(execute(linked,'booking.create',input,randomUUID()));
  }finally{if(oldTeam===undefined)delete process.env.SLACK_WORKSPACE_ID;else process.env.SLACK_WORKSPACE_ID=oldTeam;}
 });
 await test('일괄 참여자 ID / 대문자 UUID 정규화와 중복 초대 차단',async()=>{
  const input={roomId:rooms[0],startsAt:at('2026-10-06','18:00').toISOString(),endsAt:at('2026-10-06','19:00').toISOString()};
  assert.equal((await execute(session(ids[0]),'booking.create',{...input,inviteeIds:[ids[1],ids[1].toUpperCase()]},randomUUID(),now)).error?.code,'CAPACITY_REACHED');
  const id=success(await execute(session(ids[0]),'booking.create',{...input,inviteeIds:[ids[1].toUpperCase()]},randomUUID(),now));
  assert.deepEqual((await get(id)).first_confirmed_member_ids,[ids[0],ids[1]].sort());
  assert.equal((await execute(session(ids[0]),'booking.invite',{id,expectedVersion:1,inviteeIds:[ids[1].toUpperCase()]},randomUUID(),now)).error?.code,'INVALID_INPUT');
 });
 await test('서로 다른 방 동시 신청 / 공통 참여자는 한 예약만 점유',async()=>{
  const results=await Promise.all([create(0,[2],0),create(1,[2],1)]);
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.error?.code==='MEMBER_TIME_CONFLICT').length,1);
  assert.equal((await pool().query('SELECT * FROM member_claims WHERE member_id=$1',[ids[2]])).rowCount,1);
 });
 await test('8인 직접 확정 / 최초 명단·점유·알림 및 재전송 보존',async()=>{
  const key=randomUUID(),id=success(await create(0,[1,2,3,4,5,6,7],4,'18:00','19:00',key)),r=await get(id);
  assert.equal(r.status,'CONFIRMED');assert.equal(r.version,1);assert.equal(r.first_confirmed_at,now.toISOString());assert.deepEqual(r.first_confirmed_member_ids,[...ids].sort());
  assert.equal(r.accepted_count,8);assert.equal((await pool().query('SELECT * FROM member_claims')).rowCount,8);
  assert.equal(success(await create(0,[1,2,3,4,5,6,7],4,'18:00','19:00',key)),id);
  assert.equal((await pool().query("SELECT * FROM tasks WHERE payload->>'event'='예약 확정'")).rowCount,8);
  assert.equal((await pool().query("SELECT * FROM audit_events WHERE action='booking.create'")).rowCount,1);
 });
 await test('일괄 자격 검사 / 누락 계정·관리자·제재 학생은 전체 거절',async()=>{
  const input={roomId:rooms[0],startsAt:at('2026-10-06','18:00').toISOString(),endsAt:at('2026-10-06','19:00').toISOString()};
  for(const [id,code] of [[randomUUID(),'NOT_FOUND'],[admins[0],'FORBIDDEN']])assert.equal((await execute(session(ids[0]),'booking.create',{...input,inviteeIds:[ids[1],id]},randomUUID(),now)).error?.code,code);
  await pool().query("INSERT INTO sanctions(cohort_id,member_id,kind,starts_at,ends_at,reason,created_by) VALUES($1,$2,'RESTRICTED',$3,$4,'검증',$5)",[cohort,ids[2],now,at('2026-10-06','20:00'),admins[0]]);
  assert.equal((await create(0,[1,2])).error?.code,'MEMBER_RESTRICTED');assert.equal((await pool().query('SELECT * FROM reservations')).rowCount,0);assert.equal((await pool().query('SELECT * FROM reservation_members')).rowCount,0);
 });
 await test('예약 변경 공정성 / 실패 롤백과 정확한 60분 허용',async()=>{
  success(await create());const id=success(await create(0,[1],0,'20:00','21:00')),r=await get(id);
  const change=(start:string)=>execute(session(ids[0]),'booking.change',{id,expectedVersion:r.version,roomId:rooms[1],startsAt:at('2026-10-06',start).toISOString(),endsAt:at('2026-10-06','21:00').toISOString()},randomUUID(),now);
  assert.equal((await change('19:30')).error?.code,'GROUP_GAP_REQUIRED');assert.equal((await get(id)).room_id,rooms[0]);assert.equal((await get(id)).version,r.version);
  success(await change('20:00'));assert.deepEqual((await get(id)).first_confirmed_member_ids,r.first_confirmed_member_ids);
 });
 await test('설정된 1440분 공정성 간격 / 다음 날 경계',async()=>{
  await pool().query("UPDATE policy_versions SET rules_json=jsonb_set(rules_json,'{gapMinutes}','1440')");success(await create());
  const next=(start:string)=>execute(session(ids[0]),'booking.create',{roomId:rooms[1],startsAt:at('2026-10-07',start).toISOString(),endsAt:at('2026-10-07','20:00').toISOString(),inviteeIds:[ids[1]]},randomUUID(),now);
  assert.equal((await next('18:30')).error?.code,'GROUP_GAP_REQUIRED');success(await next('19:00'));
 });
 await test('기한 처리 / 시작 명단은 한 번 고정하고 종료 시 점유 해제',async()=>{
  const id=success(await create());await transaction(db=>boundaries(db,at('2026-10-06','18:00')));const started=await get(id);
  await transaction(db=>boundaries(db,at('2026-10-06','18:30')));assert.equal((await get(id)).version,started.version);assert.deepEqual((await get(id)).start_member_ids,started.start_member_ids);
  await transaction(db=>boundaries(db,at('2026-10-06','19:00')));assert.equal((await get(id)).status,'ENDED');assert.equal((await pool().query('SELECT * FROM member_claims')).rowCount,0);
 });
 await test('기존 HOLDING / 대기 초대 수락 및 기한 만료 호환',async()=>{
  async function legacy(owner:number,guest:number,room:number){const id=success(await create(owner,[guest],room));await pool().query("UPDATE reservations SET status='HOLDING',first_confirmed_at=NULL,first_confirmed_member_ids=NULL WHERE id=$1",[id]);await pool().query("UPDATE reservation_members SET status='INVITED',responded_at=NULL WHERE reservation_id=$1 AND member_id=$2",[id,ids[guest]]);await transaction(db=>syncClaims(db,id));return id;}
  const a=await legacy(0,1,0),b=await legacy(2,3,1);success(await accept(a,1,at('2026-10-06','17:05')));assert.equal((await get(a)).status,'CONFIRMED');
  await transaction(db=>boundaries(db,at('2026-10-06','17:10')));assert.equal((await get(b)).status,'CANCELLED');assert.equal((await pool().query('SELECT * FROM member_claims WHERE reservation_id=$1',[b])).rowCount,0);
 });
 await test('화면별 관리자 조회 / 필요한 자료와 권한 검사 유지',async()=>{
  const settings=await adminData(session(admins[0]),'settings');
  assert.equal(settings.policies.length,1);assert.ok(settings.earliestPolicyDate);
  for(const key of ['accounts','students','reports','audits','cohorts','tasks','sanctions'] as const)assert.deepEqual(settings[key],[]);
  assert.equal((await adminData(session(admins[0]),'accounts')).accounts.length,2);
  const students=await adminData(session(admins[0]),'students');assert.equal(students.students.length,8);assert.equal(students.cohorts.length,1);
  await assert.rejects(()=>adminData(session(ids[0]),'settings'),(e:unknown)=>(e as {code:string}).code==='FORBIDDEN');
 });
 await test('예약 조회 / 한국 날짜 경계와 다른 날의 내 예약 보존',async()=>{
  const own=success(await create()),foreign=success(await create(2,[3],1));
  await pool().query('UPDATE reservations SET starts_at=$2,ends_at=$3 WHERE id=$1',[foreign,at('2026-10-07','00:00'),at('2026-10-07','01:00')]);
  const day=await snapshot(session(ids[0]),'2026-10-07');
  assert.deepEqual(day.reservations.map(r=>r.id),[foreign]);assert.deepEqual(day.mine.map(r=>r.id),[own]);
  assert.equal(day.reservations[0].participants.length,0);
  assert.deepEqual((await snapshot(session(ids[1]),'2026-10-07')).invitations.map(r=>r.id),[own]);
  assert.deepEqual((await snapshot(session(admins[0]),'2026-10-06')).reservations.map(r=>r.id),[own]);
 });
 await test('자동 참여 / 신청 즉시 확정과 전체 인원 점유',async()=>{const id=success(await create());assert.equal((await get(id)).status,'CONFIRMED');assert.equal((await get(id)).invited_count,0);success(await accept(id,1));assert.equal((await get(id)).status,'CONFIRMED');assert.equal((await pool().query('SELECT * FROM member_claims')).rowCount,2);});
 await test('같은 방 동시 신청 100건 / 유효 확보 정확히 1건',async()=>{const results=await Promise.all(Array.from({length:100},(_,i)=>create(i,[100])));assert.equal(results.filter(r=>r.status===200).length,1);assert.equal((await pool().query('SELECT * FROM reservations')).rowCount,1);},101);
 await test('중복 요청과 같은 키 다른 입력',async()=>{const key=randomUUID(),a=await create(0,[1],0,'18:00','19:00',key),b=await create(0,[1],0,'18:00','19:00',key);assert.deepEqual(a,b);await assert.rejects(()=>create(0,[2],0,'18:00','19:00',key),/같은 요청 키/);});
 await test('보충 마감 정각에는 자동 초대도 거절',async()=>{const id=success(await create(0,[1],0,'18:00','19:00',randomUUID(),at('2026-10-06','17:55')));let r=await get(id);success(await execute(session(ids[1]),'booking.leave',{id,expectedVersion:r.version},randomUUID(),at('2026-10-06','17:56')));r=await get(id);const response=await execute(session(ids[0]),'booking.invite',{id,expectedVersion:r.version,inviteeIds:[ids[2]]},randomUUID(),at('2026-10-06','18:00'));assert.notEqual(response.status,200);assert.equal((await get(id)).status,'CANCELLED');assert.equal((await pool().query('SELECT * FROM member_claims')).rowCount,0);});
 await test('AT-05 / 같은 초대 동시 수락은 중복 인원을 만들지 않음',async()=>{const id=success(await create());const replies=await Promise.all([accept(id,1),accept(id,1)]);replies.forEach(success);assert.equal((await get(id)).accepted_count,2);});
 await test('자동 참여 / 동일 모임 간격 위반은 신청 시 전체 롤백',async()=>{success(await create());assert.equal((await create(0,[1],1,'19:00','20:00')).error?.code,'GROUP_GAP_REQUIRED');assert.equal((await pool().query('SELECT * FROM reservations')).rowCount,1);});
 await test('같은 모임 공정성 앞뒤 순서 검사',async()=>{const later=success(await create(0,[1],0,'19:00','20:00'));assert.equal((await create(0,[1],1,'18:00','19:00')).error?.code,'GROUP_GAP_REQUIRED');assert.equal((await get(later)).status,'CONFIRMED');});
 await test('AT-12 / 재보충 시 첫 기한 보존',async()=>{const id=success(await create());success(await accept(id,1));let r=await get(id);success(await execute(session(ids[1]),'booking.leave',{id,expectedVersion:r.version},randomUUID(),at('2026-10-06','17:02')));const deadline=(await get(id)).replenish_deadline;r=await get(id);success(await execute(session(ids[0]),'booking.invite',{id,expectedVersion:r.version,inviteeIds:[ids[2]]},randomUUID(),at('2026-10-06','17:04')));success(await accept(id,2,at('2026-10-06','17:05')));r=await get(id);success(await execute(session(ids[2]),'booking.leave',{id,expectedVersion:r.version},randomUUID(),at('2026-10-06','17:06')));assert.equal((await get(id)).replenish_deadline,deadline);await transaction((c)=>boundaries(c,at('2026-10-06','17:12')));assert.equal((await get(id)).status,'CANCELLED');});
 await test('초대한 구성원의 동시간대 중복은 신청 시 차단',async()=>{success(await create(0,[2],0));assert.equal((await create(1,[2],1)).error?.code,'MEMBER_TIME_CONFLICT');assert.equal((await pool().query('SELECT * FROM reservations')).rowCount,1);});
 await test('AT-15 / 이동 대상 선점 실패 시 원래 예약 보존',async()=>{const a=success(await create(0,[1],0));success(await create(2,[3],1));const r=await get(a);const result=await execute(session(ids[0]),'booking.change',{id:a,expectedVersion:r.version,roomId:rooms[1],startsAt:r.starts_at,endsAt:r.ends_at},randomUUID(),now);assert.equal(result.error?.code,'ROOM_UNAVAILABLE');assert.equal((await get(a)).room_id,rooms[0]);});
 await test('AT-16 / 큰 방 최소 인원 부족 이동 거절',async()=>{const id=success(await create());success(await accept(id,1));const r=await get(id);const result=await execute(session(ids[0]),'booking.change',{id,expectedVersion:r.version,roomId:rooms[4],startsAt:r.starts_at,endsAt:r.ends_at},randomUUID(),now);assert.equal(result.error?.code,'MINIMUM_NOT_MET');});
 await test('AT-17 / 책임 이전은 상대 수락 시에만 변경',async()=>{const id=success(await create());success(await accept(id,1));let r=await get(id);success(await execute(session(ids[0]),'booking.transfer',{id,targetId:ids[1],expectedVersion:r.version},randomUUID(),now));r=await get(id);assert.equal(r.organizer_id,ids[0]);success(await execute(session(ids[1]),'booking.transferRespond',{id,requestId:r.transfer_request_id,accept:true},randomUUID(),now));assert.equal((await get(id)).organizer_id,ids[1]);assert.equal((await get(id)).creator_id,ids[0]);});
 await test('AT-18 / 시작 후 학생 취소 거절·시작 명단 고정',async()=>{const id=success(await create());success(await accept(id,1));const r=await get(id);const result=await execute(session(ids[0]),'booking.cancel',{id,expectedVersion:r.version},randomUUID(),at('2026-10-06','18:00'));assert.notEqual(result.status,200);assert.equal((await get(id)).start_member_ids?.length,2);});
 await test('참여 취소 후 재초대 자동 참여와 이전 버튼 거절',async()=>{const id=success(await create()),old=(await get(id)).participants.find(p=>p.member_id===ids[1])!;let r=await get(id);success(await execute(session(ids[1]),'booking.leave',{id,expectedVersion:r.version},randomUUID(),now));r=await get(id);success(await execute(session(ids[0]),'booking.invite',{id,expectedVersion:r.version,inviteeIds:[ids[1]]},randomUUID(),now));assert.equal((await get(id)).status,'CONFIRMED');const result=await execute(session(ids[1]),'booking.respond',{id:old.id,invitationGeneration:1,accept:true},randomUUID(),now);assert.equal(result.error?.code,'STALE_INVITATION');});
 await test('AT-20 / 외부 학생은 전체 참여 명단을 받지 않음',async()=>{const id=success(await create(0,[1,2]));success(await accept(id,1));const c=await pool().connect();try{const r=await get(id);assert.equal(redact(r,await member(c,ids[3])).participants.length,0);assert.equal(redact(r,await member(c,ids[2])).participants.length,3);assert.equal(redact(r,await member(c,ids[0])).first_confirmed_member_ids,null);}finally{c.release();}});
 await test('AT-26 / 학생 등록에서 role 입력과 관리자 이메일 거절',async()=>{const result=await execute(session(admins[0]),'admin.student.register',{cohortId:cohort,reason:'학생 등록',students:[{email:'admin0@example.com',name:'관리자',className:''}]},randomUUID(),now);assert.equal(result.error?.code,'ADMIN_EMAIL_CONFLICT');const injection=await execute(session(admins[0]),'admin.student.register',{cohortId:cohort,reason:'등록',students:[{email:'x@example.com',name:'가상',role:'ADMIN'}]},randomUUID(),now);assert.equal(injection.error?.code,'INVALID_INPUT');});
 await test('AT-29 / 관리자 초대 재발송 시 기존 ID 무효',async()=>{const id=success(await execute(session(admins[0]),'admin.account.invite',{email:'new@example.com',name:'신규',reason:'업무 추가'},randomUUID(),now));let m=(await pool().query('SELECT * FROM members WHERE id=$1',[id])).rows[0];const old=m.admin_invite_id;success(await execute(session(admins[0]),'admin.account.resend',{id,expectedVersion:m.account_version,reason:'재발송'},randomUUID(),now));await pool().query('UPDATE members SET auth_user_id=$2 WHERE id=$1',[id,randomUUID()]);const response=await execute(session(id),'onboarding.accept',{invitationId:old},randomUUID(),now);assert.equal(response.error?.code,'ADMIN_INVITATION_INVALID');});
 await test('AT-30 / 본인 회수 차단',async()=>{const r=await execute(session(admins[0]),'admin.account.deactivate',{id:admins[0],expectedVersion:1,reason:'퇴임'},randomUUID(),now);assert.equal(r.error?.code,'SELF_DEACTIVATION_FORBIDDEN');});
 await test('AT-31·32 / 동시 상호 회수·회수 후 세션 거절',async()=>{const results=await Promise.allSettled([execute(session(admins[0]),'admin.account.deactivate',{id:admins[1],expectedVersion:1,reason:'인수인계'},randomUUID(),now),execute(session(admins[1]),'admin.account.deactivate',{id:admins[0],expectedVersion:1,reason:'인수인계'},randomUUID(),now)]);assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.status===200).length,1);assert.equal((await pool().query("SELECT * FROM members WHERE role='ADMIN' AND status='ACTIVE'")).rowCount,1);});
 await test('AT-33 / 학생 일괄 비활성화에 관리자 혼입 시 전체 거절',async()=>{const r=await execute(session(admins[0]),'admin.student.deactivate',{ids:[ids[0],admins[1]],reason:'기수 종료'},randomUUID(),now);assert.equal(r.error?.code,'FORBIDDEN');assert.equal((await pool().query('SELECT status FROM members WHERE id=$1',[admins[1]])).rows[0].status,'ACTIVE');});
 await test('AT-34 / 최근 재인증 없는 관리자 변경 거절',async()=>{const r=await execute(session(admins[0],now.getTime()-600001),'admin.account.invite',{name:'신규',email:'x@example.com',reason:'업무 추가'},randomUUID(),now);assert.equal(r.error?.code,'RECENT_AUTH_REQUIRED');});

 await test('추가 초대 중 한 명이 중복이면 전원 추가 취소',async()=>{const a=success(await create(0,[1],0));success(await create(2,[3],1));const r=await get(a);const result=await execute(session(ids[0]),'booking.invite',{id:a,expectedVersion:r.version,inviteeIds:[ids[4],ids[3]]},randomUUID(),now);assert.equal(result.error?.code,'MEMBER_TIME_CONFLICT');assert.equal((await get(a)).accepted_count,2);assert.equal((await get(a)).version,r.version);});
 await test('자동 추가 참여에도 동일 모임 간격 검사',async()=>{success(await create(0,[1,2],0));const id=success(await create(3,[4],1,'19:00','20:00')),r=await get(id);const result=await execute(session(ids[3]),'booking.invite',{id,expectedVersion:r.version,inviteeIds:[ids[0],ids[1]]},randomUUID(),now);assert.equal(result.error?.code,'GROUP_GAP_REQUIRED');assert.equal((await get(id)).accepted_count,2);});
 await test('초대 대상 비활성 계정은 자동 참여 불가',async()=>{await pool().query("UPDATE members SET status='INACTIVE' WHERE id=$1",[ids[1]]);assert.notEqual((await create()).status,200);assert.equal((await pool().query('SELECT * FROM reservations')).rowCount,0);});

 await test('휴일 수동 등록·수정 보호와 학생 권한 차단',async()=>{
  const input={date:'2026-10-06',name:'시험 임시공휴일',sourceUrl:'https://www.mpm.go.kr/',reason:'시험 공고 반영',expectedVersion:0};
  assert.equal((await execute(session(ids[0]),'admin.holiday.save',input,randomUUID(),now)).error?.code,'FORBIDDEN');
  const saved=await execute(session(admins[0]),'admin.holiday.save',input,randomUUID(),now);assert.equal(saved.status,200);
  assert.equal((await holidayInfo(2026)).days['2026-10-06'],'시험 임시공휴일');
  assert.equal((await execute(session(admins[1]),'admin.holiday.save',input,randomUUID(),now)).error?.code,'STALE_VERSION');
 });
 await test('공식 자료 갱신이 관리자 수정과 예약을 덮어쓰지 않음',async()=>{
  const id=success(await create());
  assert.equal((await execute(session(admins[0]),'admin.holiday.save',{date:'2026-10-06',name:'관리자 임시공휴일',sourceUrl:'https://www.mpm.go.kr/',reason:'공식 발표 반영',expectedVersion:0},randomUUID(),now)).status,200);
  const taskId=randomUUID(),token=randomUUID();await pool().query("INSERT INTO tasks(id,kind,dedupe_key,payload,status,lease_token,lease_until) VALUES($1::uuid,'HOLIDAY_SYNC',$1::text,'{}','RUNNING',$2,clock_timestamp()+interval '60 seconds')",[taskId,token]);
  const old=process.env.HOLIDAY_API_KEY;process.env.HOLIDAY_API_KEY='test-only';
  try{await syncHolidayTask({id:taskId,lease_token:token,payload:{year:'2026'}},async(input)=>{const year=new URL(String(input)).searchParams.get('solYear');return Response.json({response:{header:{resultCode:'00'},body:{totalCount:10,items:{item:Array.from({length:10},(_,i)=>({locdate:year+'10'+String(i+1).padStart(2,'0'),dateName:'API 시험 휴일',isHoliday:'Y'}))}}}});});}finally{if(old===undefined)delete process.env.HOLIDAY_API_KEY;else process.env.HOLIDAY_API_KEY=old;}
  assert.equal((await holidayInfo(2026)).days['2026-10-06'],'관리자 임시공휴일');assert.equal((await holidayInfo(2027)).days['2027-10-06'],'API 시험 휴일');assert.equal((await get(id)).status,'CONFIRMED');assert.equal((await pool().query('SELECT * FROM opening_exceptions')).rowCount,0);
  const version=(await pool().query('SELECT version FROM holiday_overrides')).rows[0].version;
  assert.equal((await execute(session(admins[0]),'admin.holiday.reset',{date:'2026-10-06',reason:'공식 자료 복원',expectedVersion:version},randomUUID(),now)).status,200);assert.equal((await holidayInfo(2026)).days['2026-10-06'],'API 시험 휴일');
 });
 await test('한 연도 조회 실패 시 두 연도 모두 기존 자료와 성공 시각 보존',async()=>{
  await pool().query("INSERT INTO holiday_years(year,days,synced_at) VALUES(2026,$1,$3),(2027,$2,$3)",[JSON.stringify({'2026-10-06':'기존 휴일'}),JSON.stringify({'2027-10-06':'기존 휴일'}),now]);
  await pool().query('UPDATE holiday_sync SET last_success_at=$1',[now]);
  const taskId=randomUUID(),token=randomUUID();await pool().query("INSERT INTO tasks(id,kind,dedupe_key,payload,status,lease_token,lease_until) VALUES($1::uuid,'HOLIDAY_SYNC',$1::text,'{}','RUNNING',$2,clock_timestamp()+interval '60 seconds')",[taskId,token]);const old=process.env.HOLIDAY_API_KEY;process.env.HOLIDAY_API_KEY='test-only';
  try{await assert.rejects(()=>syncHolidayTask({id:taskId,lease_token:token,payload:{year:'2026'}},async(input)=>{if(new URL(String(input)).searchParams.get('solYear')==='2027')return new Response('bad',{status:503});return Response.json({response:{header:{resultCode:'00'},body:{totalCount:10,items:{item:Array.from({length:10},(_,i)=>({locdate:'202610'+String(i+1).padStart(2,'0'),dateName:'새 휴일',isHoliday:'Y'}))}}}});}),/HOLIDAY_HTTP_ERROR/);}finally{if(old===undefined)delete process.env.HOLIDAY_API_KEY;else process.env.HOLIDAY_API_KEY=old;}
  assert.equal((await holidayInfo(2026)).days['2026-10-06'],'기존 휴일');assert.equal((await pool().query('SELECT last_success_at FROM holiday_sync')).rows[0].last_success_at,now.toISOString());
 });
 await test('휴일 표시 제외 및 원본 복원·삭제 후 오래된 편집 거절',async()=>{
  const v={date:'2026-10-05',name:null,sourceUrl:'https://www.mpm.go.kr/',reason:'시험 제외',expectedVersion:0};assert.equal((await execute(session(admins[0]),'admin.holiday.save',v,randomUUID(),now)).status,200);assert.equal((await holidayInfo(2026)).days['2026-10-05'],undefined);
  const version=(await pool().query('SELECT version FROM holiday_overrides')).rows[0].version;
  assert.equal((await execute(session(admins[0]),'admin.holiday.reset',{date:v.date,reason:'원복',expectedVersion:version},randomUUID(),now)).status,200);assert.ok((await holidayInfo(2026)).days[v.date]);
  assert.equal((await execute(session(admins[0]),'admin.holiday.save',v,randomUUID(),now)).status,200);assert.equal((await execute(session(admins[0]),'admin.holiday.save',{...v,expectedVersion:version},randomUUID(),now)).error?.code,'STALE_VERSION');
 });
 await test('인증키 없이 수동 동기화하면 명확한 설정 오류',async()=>{const old=process.env.HOLIDAY_API_KEY;delete process.env.HOLIDAY_API_KEY;try{assert.equal((await execute(session(admins[0]),'admin.holiday.sync',{},randomUUID(),now)).error?.code,'HOLIDAY_KEY_MISSING');assert.equal((await pool().query("SELECT * FROM tasks WHERE kind='HOLIDAY_SYNC'")).rowCount,0);}finally{if(old!==undefined)process.env.HOLIDAY_API_KEY=old;}});

 await test('수동·자동 동기화 중복 방지와 6시간 주기',async()=>{
  const key=process.env.HOLIDAY_API_KEY,worker=process.env.RUN_JOBS;process.env.HOLIDAY_API_KEY='test-only';process.env.RUN_JOBS='true';
  try{
   assert.equal((await execute(session(admins[0]),'admin.holiday.sync',{},randomUUID(),now)).status,200);
   assert.equal((await execute(session(admins[1]),'admin.holiday.sync',{},randomUUID(),now)).status,200);assert.equal((await pool().query("SELECT * FROM tasks WHERE kind='HOLIDAY_SYNC'")).rowCount,1);
   await pool().query("UPDATE tasks SET status='DONE' WHERE kind='HOLIDAY_SYNC'");
   const early=await transaction((db)=>scheduleHolidaySync(db,new Date(now.getTime()+5*3600000)));assert.equal(early.queued,false);
   const due=await transaction((db)=>scheduleHolidaySync(db,new Date(now.getTime()+6*3600000)));assert.equal(due.queued,true);assert.equal((await pool().query("SELECT * FROM tasks WHERE kind='HOLIDAY_SYNC'")).rowCount,2);
  }finally{if(key===undefined)delete process.env.HOLIDAY_API_KEY;else process.env.HOLIDAY_API_KEY=key;if(worker===undefined)delete process.env.RUN_JOBS;else process.env.RUN_JOBS=worker;}
 });
 await test('관리자 검토 완료는 해당 변경 알림만 해제',async()=>{
  await pool().query('UPDATE holiday_sync SET changed_dates=$1',[JSON.stringify(['2026-10-06','2026-10-07'])]);
  assert.equal((await execute(session(admins[0]),'admin.holiday.acknowledge',{date:'2026-10-06'},randomUUID(),now)).status,200);
  assert.deepEqual((await pool().query('SELECT changed_dates FROM holiday_sync')).rows[0].changed_dates,['2026-10-07']);assert.equal((await pool().query('SELECT * FROM opening_exceptions')).rowCount,0);
 });

 await test('릴리즈 / 과거 달력 조회에도 예정된 내 예약·자동 참여 목록 유지',async()=>{
  const id=success(await create());const past=await snapshot(session(ids[0]),'2026-01-02');assert.ok(past.mine.some(r=>r.id===id));
  const guest=await snapshot(session(ids[1]),'2026-01-02');assert.ok(guest.invitations.some(r=>r.id===id));
 });
 await test('릴리즈 / 휴관 미리보기 변경 감지와 이동 실패 전체 롤백',async()=>{
  const a=success(await create()),b=success(await create(2,[3],1));const r=await get(a);
  const input={date:'2026-10-06',roomId:rooms[0],start:'18:00',end:'19:00',reason:'시설 점검',mode:'move',targetRoomId:rooms[1],affected:[{id:a,version:r.version}]};
  assert.equal((await execute(session(admins[0]),'admin.closure',{...input,affected:[]},randomUUID(),now)).error?.code,'STALE_VERSION');
  assert.equal((await execute(session(admins[0]),'admin.closure',input,randomUUID(),now)).error?.code,'ROOM_UNAVAILABLE');
  assert.equal((await get(a)).room_id,rooms[0]);assert.equal((await get(b)).status,'CONFIRMED');assert.equal((await pool().query('SELECT * FROM opening_exceptions')).rowCount,0);
  success(await execute(session(admins[0]),'admin.closure',{...input,mode:'cancel'},randomUUID(),now));assert.equal((await get(a)).status,'CANCELLED');assert.equal((await pool().query('SELECT * FROM member_claims WHERE reservation_id=$1',[a])).rowCount,0);
 });
 await test('릴리즈 / 학생 비활성화의 책임 예약 취소·일반 참여 보충·세션 차단',async()=>{
  const own=success(await create()),other=success(await create(2,[0],1,'20:00','21:00'));
  success(await execute(session(admins[0]),'admin.student.deactivate',{ids:[ids[0]],reason:'등록 종료'},randomUUID(),now));
  assert.equal((await get(own)).status,'CANCELLED');assert.equal((await get(other)).status,'REPLENISHING');assert.equal((await get(other)).accepted_count,1);
  await assert.rejects(()=>execute(session(ids[0]),'booking.create',{},randomUUID(),now),(e:unknown)=>(e as {code:string}).code==='ACCESS_REVOKED');
 });
 await test('릴리즈 / 기수 종료는 관리자 보존·학생 접근과 미래 예약 종료',async()=>{
  const id=success(await create());success(await execute(session(admins[0]),'admin.cohort.end',{id:cohort,reason:'기수 종료'},randomUUID(),now));
  assert.equal((await get(id)).status,'CANCELLED');assert.equal((await pool().query("SELECT * FROM members WHERE role='STUDENT' AND status<>'INACTIVE'")).rowCount,0);assert.equal((await pool().query("SELECT * FROM members WHERE role='ADMIN' AND status='ACTIVE'")).rowCount,2);
 });
 await test('릴리즈 / 정책 적용일과 미래 정책 경계·기존 예약 보존',async()=>{
  const id=success(await create());const rules={...defaultRules,windowDays:10,rooms:Object.fromEntries(rooms.map((id,i)=>[id,{capacity:i===4?8:4,minimum:i===4?4:2}]))};
  assert.equal((await execute(session(admins[0]),'admin.policy',{effectiveOn:'2026-10-09',rules,reason:'정책 변경'},randomUUID(),now)).error?.code,'INVALID_POLICY_DATE');
  success(await execute(session(admins[0]),'admin.policy',{effectiveOn:'2026-10-12',rules,reason:'정책 변경'},randomUUID(),now));
  success(await execute(session(ids[0]),'booking.create',{roomId:rooms[0],startsAt:at('2026-10-12','18:00').toISOString(),endsAt:at('2026-10-12','19:00').toISOString(),inviteeIds:[ids[1]]},randomUUID(),now));assert.equal((await get(id)).status,'CONFIRMED');
 });
 await test('릴리즈 / 알림 4회 실패에도 예약 보존·재시도와 최종 실패 기록',async()=>{
  const id=success(await create());await pool().query("UPDATE tasks SET status='DONE'");const task=randomUUID();await pool().query("INSERT INTO tasks(id,kind,dedupe_key,payload,recipient_id,channel) VALUES($1::uuid,'NOTIFY',$1::text,'{\"event\":\"검증\"}',$2,'EMAIL')",[task,ids[0]]);
  const oldEnv=process.env.APP_ENV,oldHost=process.env.SMTP_HOST,oldKey=process.env.HOLIDAY_API_KEY;process.env.APP_ENV='production';delete process.env.SMTP_HOST;delete process.env.HOLIDAY_API_KEY;
  try{for(let attempt=1;attempt<=4;attempt++){await tick();const row=(await pool().query('SELECT * FROM tasks WHERE id=$1',[task])).rows[0];assert.equal(row.attempts,attempt);assert.equal(row.status,attempt===4?'FAILED':'PENDING');assert.equal(row.last_error_code,'SMTP_NOT_CONFIGURED');assert.equal((await get(id)).status,'CONFIRMED');await pool().query('UPDATE tasks SET next_run_at=clock_timestamp() WHERE id=$1',[task]);}}finally{for(const [key,value] of Object.entries({APP_ENV:oldEnv,SMTP_HOST:oldHost,HOLIDAY_API_KEY:oldKey}))if(value===undefined)delete process.env[key];else process.env[key]=value;}
 });
 console.log(`Actual PostgreSQL integration checks passed: ${passed}`);
}finally{await pool().end();assert.match(dbName,/^booking_test_\d+$/);await control.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);await control.end();}
