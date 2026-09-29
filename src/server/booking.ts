import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {DB} from './db';
import type {Member,Reservation} from '../shared/types';
import {at,localDate,minutes} from '../shared/time';
import {requireThat} from './errors';
import {checkFairness,ensureOpen,validWindow} from './policy';
import {audit,member,notifyReservation,policy,reservation,reservations,student} from './store';

const uuid=z.string().uuid();
const period=z.object({roomId:uuid,startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true})}).strict();
export const bookingSchemas={
 create:period.extend({inviteeIds:z.array(uuid).min(1).max(100)}),
 change:period.extend({id:uuid,expectedVersion:z.number().int().positive(),reason:z.string().trim().max(500).optional()}),
 cancel:z.object({id:uuid,expectedVersion:z.number().int().positive(),reason:z.string().trim().max(500).optional()}).strict(),
 invite:z.object({id:uuid,expectedVersion:z.number().int().positive(),inviteeIds:z.array(uuid).min(1).max(100)}).strict(),
 respond:z.object({id:uuid,invitationGeneration:z.number().int().positive(),accept:z.boolean()}).strict(),
 revoke:z.object({id:uuid,invitationGeneration:z.number().int().positive()}).strict(),
 leave:z.object({id:uuid,expectedVersion:z.number().int().positive()}).strict(),
 transfer:z.object({id:uuid,targetId:uuid,expectedVersion:z.number().int().positive()}).strict(),
 transferRespond:z.object({id:uuid,requestId:uuid,accept:z.boolean()}).strict(),
};
export async function syncClaims(db:DB,id:string){
 await db.query('DELETE FROM member_claims WHERE reservation_id=$1',[id]);
 await db.query(`INSERT INTO member_claims(reservation_id,member_id,during) SELECT r.id,p.member_id,tstzrange(r.starts_at,r.ends_at,'[)') FROM reservations r JOIN reservation_members p ON p.reservation_id=r.id WHERE r.id=$1 AND p.status='ACCEPTED' AND r.status IN ('HOLDING','CONFIRMED','REPLENISHING')`,[id]);
}
export async function cancelReservation(db:DB,r:Reservation,now:Date,reason:string,cooldownFrom:Date|null){
 await notifyReservation(db,{...r,version:r.version+1},'취소');
 await db.query("UPDATE reservations SET status='CANCELLED',cancel_reason=$2,version=version+1,transfer_request_id=NULL,transfer_to_id=NULL,transfer_from_id=NULL,transfer_expires_at=NULL WHERE id=$1",[r.id,reason]);
 await db.query("UPDATE reservation_members SET status='REVOKED' WHERE reservation_id=$1 AND status='INVITED'",[r.id]);
 await syncClaims(db,r.id);
 if(cooldownFrom){const p=await policy(db,localDate(r.starts_at));await db.query('UPDATE members SET cooldown_until=GREATEST(cooldown_until,$2) WHERE id=$1',[r.creator_id,new Date(cooldownFrom.getTime()+minutes(p.rules_json.cooldownMinutes))]);}
 await audit(db,null,'reservation.cancel',r.id,reason,now,randomUUID(),{},r.cohort_id);
}
export async function boundaries(db:DB,now:Date){
 const due=await reservations(db,"(r.status='CONFIRMED' AND (r.ends_at<=$1 OR (r.starts_at<=$1 AND r.start_snapshot_at IS NULL))) OR (r.status='HOLDING' AND r.initial_deadline<=$1) OR (r.status='REPLENISHING' AND r.replenish_deadline<=$1)",[now]);
 for(const r of due){
  const deadline=r.status==='HOLDING'?r.initial_deadline:r.status==='REPLENISHING'?r.replenish_deadline:null;
  if(deadline&&new Date(deadline)<=now){await cancelReservation(db,r,now,'최소 인원 모집 기한 만료',new Date(deadline));continue;}
  if(r.status==='CONFIRMED'&&new Date(r.starts_at)<=now){
   if(!r.start_snapshot_at){
    const ids=r.participants.filter(p=>p.status==='ACCEPTED').map(p=>p.member_id).sort();
    await db.query('UPDATE reservations SET start_member_ids=$2,start_snapshot_at=starts_at,version=version+1,transfer_request_id=NULL,transfer_to_id=NULL,transfer_from_id=NULL,transfer_expires_at=NULL WHERE id=$1',[r.id,ids]);
    await db.query("UPDATE reservation_members SET status='EXPIRED' WHERE reservation_id=$1 AND status='INVITED'",[r.id]);
   }
   if(new Date(r.ends_at)<=now){await db.query("UPDATE reservations SET status='ENDED',version=version+1 WHERE id=$1",[r.id]);await syncClaims(db,r.id);}
  }
 }
}
function beforeStart(r:Reservation,now:Date){requireThat(!['CANCELLED','ENDED'].includes(r.status)&&new Date(r.starts_at)>now,'RESERVATION_STARTED','시작 전인 유효 예약만 변경할 수 있습니다.');}
function version(r:Reservation,n:number){requireThat(r.version===n,'STALE_VERSION','예약이 변경되었습니다. 최신 내용을 확인해 주세요.');}
function organizer(r:Reservation,m:Member){requireThat(r.organizer_id===m.id||m.role==='ADMIN','FORBIDDEN','예약 책임자만 변경할 수 있습니다.',403);}
async function checkPeriod(db:DB,roomId:string,start:string,end:string,now:Date,excludeId?:string){
 const p=await policy(db,localDate(start));const rules=p.rules_json;validWindow(start,end,now,rules);
 const room=await db.query('SELECT * FROM rooms WHERE id=$1 AND active',[roomId]);requireThat(room.rowCount&&rules.rooms[roomId],'ROOM_UNAVAILABLE','운영 중인 회의실을 선택해 주세요.');
 const exceptions=await db.query('SELECT * FROM opening_exceptions WHERE local_date=$1',[localDate(start)]);ensureOpen(start,end,roomId,rules,exceptions.rows);
 const overlap=await db.query("SELECT 1 FROM reservations WHERE room_id=$1 AND status IN ('HOLDING','CONFIRMED','REPLENISHING') AND starts_at<$3 AND ends_at>$2 AND ($4::uuid IS NULL OR id<>$4)",[roomId,start,end,excludeId??null]);
 requireThat(!overlap.rowCount,'ROOM_UNAVAILABLE','다른 예약이 먼저 확보했습니다. 다른 시간을 선택해 주세요.');
 return p;
}
async function individual(db:DB,ids:string[],start:string,end:string,excludeId?:string){
 const conflict=await db.query("SELECT DISTINCT m.display_name FROM member_claims c JOIN members m ON m.id=c.member_id WHERE c.member_id=ANY($1::uuid[]) AND c.during && tstzrange($2,$3,'[)') AND ($4::uuid IS NULL OR c.reservation_id<>$4)",[ids,start,end,excludeId??null]);
 requireThat(!conflict.rowCount,'MEMBER_TIME_CONFLICT',`${conflict.rows.map(row=>row.display_name).join(', ')}님의 다른 예약과 시간이 겹칩니다. 시간을 변경하거나 초대 대상을 조정해 주세요.`);
}
async function eligibility(db:DB,ids:string[],now:Date){
 const members=(await db.query<Pick<Member,'id'|'role'|'status'>>('SELECT id,role,status FROM members WHERE id=ANY($1::uuid[])',[ids])).rows;
 const restricted=(await db.query("SELECT member_id FROM sanctions WHERE member_id=ANY($1::uuid[]) AND kind='RESTRICTED' AND revoked_at IS NULL AND starts_at<=$2 AND ends_at>$2",[ids,now])).rows;
 const byId=new Map(members.map(m=>[m.id,m])),blocked=new Set(restricted.map(s=>s.member_id));
 for(const id of ids){const m=byId.get(id);requireThat(m,'NOT_FOUND','계정을 찾을 수 없습니다.',404);requireThat(m.role==='STUDENT'&&m.status==='ACTIVE','FORBIDDEN','활성 학생 계정만 이용할 수 있습니다.',403);requireThat(!blocked.has(id),'MEMBER_RESTRICTED','이용 제한 기간입니다. 운영 담당자에게 문의해 주세요.');}
}
async function fairness(db:DB,r:Reservation,now:Date){const p=await policy(db,localDate(r.starts_at));const others=await reservations(db,"r.id<>$1 AND r.status IN ('CONFIRMED','REPLENISHING','ENDED') AND r.starts_at < $3::timestamptz + ($4 * interval '1 minute') AND r.ends_at > $2::timestamptz - ($4 * interval '1 minute')",[r.id,r.starts_at,r.ends_at,p.rules_json.gapMinutes]);checkFairness(r,others,now,p.rules_json);}
export async function settle(db:DB,id:string,now:Date,validateFair=true){
 let r=await reservation(db,id);if(['CANCELLED','ENDED'].includes(r.status))return;
 if(r.accepted_count>=r.minimum_snapshot){
  const candidate={...r,status:'CONFIRMED' as const};if(validateFair)await fairness(db,candidate,now);
  if(r.status!=='CONFIRMED'){
   const ids=r.participants.filter(p=>p.status==='ACCEPTED').map(p=>p.member_id).sort();
   await db.query("UPDATE reservations SET status='CONFIRMED',first_confirmed_at=COALESCE(first_confirmed_at,$2),first_confirmed_member_ids=COALESCE(first_confirmed_member_ids,$3::uuid[]) WHERE id=$1",[id,now,ids]);
   await notifyReservation(db,await reservation(db,id),'예약 확정');
  }
 }else if(r.first_confirmed_at&&new Date(r.starts_at)>now){
  const p=await policy(db,localDate(r.starts_at));const deadline=r.replenish_deadline?new Date(r.replenish_deadline):new Date(Math.min(now.getTime()+minutes(p.rules_json.refillMinutes),new Date(r.starts_at).getTime()));
  const other=await db.query("SELECT 1 FROM reservations WHERE creator_id=$1 AND id<>$2 AND status IN ('HOLDING','REPLENISHING')",[r.creator_id,id]);
  if(deadline<=now||other.rowCount){await cancelReservation(db,r,now,'보충 기한 또는 모집 건수 조건 미충족',now);return;}
  await db.query("UPDATE reservations SET status='REPLENISHING',replenish_deadline=$2 WHERE id=$1",[id,deadline]);
  if(r.status!=='REPLENISHING')await notifyReservation(db,await reservation(db,id),'인원 보충 필요');
 }
 await syncClaims(db,id);
}
export async function bookingCommand(db:DB,me:Member,name:string,input:unknown,now:Date,key:string){
 if(name==='create'){
  const v=bookingSchemas.create.parse(input);await student(db,me,now);
  const old=await db.query('SELECT id FROM reservations WHERE creator_id=$1 AND create_request_key=$2',[me.id,key]);requireThat(!old.rowCount,'IDEMPOTENCY_EXPIRED','이미 처리된 신청입니다. 내 예약에서 확인해 주세요.');
  requireThat(!me.cooldown_until||new Date(me.cooldown_until)<=now,'BOOKING_COOLDOWN','신규 신청 제한 중입니다. 잠시 후 다시 신청해 주세요.');
  const p=await checkPeriod(db,v.roomId,v.startsAt,v.endsAt,now);const spec=p.rules_json.rooms[v.roomId];
  const ids=[me.id,...v.inviteeIds.map(id=>id.toLowerCase())];requireThat(new Set(ids).size===ids.length&&ids.length<=spec.capacity&&ids.length>=spec.minimum,'CAPACITY_REACHED',`신청자를 포함해 ${spec.minimum}~${spec.capacity}명을 선택해 주세요.`);
  await eligibility(db,ids,now);await individual(db,ids,v.startsAt,v.endsAt);
  const holding=await db.query("SELECT 1 FROM reservations WHERE creator_id=$1 AND status IN ('HOLDING','REPLENISHING')",[me.id]);requireThat(!holding.rowCount,'HOLD_LIMIT','모집중인 예약을 먼저 완료해 주세요.');
  const id=randomUUID(),deadline=new Date(Math.min(now.getTime()+minutes(p.rules_json.holdMinutes),new Date(v.startsAt).getTime()));
  await db.query("INSERT INTO reservations(id,cohort_id,room_id,creator_id,organizer_id,policy_version_id,capacity_snapshot,minimum_snapshot,starts_at,ends_at,status,initial_deadline,create_request_key,first_confirmed_at,first_confirmed_member_ids) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,'CONFIRMED',$10,$11,$12,$13)",[id,me.cohort_id,v.roomId,me.id,p.id,spec.capacity,spec.minimum,v.startsAt,v.endsAt,deadline,key,now,[...ids].sort()]);
  await db.query("INSERT INTO reservation_members(reservation_id,member_id,invited_by,status,responded_at) SELECT $1,mid,$3,'ACCEPTED',$4 FROM unnest($2::uuid[]) AS mid",[id,ids,me.id,now]);
  // Nothing is visible until this transaction passes fairness and commits.
  const confirmed=await reservation(db,id);await fairness(db,confirmed,now);await syncClaims(db,id);await notifyReservation(db,confirmed,'예약 확정');return {id};
 }
 if(name==='respond'||name==='revoke'){
  const v=name==='respond'?bookingSchemas.respond.parse(input):bookingSchemas.revoke.parse(input);
  const pr=await db.query('SELECT * FROM reservation_members WHERE id=$1',[v.id]);const invitation=pr.rows[0];requireThat(invitation,'NOT_FOUND','초대를 찾을 수 없습니다.',404);
  let r=await reservation(db,invitation.reservation_id);beforeStart(r,now);
  requireThat(invitation.invitation_generation===v.invitationGeneration,'STALE_INVITATION','이전 초대입니다. 받은 초대를 새로 확인해 주세요.');
  if(name==='respond'){
   requireThat(invitation.member_id===me.id,'FORBIDDEN','본인의 초대만 응답할 수 있습니다.',403);await student(db,me,now);
   const accept='accept' in v&&v.accept;
   if(invitation.status===(accept?'ACCEPTED':'DECLINED'))return {id:r.id};
   requireThat(invitation.status==='INVITED','INVITATION_EXPIRED','종료된 초대입니다. 최신 초대를 확인해 주세요.');
   if(accept)await individual(db,[me.id],r.starts_at,r.ends_at,r.id);
   await db.query('UPDATE reservation_members SET status=$2,responded_at=$3 WHERE id=$1',[v.id,accept?'ACCEPTED':'DECLINED',now]);
   await db.query('UPDATE reservations SET version=version+1 WHERE id=$1',[r.id]);await settle(db,r.id,now);return {id:r.id};
  }
  requireThat(r.organizer_id===me.id||invitation.invited_by===me.id&&r.participants.some(p=>p.member_id===me.id&&p.status==='ACCEPTED'),'FORBIDDEN','이 초대를 취소할 권한이 없습니다.',403);
  requireThat(invitation.status==='INVITED','INVITATION_EXPIRED','대기 중인 초대만 취소할 수 있습니다.');
  await db.query("UPDATE reservation_members SET status='REVOKED',responded_at=$2 WHERE id=$1",[v.id,now]);await db.query('UPDATE reservations SET version=version+1 WHERE id=$1',[r.id]);return {id:r.id};
 }
 if(name==='transferRespond'){
  const v=bookingSchemas.transferRespond.parse(input);const r=await reservation(db,v.id);beforeStart(r,now);await student(db,me,now);
  requireThat(r.transfer_request_id===v.requestId&&r.transfer_to_id===me.id&&r.participants.some(p=>p.member_id===me.id&&p.status==='ACCEPTED'),'STALE_VERSION','유효한 책임 이전 요청이 아닙니다.');
  if(v.accept){const count=await db.query("SELECT 1 FROM reservations WHERE (creator_id=$1 OR organizer_id=$1) AND id<>$2 AND status IN ('HOLDING','REPLENISHING')",[me.id,r.id]);requireThat(!count.rowCount,'HOLD_LIMIT','다른 모집중 예약을 먼저 완료해 주세요.');}
  await db.query('UPDATE reservations SET organizer_id=$2,version=version+1,transfer_request_id=NULL,transfer_from_id=NULL,transfer_to_id=NULL,transfer_expires_at=NULL WHERE id=$1',[r.id,v.accept?me.id:r.organizer_id]);await notifyReservation(db,await reservation(db,r.id),'책임 이전 응답');return {id:r.id};
 }
 if(name==='invite'){
  const v=bookingSchemas.invite.parse(input);const r=await reservation(db,v.id);beforeStart(r,now);version(r,v.expectedVersion);await student(db,me,now);
  requireThat(r.participants.some(p=>p.member_id===me.id&&p.status==='ACCEPTED'),'FORBIDDEN','참여자만 초대할 수 있습니다.',403);
  const ids=[...new Set(v.inviteeIds.map(id=>id.toLowerCase()))];requireThat(ids.length===v.inviteeIds.length&&!ids.some(id=>r.participants.some(p=>p.member_id===id&&['INVITED','ACCEPTED'].includes(p.status))),'INVALID_INPUT','이미 참여하거나 초대된 학생입니다.',422);
  requireThat(r.accepted_count+r.invited_count+ids.length<=r.capacity_snapshot,'CAPACITY_REACHED','회의실 정원을 초과합니다.');await eligibility(db,ids,now);await individual(db,ids,r.starts_at,r.ends_at,r.id);
  await db.query("INSERT INTO reservation_members(reservation_id,member_id,invited_by,status,responded_at) SELECT $1,mid,$3,'ACCEPTED',$4 FROM unnest($2::uuid[]) AS mid ON CONFLICT(reservation_id,member_id) DO UPDATE SET status='ACCEPTED',invited_by=$3,invitation_generation=reservation_members.invitation_generation+1,responded_at=$4",[r.id,ids,me.id,now]);
  await db.query('UPDATE reservations SET version=version+1 WHERE id=$1',[r.id]);await settle(db,r.id,now);await notifyReservation(db,await reservation(db,r.id),'구성원 자동 참여');return {id:r.id};
 }
 if(name==='transfer'){
  const v=bookingSchemas.transfer.parse(input),r=await reservation(db,v.id);beforeStart(r,now);version(r,v.expectedVersion);requireThat(r.organizer_id===me.id,'FORBIDDEN','현재 책임자만 이전할 수 있습니다.',403);
  requireThat(v.targetId!==me.id&&r.participants.some(p=>p.member_id===v.targetId&&p.status==='ACCEPTED'),'INVALID_INPUT','다른 수락자를 선택해 주세요.',422);await student(db,await member(db,v.targetId),now);
  await db.query('UPDATE reservations SET transfer_request_id=$2,transfer_from_id=$3,transfer_to_id=$4,transfer_expires_at=starts_at,version=version+1 WHERE id=$1',[r.id,randomUUID(),me.id,v.targetId]);await notifyReservation(db,await reservation(db,r.id),'책임 이전 요청');return {id:r.id};
 }
 if(name==='leave'){
  const v=bookingSchemas.leave.parse(input),r=await reservation(db,v.id);beforeStart(r,now);version(r,v.expectedVersion);
  requireThat(me.role==='STUDENT'&&r.organizer_id!==me.id,'FORBIDDEN','책임자는 책임을 이전하거나 전체 예약을 취소해 주세요.',403);
  requireThat(r.participants.some(p=>p.member_id===me.id&&p.status==='ACCEPTED'),'FORBIDDEN','본인 참여만 취소할 수 있습니다.',403);
  await db.query("UPDATE reservation_members SET status='LEFT',responded_at=$3 WHERE reservation_id=$1 AND member_id=$2",[r.id,me.id,now]);
  await db.query('UPDATE reservations SET version=version+1,transfer_request_id=CASE WHEN transfer_to_id=$2 THEN NULL ELSE transfer_request_id END,transfer_to_id=CASE WHEN transfer_to_id=$2 THEN NULL ELSE transfer_to_id END WHERE id=$1',[r.id,me.id]);await settle(db,r.id,now,false);return {id:r.id};
 }
 if(name==='cancel'){
  const v=bookingSchemas.cancel.parse(input),r=await reservation(db,v.id);version(r,v.expectedVersion);organizer(r,me);
  if(me.role!=='ADMIN')beforeStart(r,now);else requireThat(v.reason,'INVALID_INPUT','관리자 처리 사유를 입력해 주세요.',422);
  requireThat(!['CANCELLED','ENDED'].includes(r.status),'INVALID_STATE','이미 종료된 예약입니다.');
  await cancelReservation(db,r,now,v.reason??'책임자 취소',me.role!=='ADMIN'&&['HOLDING','REPLENISHING'].includes(r.status)?now:null);return {id:r.id};
 }
 if(name==='change'){
  const v=bookingSchemas.change.parse(input),r=await reservation(db,v.id);beforeStart(r,now);version(r,v.expectedVersion);organizer(r,me);
  if(me.role==='ADMIN')requireThat(v.reason,'INVALID_INPUT','처리 사유를 입력해 주세요.',422);
  const p=await checkPeriod(db,v.roomId,v.startsAt,v.endsAt,now,r.id),spec=p.rules_json.rooms[v.roomId];
  requireThat(r.accepted_count+r.invited_count<=spec.capacity,'CAPACITY_REACHED','선택한 회의실의 정원을 초과합니다.');
  requireThat(r.status!=='CONFIRMED'||r.accepted_count>=spec.minimum,'MINIMUM_NOT_MET','선택한 회의실의 최소 인원이 부족합니다.');
  await individual(db,r.participants.filter(p=>p.status==='ACCEPTED').map(p=>p.member_id),v.startsAt,v.endsAt,r.id);
  const candidate={...r,room_id:v.roomId,starts_at:v.startsAt,ends_at:v.endsAt,capacity_snapshot:spec.capacity,minimum_snapshot:spec.minimum};
  if(candidate.accepted_count>=spec.minimum)candidate.status='CONFIRMED';await fairness(db,candidate,now);
  await db.query('UPDATE reservations SET room_id=$2,starts_at=$3,ends_at=$4,policy_version_id=$5,capacity_snapshot=$6,minimum_snapshot=$7,initial_deadline=LEAST(initial_deadline,$3),replenish_deadline=CASE WHEN replenish_deadline IS NOT NULL THEN LEAST(replenish_deadline,$3) ELSE NULL END,transfer_expires_at=CASE WHEN transfer_request_id IS NOT NULL THEN $3 ELSE NULL END,version=version+1 WHERE id=$1',[r.id,v.roomId,v.startsAt,v.endsAt,p.id,spec.capacity,spec.minimum]);
  // The final candidate was already checked above, including its historical rosters.
  await settle(db,r.id,now,false);await notifyReservation(db,await reservation(db,r.id),'예약 변경');return {id:r.id};
 }
 throw new Error('Unknown booking command');
}
