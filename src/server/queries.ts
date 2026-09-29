import type {Session,Snapshot,Reservation} from '../shared/types';
import {localDate,addDays,at} from '../shared/time';
import {pool} from './db';
import {actor,admin,policy,redact,reservations,reservation} from './store';
import {isLocal} from './auth';
function projected(r:Reservation,now:Date){
 const deadline=r.status==='HOLDING'?r.initial_deadline:r.status==='REPLENISHING'?r.replenish_deadline:null;
 if(deadline&&new Date(deadline)<=now)return {...r,status:'CANCELLED' as const};
 if(r.status==='CONFIRMED'&&new Date(r.ends_at)<=now)return {...r,status:'ENDED' as const};return r;
}
export async function reservationDetail(session:Session,id:string){
 const db=await pool().connect();try{const now=new Date(),me=await actor(db,session,now);return redact(projected(await reservation(db,id),now),me);}finally{db.release();}
}
export async function snapshot(session:Session,date:string):Promise<Snapshot>{
 const db=await pool().connect();try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const now=new Date(),me=await actor(db,session,now);const p=await policy(db,date);
  const rooms=(await db.query('SELECT * FROM rooms WHERE active ORDER BY display_order')).rows.map(r=>({...r,...p.rules_json.rooms[r.id]}));
  const all=(await reservations(db,`(r.starts_at >= $1 AND r.starts_at < $2) OR
   (r.starts_at >= $3::date - interval '30 day' AND r.starts_at < GREATEST($3::date,$4::date) + interval '32 day'
    AND EXISTS (SELECT 1 FROM reservation_members own WHERE own.reservation_id=r.id AND own.member_id=$5 AND own.status IN ('ACCEPTED','INVITED')))`,
   [at(date,'00:00'),at(addDays(date,1),'00:00'),localDate(now),date,me.id])).map(r=>projected(r,now));
  const students=(await db.query("SELECT id,display_name,class_name FROM members WHERE role='STUDENT' AND status='ACTIVE' ORDER BY display_name")).rows;
  const closed=(await db.query('SELECT room_id,local_start,local_end,kind FROM opening_exceptions WHERE local_date=$1',[date])).rows;
  const mine=all.filter(r=>r.participants.some(p=>p.member_id===me.id&&p.status==='ACCEPTED')).map(r=>redact(r,me));
  const invitations=all.filter(r=>!['CANCELLED','ENDED'].includes(r.status)&&new Date(r.starts_at)>now&&r.participants.some(p=>p.member_id===me.id&&r.organizer_id!==me.id&&['ACCEPTED','INVITED'].includes(p.status))).map(r=>redact(r,me));
  await db.query('COMMIT');
  return {me:{id:me.id,display_name:me.display_name,email:me.email,role:me.role,status:me.status,access_version:me.access_version,admin_invite_id:me.admin_invite_id,invite_expires_at:me.invite_expires_at},now:now.toISOString(),local:isLocal(),date,rules:p.rules_json,rooms,reservations:all.filter(r=>localDate(r.starts_at)===date).map(r=>redact(r,me)),mine,invitations,students,closed};
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
export type AdminSection='all'|'reservations'|'accounts'|'students'|'settings'|'reports'|'history';
export async function adminData(session:Session,section:AdminSection='all'){const db=await pool().connect();try{const now=new Date(),me=await actor(db,session,now);admin(me,session,now);
 const accounts=(section==='all'||section==='accounts')?(await db.query("SELECT id,email,display_name,role,status,account_version,access_version,admin_invite_id,invite_expires_at,invite_accepted_at,invite_revoked_at,updated_at FROM members WHERE role='ADMIN' ORDER BY created_at")).rows:[];
 const students=(section==='all'||section==='students'||section==='reports')?(await db.query("SELECT m.id,m.email,m.display_name,m.class_name,m.status,m.cohort_id,m.account_version,c.name cohort_name FROM members m JOIN cohorts c ON c.id=m.cohort_id WHERE role='STUDENT' ORDER BY display_name")).rows:[];
 const reports=(section==='all'||section==='reservations'||section==='reports')?(await db.query('SELECT r.*,m.display_name reporter_name FROM reports r JOIN members m ON m.id=r.reporter_id ORDER BY r.created_at DESC LIMIT 200')).rows:[];
 const audits=(section==='all'||section==='history')?(await db.query('SELECT a.*,m.display_name actor_name FROM audit_events a LEFT JOIN members m ON m.id=a.actor_id ORDER BY decided_at DESC LIMIT 200')).rows:[];
 const cohorts=(section==='all'||section==='students')?(await db.query('SELECT * FROM cohorts ORDER BY starts_on DESC')).rows:[];
 const policies=(section==='all'||section==='settings')?(await db.query('SELECT * FROM policy_versions ORDER BY effective_on DESC')).rows:[];
 const exceptions=(section==='all'||section==='settings')?(await db.query('SELECT * FROM opening_exceptions WHERE local_date>=$1 ORDER BY local_date',[localDate(now)])).rows:[];
 const tasks=(section==='all'||section==='history')?(await db.query("SELECT id,kind,status,attempts,next_run_at,last_error_code FROM tasks WHERE status IN ('FAILED','PENDING') ORDER BY created_at DESC LIMIT 50")).rows:[];
 const sanctions=(section==='all'||section==='reports')?(await db.query('SELECT s.*,m.display_name FROM sanctions s JOIN members m ON m.id=s.member_id WHERE s.ends_at>$1 AND revoked_at IS NULL',[now])).rows:[];
 return {accounts,students,reports,audits,cohorts,policies,exceptions,tasks,sanctions,recentAuth:now.getTime()-session.verifiedAt<600000,earliestPolicyDate:(section==='all'||section==='settings')?addDays(localDate(now),(await policy(db,localDate(now))).rules_json.windowDays+1):''};
 }finally{db.release();}}

// Return only the selected members' occupied times, without reservation identifiers or rosters.
export async function memberConflicts(session:Session,ids:string[],start:string,end:string){
 const db=await pool().connect();try{
  const now=new Date();await actor(db,session,now);
  return (await db.query(`SELECT DISTINCT c.member_id,lower(c.during) starts_at,upper(c.during) ends_at
   FROM member_claims c JOIN reservations r ON r.id=c.reservation_id
   JOIN members m ON m.id=c.member_id
   WHERE c.member_id=ANY($1::uuid[]) AND m.status='ACTIVE'
   AND c.during && tstzrange($2,$3,'[)')
   AND r.status IN ('HOLDING','CONFIRMED','REPLENISHING') AND r.ends_at>$4
   AND (r.status<>'HOLDING' OR r.initial_deadline>$4)
   AND (r.status<>'REPLENISHING' OR r.replenish_deadline>$4)
   ORDER BY starts_at`,[ids,start,end,now])).rows;
 }finally{db.release();}
}
