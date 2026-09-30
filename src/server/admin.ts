import {saasEnabled} from './db';
import {installRequestCommand} from './class-install';
import {requireVenue} from './venues';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {DB} from './db';
import type {Member,Session} from '../shared/types';
import {addDays,at,localDate} from '../shared/time';
import {admin,member,policy,queue,reservation,reservations} from './store';
import {requireThat} from './errors';
import {cancelReservation,bookingCommand,settle,syncClaims} from './booking';
import {holidayCommand} from './holidays';
import {assertWorkspace} from '../slack/workspaces';
const uuid=z.string().uuid(),reason=z.string().trim().min(2).max(500),email=z.string().trim().toLowerCase().email().max(254),name=z.string().trim().min(1).max(80);
const target=z.object({id:uuid,expectedVersion:z.number().int().positive(),reason}).strict();
export async function issueAdmin(db:DB,args:{email:string;name:string;reason:string;issuer:'ADMIN'|'BOOTSTRAP'|'RECOVERY';by:string|null},now:Date){
 requireThat(args.issuer!=='ADMIN','SINGLE_ADMIN_ONLY','단일 관리자 운영으로 추가 초대를 지원하지 않습니다.',403);
 const found=(await db.query<Member>('SELECT * FROM members WHERE email=$1',[args.email])).rows[0];requireThat(!found||found.role==='ADMIN','ADMIN_EMAIL_CONFLICT','학생 계정과 다른 이메일을 사용해 주세요.');requireThat(found?.status!=='ACTIVE','ADMIN_EMAIL_CONFLICT','이미 활성 관리자입니다.');

 const id=found?.id??randomUUID(),inviteId=randomUUID();
 await db.query(`INSERT INTO members(id,email,display_name,role,status,admin_invite_id,issuer_type,invited_by,invite_expires_at) VALUES($1,$2,$3,'ADMIN','REGISTERED',$4,$5,$6,$7) ON CONFLICT(${saasEnabled()?'tenant_id,':''}email) DO UPDATE SET admin_invite_id=$4,issuer_type=$5,invited_by=$6,invite_expires_at=$7,invite_accepted_at=NULL,invite_revoked_at=NULL,account_version=members.account_version+1,updated_at=$8`,[id,args.email,args.name,inviteId,args.issuer,args.by,new Date(now.getTime()+86400000),now]);
 await queue(db,'MEMBER_PROVISION',`provision:${id}:${inviteId}`,{memberId:id,role:'ADMIN',invitationId:inviteId});await queue(db,'NOTIFY',`admin-invite:${inviteId}`,{event:'관리자 초대',invitationId:inviteId},id,'EMAIL');return {id,invitationId:inviteId};
}
async function adminNotice(db:DB,id:string,event:string,now:Date){const others=await db.query("SELECT id FROM members WHERE role='ADMIN' AND status='ACTIVE' UNION SELECT id FROM members WHERE id=$1",[id]);await queue(db,'NOTIFY',`admin-home:${id}:${now.toISOString()}`,{event},id,'SLACK_HOME');for(const r of others.rows)await queue(db,'NOTIFY',`admin:${id}:${event}:${now.toISOString()}:${r.id}`,{event},r.id,'AUTO');}
export async function detachStudent(db:DB,id:string,now:Date){
 const future=await reservations(db,"r.starts_at>$1 AND r.status IN ('HOLDING','CONFIRMED','REPLENISHING') AND EXISTS(SELECT 1 FROM reservation_members p WHERE p.reservation_id=r.id AND p.member_id=$2 AND p.status IN ('INVITED','ACCEPTED'))",[now,id]);
 for(const r of future){if(r.organizer_id===id){await cancelReservation(db,r,now,'책임자 계정 비활성화 또는 이용 제한',null);continue;}
  await db.query("UPDATE reservation_members SET status=CASE WHEN status='INVITED' THEN 'REVOKED' ELSE 'LEFT' END,responded_at=$3 WHERE reservation_id=$1 AND member_id=$2",[r.id,id,now]);
  await db.query('UPDATE reservations SET version=version+1,transfer_request_id=CASE WHEN transfer_to_id=$2 OR transfer_from_id=$2 THEN NULL ELSE transfer_request_id END,transfer_to_id=CASE WHEN transfer_to_id=$2 OR transfer_from_id=$2 THEN NULL ELSE transfer_to_id END WHERE id=$1',[r.id,id]);await settle(db,r.id,now,false);
 }
}
export async function adminCommand(db:DB,me:Member,session:Session,action:string,input:unknown,now:Date){
 admin(me,session,now,action.startsWith('account.'));
 requireThat(!action.startsWith('account.'),'SINGLE_ADMIN_ONLY','단일 관리자 운영으로 관리자 추가·초대·권한 변경을 지원하지 않습니다.',403);
 if(action.startsWith('classInstall.'))return installRequestCommand(db,action.slice(13),input,now);

 if(action==='venue.remove'){
  const v=z.object({id:uuid,reason}).strict().parse(input);
  requireThat((await db.query('SELECT id FROM venues WHERE id=$1 FOR UPDATE',[v.id])).rowCount,'NOT_FOUND','수업장을 찾을 수 없습니다.',404);
  const linked=(await db.query('SELECT EXISTS(SELECT 1 FROM rooms WHERE venue_id=$1) rooms,EXISTS(SELECT 1 FROM cohorts WHERE venue_id=$1) classes,EXISTS(SELECT 1 FROM class_install_requests WHERE venue_id=$1) requests',[v.id])).rows[0];
  requireThat(!linked.rooms&&!linked.classes&&!linked.requests,'CONFLICT','연결된 회의실·클래스 또는 설치 요청이 있습니다. 수업장을 변경하거나 설치 요청을 삭제한 후 다시 시도해 주세요.');
  await db.query('DELETE FROM venues WHERE id=$1',[v.id]);return {id:v.id};
 }
 if(action==='venue.add'||action==='venue.rename'){
  const v=z.object({id:uuid.optional(),name,reason}).strict().parse(input);
  requireThat(!(await db.query('SELECT 1 FROM venues WHERE name=$1 AND ($2::uuid IS NULL OR id<>$2)',[v.name,v.id??null])).rowCount,'CONFLICT','같은 이름의 수업장이 있습니다.');
  if(action==='venue.add'){const id=randomUUID();await db.query('INSERT INTO venues(id,name) VALUES($1,$2)',[id,v.name]);return {id};}
  requireThat(v.id,'INVALID_INPUT','수업장을 선택해 주세요.',422);await requireVenue(db,v.id);await db.query('UPDATE venues SET name=$2 WHERE id=$1',[v.id,v.name]);return {id:v.id};
 }
 if(action==='workspace.assign'){
  const v=z.object({teamId:z.string().min(1),venueId:uuid,reason}).strict().parse(input);await requireVenue(db,v.venueId);
  const c=(await db.query('SELECT c.id,c.venue_id FROM cohorts c JOIN slack_workspace_classes w ON w.cohort_id=c.id WHERE w.team_id=$1 FOR UPDATE OF c',[v.teamId])).rows[0];requireThat(c,'NOT_FOUND','등록된 클래스를 찾을 수 없습니다.',404);
  if(c.venue_id!==v.venueId){
   requireThat(!(await db.query("SELECT 1 FROM reservations r WHERE r.ends_at>$2 AND r.status IN ('HOLDING','CONFIRMED','REPLENISHING') AND (r.cohort_id=$1 OR EXISTS(SELECT 1 FROM reservation_members p JOIN members m ON m.id=p.member_id WHERE p.reservation_id=r.id AND m.cohort_id=$1 AND p.status IN ('ACCEPTED','INVITED'))) LIMIT 1",[c.id,now])).rowCount,'CLASS_HAS_RESERVATIONS','진행 중이거나 예정된 예약 참여가 있어 수업장을 변경할 수 없습니다. 예약 종료 후 변경해 주세요.');
   await db.query('UPDATE cohorts SET venue_id=$2 WHERE id=$1',[c.id,v.venueId]);
  }return {id:c.id};
 }
 if(action==='room.assign'){
  const v=z.object({id:uuid,venueId:uuid,reason}).strict().parse(input);await requireVenue(db,v.venueId);
  const room=(await db.query('SELECT venue_id FROM rooms WHERE id=$1 AND active FOR UPDATE',[v.id])).rows[0];requireThat(room,'NOT_FOUND','회의실을 찾을 수 없습니다.',404);
  if(room.venue_id!==v.venueId){requireThat(!(await db.query("SELECT 1 FROM reservations WHERE room_id=$1 AND ends_at>$2 AND status IN ('HOLDING','CONFIRMED','REPLENISHING') LIMIT 1",[v.id,now])).rowCount,'ROOM_HAS_RESERVATIONS','진행 중이거나 예정된 예약이 있어 수업장을 변경할 수 없습니다. 예약 종료 후 변경해 주세요.');await db.query('UPDATE rooms SET venue_id=$2 WHERE id=$1',[v.id,v.venueId]);}return {id:v.id};
 }
 if(action.startsWith('holiday.'))return holidayCommand(db,me,action.slice(8),input,now);
 if(action==='workspace.register'){
  const v=z.object({teamId:z.string().min(1).max(64),name,venueId:uuid,reason}).strict().parse(input);assertWorkspace(v.teamId);await requireVenue(db,v.venueId);
  requireThat((await db.query('SELECT 1 FROM slack_installations WHERE team_id=$1 AND revoked_at IS NULL FOR SHARE',[v.teamId])).rowCount,'WORKSPACE_DENIED','설치된 워크스페이스만 등록할 수 있습니다.',403);
  requireThat(!(await db.query('SELECT 1 FROM slack_workspace_classes WHERE team_id=$1',[v.teamId])).rowCount,'CONFLICT','이미 등록된 워크스페이스입니다. 종료된 기수는 재활성화하지 않습니다.');
  const id=randomUUID();await db.query("INSERT INTO cohorts(id,name,starts_on,ends_on,venue_id) VALUES($1,$2,$3,'9999-12-31',$4)",[id,v.name,localDate(now),v.venueId]);
  await db.query('INSERT INTO slack_workspace_classes(team_id,class_name,cohort_id,auto_enroll) VALUES($1,$2,$3,true)',[v.teamId,v.name,id]);return {id,teamId:v.teamId};
 }
 if(action==='workspace.end'){
  const v=z.object({teamId:z.string().min(1).max(64),cohortId:uuid,reason}).strict().parse(input);
  const row=(await db.query('SELECT w.cohort_id,c.inactive_at FROM slack_workspace_classes w JOIN cohorts c ON c.id=w.cohort_id WHERE w.team_id=$1 FOR UPDATE OF w,c',[v.teamId])).rows[0];
  requireThat(row&&row.cohort_id===v.cohortId&&!row.inactive_at,'STALE_VERSION','기수 상태가 변경되었습니다. 새로고침해 주세요.');
  requireThat((await db.query('SELECT team_id FROM slack_workspace_classes WHERE cohort_id=$1',[v.cohortId])).rowCount===1,'CONFLICT','여러 워크스페이스가 공유한 기수입니다. 운영 담당자에게 문의해 주세요.');
  return adminCommand(db,me,session,'cohort.end',{id:v.cohortId,reason:v.reason},now);
 }
 if(action==='student.register'){
  requireThat(!saasEnabled(),'SLACK_MEMBERSHIP_REQUIRED','구성원은 연결된 Slack 워크스페이스에서 자동 등록됩니다.',409);
  const v=z.object({students:z.array(z.object({name,email,className:z.string().trim().max(80).default('')}).strict()).min(1).max(200),cohortId:uuid,reason}).strict().parse(input);
  requireThat((await db.query('SELECT 1 FROM cohorts WHERE id=$1 AND inactive_at IS NULL',[v.cohortId])).rowCount,'INVALID_INPUT','활성 기수를 선택해 주세요.',422);requireThat(new Set(v.students.map(s=>s.email)).size===v.students.length,'INVALID_INPUT','중복 이메일이 있습니다.',422);const ids:string[]=[];
  for(const s of v.students){const old=(await db.query<Member>('SELECT * FROM members WHERE email=$1',[s.email])).rows[0];requireThat(!old||old.role==='STUDENT','ADMIN_EMAIL_CONFLICT','관리자 이메일은 학생 명단에 등록할 수 없습니다.');requireThat(!old||old.status==='INACTIVE','EMAIL_CONFLICT',`${s.name}: 이미 등록된 계정입니다.`);
   const id=old?.id??randomUUID();await db.query(`INSERT INTO members(id,email,display_name,class_name,cohort_id,role,status) VALUES($1,$2,$3,$4,$5,'STUDENT','REGISTERED') ON CONFLICT(${saasEnabled()?'tenant_id,':''}email) DO UPDATE SET display_name=$3,class_name=$4,cohort_id=$5,status='REGISTERED',access_version=members.access_version+1,account_version=members.account_version+1,updated_at=$6,inactive_at=NULL,slack_user_id=NULL,slack_workspace_id=NULL`,[id,s.email,s.name,s.className,v.cohortId,now]);await queue(db,'MEMBER_PROVISION',`student-provision:${id}:${now.toISOString()}`,{memberId:id,role:'STUDENT'});ids.push(id);
  }return {ids};
 }
 if(action==='student.deactivate'){
  const v=z.object({ids:z.array(uuid).min(1).max(200),reason}).strict().parse(input);for(const id of v.ids)requireThat((await member(db,id)).role==='STUDENT','FORBIDDEN','학생 명단에 관리자 계정을 포함할 수 없습니다.',403);
  for(const id of v.ids){await detachStudent(db,id,now);await db.query("UPDATE members SET status='INACTIVE',inactive_at=$2,access_version=access_version+1,account_version=account_version+1,updated_at=$2 WHERE id=$1",[id,now]);}return {ids:v.ids};
 }
 if(action==='cohort.end'){
  const target=z.object({id:uuid}).passthrough().parse(input);await db.query('UPDATE slack_workspace_classes SET auto_enroll=false WHERE cohort_id=$1',[target.id]);
  const v=z.object({id:uuid,reason}).strict().parse(input);const students=await db.query("SELECT id FROM members WHERE cohort_id=$1 AND role='STUDENT'",[v.id]);for(const s of students.rows){await detachStudent(db,s.id,now);await db.query("UPDATE members SET status='INACTIVE',inactive_at=$2,access_version=access_version+1,updated_at=$2 WHERE id=$1 AND role='STUDENT'",[s.id,now]);}await db.query('UPDATE cohorts SET inactive_at=$2 WHERE id=$1',[v.id,now]);return {id:v.id};
 }
 if(action==='closure'){
  const v=z.object({date:z.iso.date(),roomId:uuid.nullable(),start:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),end:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),reason,mode:z.enum(['cancel','move']),targetRoomId:uuid.optional(),affected:z.array(z.object({id:uuid,version:z.number().int()}))}).strict().parse(input);
  const start=at(v.date,v.start).toISOString(),end=at(v.date,v.end).toISOString();requireThat(start<end&&end>now.toISOString(),'INVALID_INPUT','미래의 올바른 휴관 시간을 선택해 주세요.',422);
  const affected=await reservations(db,"($1::uuid IS NULL OR r.room_id=$1) AND r.starts_at<$3 AND r.ends_at>$2 AND r.status IN ('HOLDING','CONFIRMED','REPLENISHING')",[v.roomId,start,end]);requireThat(affected.length===v.affected.length&&affected.every(r=>v.affected.some(x=>x.id===r.id&&x.version===r.version)),'STALE_VERSION','영향받는 예약이 변경되었습니다. 미리보기를 다시 확인해 주세요.');
  for(const r of affected){if(v.mode==='cancel')await cancelReservation(db,r,now,v.reason,null);else{requireThat(v.targetRoomId&&v.targetRoomId!==v.roomId&&v.roomId,'INVALID_INPUT','휴관 대상이 아닌 회의실을 선택해 주세요.',422);await bookingCommand(db,me,'change',{id:r.id,expectedVersion:r.version,roomId:v.targetRoomId,startsAt:r.starts_at,endsAt:r.ends_at,reason:v.reason},now,randomUUID());}}
  const id=randomUUID();await db.query("INSERT INTO opening_exceptions(id,local_date,room_id,kind,local_start,local_end,reason) VALUES($1,$2,$3,'CLOSED',$4,$5,$6)",[id,v.date,v.roomId,v.start,v.end,v.reason]);return {id};
 }
 if(action==='exception.open'){
  const v=z.object({date:z.iso.date().optional(),dates:z.array(z.iso.date()).min(1).max(60).optional(),roomId:uuid.nullable(),start:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),end:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),reason:z.string().trim().max(500).optional().default('')}).strict().refine(v=>!!v.date!==!!v.dates,{message:'날짜를 선택해 주세요.'}).parse(input);
  requireThat(v.start<v.end,'INVALID_INPUT','시간을 확인해 주세요.',422);
  if(v.roomId)requireThat((await db.query('SELECT 1 FROM rooms WHERE id=$1 AND active',[v.roomId])).rowCount,'ROOM_UNAVAILABLE','운영 중인 회의실을 선택해 주세요.');
  const dates=[...new Set(v.dates??[v.date!])].sort(),ids:string[]=[];
  for(const date of dates){
   const existing=(await db.query("SELECT id FROM opening_exceptions WHERE local_date=$1 AND room_id IS NOT DISTINCT FROM $2::uuid AND kind='OPEN' AND local_start=$3 AND local_end=$4",[date,v.roomId,v.start,v.end])).rows[0];
   if(existing)continue;
   const id=randomUUID();await db.query("INSERT INTO opening_exceptions(id,local_date,room_id,kind,local_start,local_end,reason) VALUES($1,$2,$3,'OPEN',$4,$5,$6)",[id,date,v.roomId,v.start,v.end,v.reason]);ids.push(id);
  }
  return {id:ids[0]??null,ids,dates,created:ids.length,skipped:dates.length-ids.length};
 }
 if(action==='exception.remove'){const v=z.object({id:uuid,reason}).strict().parse(input);await db.query('DELETE FROM opening_exceptions WHERE id=$1',[v.id]);return {id:v.id};}
 if(action==='room.add'){
  const v=z.object({name,venueId:uuid,capacity:z.number().int().min(2).max(100),minimum:z.number().int().min(2).max(100),reason}).strict().parse(input);
  await requireVenue(db,v.venueId);requireThat(v.minimum<=v.capacity,'INVALID_INPUT','최소 인원은 정원 이하로 입력해 주세요.',422);
  requireThat(!(await db.query('SELECT id FROM rooms WHERE active AND name=$1 AND venue_id=$2',[v.name,v.venueId])).rowCount,'CONFLICT','같은 이름의 회의실이 있습니다.');
  const id=randomUUID();await db.query('INSERT INTO rooms(id,name,venue_id,display_order) SELECT $1,$2,$3,COALESCE(MAX(display_order),0)+1 FROM rooms',[id,v.name,v.venueId]);
  // Add only the new room specification; existing room policies and booking snapshots stay intact.
  await db.query("UPDATE policy_versions SET rules_json=jsonb_set(rules_json,'{rooms}',(rules_json->'rooms') || $1::jsonb)",[JSON.stringify({[id]:{capacity:v.capacity,minimum:v.minimum}})]);
  return {id};
 }
 if(action==='room.rename'){
  const v=z.object({id:uuid,name,reason}).strict().parse(input);
  requireThat(!(await db.query('SELECT id FROM rooms WHERE active AND name=$1 AND id<>$2 AND venue_id=(SELECT venue_id FROM rooms WHERE id=$2)',[v.name,v.id])).rowCount,'CONFLICT','같은 이름의 회의실이 있습니다.');
  const changed=await db.query('UPDATE rooms SET name=$2 WHERE id=$1 AND active',[v.id,v.name]);requireThat(changed.rowCount,'ROOM_UNAVAILABLE','운영 중인 회의실이 아닙니다.');return {id:v.id};
 }
 if(action==='room.remove'){
  const v=z.object({id:uuid,reason}).strict().parse(input);
  const count=(await db.query("SELECT count(*)::int AS count FROM reservations WHERE room_id=$1 AND ends_at>$2 AND status IN ('HOLDING','CONFIRMED','REPLENISHING')",[v.id,now])).rows[0].count;
  requireThat(!count,'ROOM_HAS_RESERVATIONS',`진행 중이거나 예정된 예약이 ${count}건 있습니다. 예약을 이동하거나 취소한 후 제거해 주세요.`);
  const changed=await db.query('UPDATE rooms SET active=false WHERE id=$1 AND active',[v.id]);requireThat(changed.rowCount,'ROOM_UNAVAILABLE','이미 제거된 회의실입니다.');return {id:v.id};
 }
 if(action==='policy'){
  const roomRule=z.object({capacity:z.number().int().min(2).max(100),minimum:z.number().int().min(2).max(100)}).refine(x=>x.minimum<=x.capacity);
  const rules=z.object({windowDays:z.number().int().min(1).max(30),slotMinutes:z.number().int().min(5).max(60),maxMinutes:z.number().int().min(30).max(720),holdMinutes:z.number().int().min(1).max(60),refillMinutes:z.number().int().min(1).max(60),cooldownMinutes:z.number().int().min(1).max(60),gapMinutes:z.number().int().min(1).max(1440),threshold:z.number().min(0).max(99),open:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),close:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),weekdays:z.array(z.number().int().min(0).max(6)).min(1),rooms:z.record(uuid,roomRule)}).strict();
  const v=z.object({effectiveOn:z.iso.date(),rules,reason:z.string().trim().max(500).optional().default('')}).strict().parse(input),current=await policy(db,localDate(now));requireThat(v.effectiveOn>=addDays(localDate(now),current.rules_json.windowDays+1),'INVALID_POLICY_DATE','현재 열린 예약 기간 이후 날짜를 선택해 주세요.');requireThat(v.rules.open<v.rules.close&&v.rules.maxMinutes%v.rules.slotMinutes===0,'INVALID_INPUT','시간 정책의 단위와 범위를 확인해 주세요.',422);const roomIds=(await db.query('SELECT id FROM rooms WHERE active')).rows.map(x=>x.id);requireThat(roomIds.every(id=>v.rules.rooms[id]),'INVALID_INPUT','모든 회의실의 정원 정책이 필요합니다.',422);requireThat(Object.keys(v.rules.rooms).every(id=>roomIds.includes(id)),'INVALID_INPUT','현재 운영 공간의 회의실만 지정할 수 있습니다.',422);const id=randomUUID();await db.query('INSERT INTO policy_versions(id,effective_on,rules_json,created_by) VALUES($1,$2,$3,$4)',[id,v.effectiveOn,JSON.stringify(v.rules),me.id]);return {id};
 }
 if(action==='report.resolve'){const v=z.object({id:uuid,resolution:reason}).strict().parse(input);const result=await db.query("UPDATE reports SET status='RESOLVED',resolution=$2,resolved_by=$3 WHERE id=$1 AND status='OPEN' RETURNING reporter_id",[v.id,v.resolution,me.id]);requireThat(result.rowCount,'STALE_VERSION','이미 처리된 신고입니다.');await queue(db,'NOTIFY',`report:${v.id}`,{event:'신고 처리 완료'},result.rows[0].reporter_id,'AUTO');return {id:v.id};}
 if(action==='sanction'){
  const v=z.object({memberId:uuid,kind:z.enum(['WARNING','RESTRICTED']),endsAt:z.iso.datetime({offset:true}),reason}).strict().parse(input),m=await member(db,v.memberId);requireThat(m.role==='STUDENT','FORBIDDEN','학생만 이용 제한 대상으로 선택할 수 있습니다.',403);requireThat(new Date(v.endsAt)>now,'INVALID_INPUT','제한 종료시각을 확인해 주세요.',422);const id=randomUUID();await db.query('INSERT INTO sanctions(id,cohort_id,member_id,kind,starts_at,ends_at,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,m.cohort_id,m.id,v.kind,now,v.endsAt,v.reason,me.id]);if(v.kind==='RESTRICTED')await detachStudent(db,m.id,now);await queue(db,'NOTIFY',`sanction:${id}`,{event:'이용 제한·안내',reason:v.reason},m.id,'EMAIL');return {id};
 }
 if(action==='sanction.revoke'){const v=z.object({id:uuid,reason}).strict().parse(input);await db.query('UPDATE sanctions SET revoked_at=$2 WHERE id=$1',[v.id,now]);return {id:v.id};}
 if(action==='reservation.removeMember'){
  const v=z.object({id:uuid,memberId:uuid,expectedVersion:z.number().int(),reason}).strict().parse(input),r=await reservation(db,v.id);requireThat(r.version===v.expectedVersion,'STALE_VERSION','예약이 변경되었습니다.');requireThat(r.organizer_id!==v.memberId,'INVALID_INPUT','책임자 제외는 책임 이전 또는 예약 취소로 처리해 주세요.');requireThat(!['CANCELLED','ENDED'].includes(r.status),'INVALID_STATE','종료된 예약입니다.');await db.query("UPDATE reservation_members SET status='LEFT',responded_at=$3 WHERE reservation_id=$1 AND member_id=$2 AND status='ACCEPTED'",[r.id,v.memberId,now]);await db.query('UPDATE reservations SET version=version+1 WHERE id=$1',[r.id]);if(new Date(r.starts_at)>now)await settle(db,r.id,now,false);else await syncClaims(db,r.id);return {id:r.id};
 }
 requireThat(false,'INVALID_INPUT','지원하지 않는 관리 작업입니다.',422);
}
export async function acceptAdmin(db:DB,m:Member,inviteId:string,now:Date){
 requireThat(m.role==='ADMIN'&&m.admin_invite_id===inviteId&&!m.invite_accepted_at&&!m.invite_revoked_at&&m.invite_expires_at&&new Date(m.invite_expires_at)>now&&m.auth_user_id,'ADMIN_INVITATION_INVALID','만료·취소되었거나 준비 중인 초대입니다. 관리자에게 문의해 주세요.');
 requireThat(m.issuer_type!=='ADMIN','SINGLE_ADMIN_ONLY','추가 관리자 초대는 사용할 수 없습니다.',403);
 if(m.issuer_type==='ADMIN'){const issuer=await member(db,m.invited_by!);requireThat(issuer.role==='ADMIN'&&issuer.status==='ACTIVE','ADMIN_INVITATION_INVALID','초대 발급자의 권한이 회수되었습니다.');}
 await db.query("UPDATE members SET status='ACTIVE',invite_accepted_at=$2,account_version=account_version+1,access_version=access_version+1,updated_at=$2,inactive_at=NULL WHERE id=$1",[m.id,now]);await adminNotice(db,m.id,'관리자 초대 수락',now);return {id:m.id};
}
