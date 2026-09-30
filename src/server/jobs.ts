import {WebClient} from '@slack/web-api';
import {publish} from '../slack/publish-home';
import {randomUUID} from 'node:crypto';
import nodemailer from 'nodemailer';
import {pool,transaction} from './db';
import {boundaries} from './booking';
import {isLocal,supabase} from './auth';
import {member,reservation} from './store';
import {localDate,localTime} from '../shared/time';
import {stateLabels,type Member} from '../shared/types';
import {workspaceAuthorization} from '../slack/installations';
import {scheduleHolidaySync,syncHolidayTask} from './holidays';
import {syncWorkspaceRosters} from './workspace-roster';
type Task={id:string;kind:string;recipient_id:string|null;channel:string|null;payload:Record<string,string>;lease_token:string;attempts:number};
export async function sendMail(to:string,subject:string,text:string){
 if(isLocal()){await pool().query('INSERT INTO local_auth.mailbox(recipient,subject,body) VALUES($1,$2,$3)',[to,subject,text]);return;}
 if(!process.env.SMTP_HOST||!process.env.SMTP_FROM)throw Error('SMTP_NOT_CONFIGURED');
 const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT??587),secure:process.env.SMTP_PORT==='465',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined,connectionTimeout:10000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true});
 await transport.sendMail({from:process.env.SMTP_FROM,to,subject,text});
}
export async function runTask(task:Task){
 if(task.channel==='SLACK_ADMIN_INVITE')return;
 if(task.kind==='HOLIDAY_SYNC'){await syncHolidayTask(task);return;}
 if(task.kind==='MEMBER_PROVISION'){
  const db=await pool().connect();let m;try{m=await member(db,task.payload.memberId);}finally{db.release();}
  if(m.role!==task.payload.role||m.role==='ADMIN'&&(m.admin_invite_id!==task.payload.invitationId||m.invite_revoked_at))return;
  if(m.role==='STUDENT'&&m.status!=='REGISTERED'&&m.status!=='PROVISIONING')return;
  if(!m.email)throw Error('EMAIL_REQUIRED_FOR_PROVISIONING');
  let authId=m.auth_user_id;
  if(!authId){if(isLocal())authId=randomUUID();else{
   const api=supabase(true);const {data,error}=await api.auth.admin.createUser({email:m.email,email_confirm:true});
   if(error){for(let page=1;page<=20&&!authId;page++){const list=await api.auth.admin.listUsers({page,perPage:100});authId=list.data.users.find(u=>u.email===m.email)?.id??null;if(list.data.users.length<100)break;}if(!authId)throw Error('AUTH_PROVISION_FAILED');}else authId=data.user.id;
  }}
  await transaction(async(db,now)=>{const current=await member(db,m.id);if(current.role!==task.payload.role||current.role==='ADMIN'&&(current.admin_invite_id!==task.payload.invitationId||current.invite_revoked_at))return;
   if(current.role==='STUDENT'&&!['REGISTERED','PROVISIONING'].includes(current.status))return;
   await db.query("UPDATE members SET auth_user_id=$2,status=CASE WHEN role='STUDENT' THEN 'ACTIVE' ELSE status END,updated_at=$3 WHERE id=$1",[m.id,authId,now]);
  });return;
 }
 if(task.kind==='NOTIFY'&&task.recipient_id){
  const db=await pool().connect();let m:Member,text=task.payload.event??'알림';try{
   m=await member(db,task.recipient_id);
   if(m.role==='ADMIN'&&m.admin_slack_user)m={...m,slack_user_id:m.admin_slack_user};
   if(task.channel==='SLACK_HOME'){
    if(m.slack_user_id&&(m.status==='ACTIVE'||m.role==='ADMIN')&&!isLocal()){const team=(await db.query('SELECT COALESCE(admin_slack_team,slack_workspace_id) slack_workspace_id FROM members WHERE id=$1',[m.id])).rows[0]?.slack_workspace_id;const auth=await workspaceAuthorization(team??'');await publish(new WebClient(auth.botToken,{timeout:10000,retryConfig:{retries:0}}),team,m.slack_user_id,m.status==='ACTIVE');}return;
   }
   if(task.payload.invitationId&&(m.admin_invite_id!==task.payload.invitationId||m.invite_revoked_at||m.invite_accepted_at))return;
   if(task.channel==='SLACK_ADMIN_INVITE'&&(!m.invite_expires_at||new Date(m.invite_expires_at)<=new Date()))return;
   if(task.payload.invitationId&&task.channel!=='SLACK_ADMIN_INVITE')text+='\n24시간 안에 이메일 본인 인증 후 초대를 수락해 주세요.\n'+process.env.APP_BASE_URL+'/admin/onboarding?invitation='+task.payload.invitationId;
   if(task.payload.reservationId){const r=await reservation(db,task.payload.reservationId);const own=r.participants.find(p=>p.member_id===m.id);if(!own)return;if(task.payload.event==='초대'&&(!['INVITED','ACCEPTED'].includes(own.status)||['CANCELLED','ENDED'].includes(r.status)))return;
    const roomInfo=(await db.query('SELECT r.name,v.name venue_name FROM rooms r LEFT JOIN venues v ON v.id=r.venue_id WHERE r.id=$1',[r.room_id])).rows[0];const room=[roomInfo?.venue_name,roomInfo?.name??'회의실'].filter(Boolean).join(' · ');
    text=`${task.payload.event} · ${room}\n${localDate(r.starts_at)} ${localTime(r.starts_at)}–${localTime(r.ends_at)}\n현재 상태: ${stateLabels[r.status]}\n${process.env.APP_BASE_URL}/reservations/${r.id}`;
   }if(task.payload.reason)text+='\n'+task.payload.reason;
  }finally{db.release();}
  if(['AUTO','SLACK_ADMIN_INVITE'].includes(task.channel??'')&&m.slack_user_id&&!isLocal()){
   const team=(await pool().query('SELECT COALESCE(admin_slack_team,slack_workspace_id) slack_workspace_id FROM members WHERE id=$1',[m.id])).rows[0]?.slack_workspace_id;
   const auth=await workspaceAuthorization(team??'');
   const invite=false;
   const response=await fetch('https://slack.com/api/chat.postMessage',{method:'POST',headers:{Authorization:`Bearer ${auth.botToken}`,'Content-Type':'application/json'},body:JSON.stringify({channel:m.slack_user_id,text,unfurl_links:false,unfurl_media:false,blocks:[{type:'section',text:{type:'plain_text',text:text.slice(0,2900)}},...(invite?[{type:'actions',elements:[{type:'button',text:{type:'plain_text',text:'관리자 초대 수락'},style:'primary',action_id:'admin_invite_accept',value:task.payload.invitationId},{type:'button',text:{type:'plain_text',text:'거절'},action_id:'admin_invite_decline',value:task.payload.invitationId}]}]:process.env.SLACK_APP_ID?[{type:'actions',elements:[{type:'button',text:{type:'plain_text',text:'내 예약 확인'},action_id:'web_notification_home',url:'https://slack.com/app_redirect?'+new URLSearchParams({app:process.env.SLACK_APP_ID,team,tab:'home'}).toString()}]}]:[])]}),signal:AbortSignal.timeout(15000)});const body=await response.json();if(!body.ok)throw Error('SLACK_'+String(body.error??'DELIVERY_FAILED').replace(/[^a-z_]/gi,'').toUpperCase());return {slackAccepted:true,channel:body.channel,ts:body.ts};
  }else if(m.email)await sendMail(m.email,'[회의실 예약] '+(task.payload.event??'알림'),text);
  else if(!isLocal())throw Error('NOTIFICATION_DESTINATION_MISSING');
  return;
 }
 throw Error('UNSUPPORTED_TASK_KIND');
}
export async function tick(){
 void syncWorkspaceRosters().catch(()=>console.error('booking.roster: scheduling failed'));
 await transaction(async(db,now)=>{await boundaries(db,now);await db.query('UPDATE settings SET job_heartbeat=$1 WHERE id=1',[now]);await db.query('DELETE FROM command_receipts WHERE expires_at<$1',[now]);await scheduleHolidaySync(db,now);});
 for(let i=0;i<5;i++){
  const token=randomUUID();const claimed=await pool().query<Task>(`UPDATE tasks SET status='RUNNING',lease_until=clock_timestamp()+interval '60 seconds',lease_token=$1,attempts=attempts+1 WHERE id=(SELECT id FROM tasks WHERE (status='PENDING' AND next_run_at<=clock_timestamp()) OR (status='RUNNING' AND lease_until<clock_timestamp()) ORDER BY CASE WHEN kind='MEMBER_PROVISION' THEN 0 ELSE 1 END,created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[token]);const task=claimed.rows[0];if(!task)break;
  try{const delivery=await runTask(task);await pool().query("UPDATE tasks SET status='DONE',lease_until=NULL,result_summary=$3 WHERE id=$1 AND lease_token=$2",[task.id,token,JSON.stringify({completed:true,...delivery})]);}
  catch(e){const delay=[60000,300000,900000][task.attempts-1]??900000;await pool().query("UPDATE tasks SET status=$3,next_run_at=$4,lease_until=NULL,last_error_code=$5 WHERE id=$1 AND lease_token=$2",[task.id,token,task.attempts>=4?'FAILED':'PENDING',new Date(Date.now()+delay),e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'EXTERNAL_FAILURE']);}
 }
}
const state=globalThis as unknown as {bookingJobs?:ReturnType<typeof setInterval>;bookingTickBusy?:boolean};
export function startJobs(){if(state.bookingJobs||process.env.RUN_JOBS!=='true')return;state.bookingJobs=setInterval(async()=>{if(state.bookingTickBusy)return;state.bookingTickBusy=true;try{await tick();}catch{console.error('booking.jobs: tick failed; retrying next interval');}finally{state.bookingTickBusy=false;}},2000);state.bookingJobs.unref();}
