import type {DB} from './db';
import type {Member,Reservation,Rules,Session} from '../shared/types';
import {requireThat} from './errors';

export async function member(db:DB,id:string){const r=await db.query<Member>('SELECT * FROM members WHERE id=$1',[id]);requireThat(r.rows[0],'NOT_FOUND','계정을 찾을 수 없습니다.',404);return r.rows[0];}
export async function actor(db:DB,session:Session,now:Date,allowPending=false){
 const m=await member(db,session.memberId);
 requireThat(session.expiresAt>now.getTime(),'UNAUTHENTICATED','다시 로그인해 주세요.',401);
 requireThat(m.access_version===session.accessVersion,'ACCESS_REVOKED','계정 권한이 변경되었습니다. 다시 로그인해 주세요.',401);
 requireThat(m.status==='ACTIVE'||allowPending&&m.role==='ADMIN','ACCESS_REVOKED','비활성 계정입니다. 운영 담당자에게 문의해 주세요.',403);
 return m;
}
export function admin(m:Member,session:Session,now:Date,recent=false){
 requireThat(m.role==='ADMIN'&&m.status==='ACTIVE','FORBIDDEN','관리자 권한이 필요합니다.',403);
 if(recent)requireThat(now.getTime()-session.verifiedAt<600000&&session.verifiedAt<=now.getTime()+30000,'RECENT_AUTH_REQUIRED','이메일 코드로 다시 인증해 주세요.',403);
}
export async function student(db:DB,m:Member,now:Date){
 requireThat(m.role==='STUDENT'&&m.status==='ACTIVE','FORBIDDEN','활성 학생 계정만 이용할 수 있습니다.',403);
 const restricted=await db.query("SELECT 1 FROM sanctions WHERE member_id=$1 AND kind='RESTRICTED' AND revoked_at IS NULL AND starts_at<=$2 AND ends_at>$2",[m.id,now]);
 requireThat(!restricted.rowCount,'MEMBER_RESTRICTED','이용 제한 기간입니다. 운영 담당자에게 문의해 주세요.');
}
export async function policy(db:DB,date:string){const r=await db.query<{id:string;rules_json:Rules;effective_on:string}>('SELECT * FROM policy_versions WHERE effective_on<=$1 ORDER BY effective_on DESC LIMIT 1',[date]);requireThat(r.rows[0],'POLICY_MISSING','운영 정책이 등록되지 않았습니다.',503);return r.rows[0];}
export async function reservations(db:DB,where='TRUE',params:unknown[]=[]):Promise<Reservation[]>{
 const result=await db.query(`SELECT r.*,m.display_name organizer_name,
 COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'member_id',p.member_id,'display_name',u.display_name,'status',p.status,'invited_by',p.invited_by,'invitation_generation',p.invitation_generation)) FILTER(WHERE p.id IS NOT NULL),'[]'::jsonb) participants,
 count(*) FILTER(WHERE p.status='ACCEPTED')::int accepted_count,count(*) FILTER(WHERE p.status='INVITED')::int invited_count
 FROM reservations r JOIN members m ON m.id=r.organizer_id LEFT JOIN reservation_members p ON p.reservation_id=r.id LEFT JOIN members u ON u.id=p.member_id
 WHERE ${where} GROUP BY r.id,m.display_name ORDER BY r.starts_at,r.created_at`,params);
 return result.rows;
}
export async function reservation(db:DB,id:string){const rows=await reservations(db,'r.id=$1',[id]);requireThat(rows[0],'NOT_FOUND','예약을 찾을 수 없습니다.',404);return rows[0];}
export async function audit(db:DB,actorId:string|null,action:string,id:string|null,reason:string,now:Date,requestId:string,after:unknown={},cohortId:string|null=null){
 await db.query('INSERT INTO audit_events(actor_id,action,entity_type,entity_id,reason,decided_at,request_id,after_summary,cohort_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[actorId,action,action.split('.')[0],id,reason,now,requestId,JSON.stringify(after),cohortId]);
}
export async function queue(db:DB,kind:string,key:string,payload:unknown,recipient:string|null=null,channel:string|null=null){
 await db.query('INSERT INTO tasks(kind,dedupe_key,payload,recipient_id,channel) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO NOTHING',[kind,key,JSON.stringify(payload),recipient,channel]);
}
export async function notifyReservation(db:DB,r:Reservation,event:string){
 for(const p of r.participants.filter(p=>['ACCEPTED','INVITED'].includes(p.status))){
  await queue(db,'NOTIFY',`${r.id}:${r.version}:${event}:${p.member_id}`,{reservationId:r.id,version:r.version,event},p.member_id,'AUTO');
 }
}
export function redact(r:Reservation,me:Member):Reservation{
 if(me.role==='ADMIN')return r;
 const own=r.participants.find(p=>p.member_id===me.id);
 const allowed=own?.status==='ACCEPTED'?'accepted':own?.status==='INVITED'?'invited':'public';
 return {...r,participants:r.participants.filter(p=>p.member_id===me.id||(allowed==='accepted'&&['ACCEPTED','INVITED'].includes(p.status))||(allowed==='invited'&&p.status==='ACCEPTED')),
  first_confirmed_member_ids:null,start_member_ids:null,first_confirmed_at:null,start_snapshot_at:null,cancel_reason:r.cancel_reason?'예약이 취소되었습니다. 자세한 사항은 운영 담당자에게 문의해 주세요.':null,
  transfer_request_id:own?.status==='ACCEPTED'?r.transfer_request_id:null,transfer_to_id:own?.status==='ACCEPTED'?r.transfer_to_id:null,transfer_from_id:own?.status==='ACCEPTED'?r.transfer_from_id:null};
}
