import {withTenant} from './saas/runtime';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {WebClient} from '@slack/web-api';
import {z} from 'zod';
import {pool,controlPool,saasEnabled,databaseContext} from './db';
import {requireThat} from './errors';
import {allowedLocalHost} from './local-network';
import {workspaceAuthorization} from '../slack/installations';
import {activeWorkspaceMember,nativeMembership} from '../slack/members';
import type {Session} from '../shared/types';
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
export function webDestination(value:string){return z.string().regex(/^\/(schedule|admin\/reservations|reservations\/[0-9a-f-]{36})$/).parse(value);}
export function slackWebBase(){
 const url=new URL(process.env.SLACK_WEB_BASE_URL??process.env.APP_BASE_URL??'');
 requireThat(url.protocol==='https:'||(process.env.APP_ENV==='local'&&process.env.NODE_ENV!=='production'&&url.protocol==='http:'&&allowedLocalHost(url.hostname)),'CONFIGURATION','예약 웹 주소를 확인해 주세요.',503);
 requireThat(url.pathname==='/'&&!url.username&&!url.password&&!url.search&&!url.hash,'CONFIGURATION','예약 웹 주소를 확인해 주세요.',503);return url.origin;
}
export async function createWebLink(team:string,user:string,session:Session,destination='/schedule',waitForClick=false){
 const base=slackWebBase();webDestination(destination);

 const member=(await pool().query("SELECT id,role FROM members WHERE id=$1 AND COALESCE(admin_slack_team,slack_workspace_id)=$2 AND COALESCE(admin_slack_user,slack_user_id)=$3 AND status='ACTIVE' AND access_version=$4",[session.memberId,team,user,session.accessVersion])).rows[0];
 requireThat(member&&(destination.startsWith('/admin/')?member.role==='ADMIN':member.role==='STUDENT'),'FORBIDDEN','이 화면을 열 권한이 없습니다.',403);
 requireThat(member,'ACCOUNT_DENIED','활성 계정으로 이용해 주세요.',403);
 await workspaceAuthorization(team);if(member.role==='STUDENT')requireThat(await nativeMembership(team),'WORKSPACE_DENIED','승인된 클래스에서 이용해 주세요.',403);
 const token=randomBytes(32).toString('base64url');
 await pool().query('DELETE FROM slack_web_links WHERE expires_at<clock_timestamp()');
 await pool().query("INSERT INTO slack_web_links(token_hash,team_id,user_id,member_id,access_version,destination,expires_at,ready) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+CASE WHEN $7 THEN interval '12 hours' ELSE interval '2 minutes' END,NOT $7)",[digest(token),team,user,session.memberId,session.accessVersion,destination,waitForClick]);
 return base+'/slack-entry#'+token;
}
export async function activateWebLink(team:string,user:string,token:string){
 requireThat(/^[A-Za-z0-9_-]{43}$/.test(token),'INVALID_FLOW','앱 홈을 새로고침해 주세요.',401);
 await pool().query("UPDATE slack_web_links SET ready=true,expires_at=clock_timestamp()+interval '2 minutes' WHERE token_hash=$1 AND team_id=$2 AND user_id=$3 AND NOT ready AND expires_at>clock_timestamp()",[digest(token),team,user]);
}
const checked=new Map<string,number>();
export async function verifySlackWebSession(session:Session){
 const identity=session.slack;
 requireThat(identity,'UNAUTHENTICATED','Slack에서 다시 열어 주세요.',401);
 const auth=await workspaceAuthorization(identity.team);

 const member=(await pool().query("SELECT id,role FROM members WHERE id=$1 AND COALESCE(admin_slack_team,slack_workspace_id)=$2 AND COALESCE(admin_slack_user,slack_user_id)=$3 AND status='ACTIVE' AND access_version=$4",[session.memberId,identity.team,identity.user,session.accessVersion])).rows[0];
 requireThat(member,'ACCOUNT_DENIED','이용할 수 없는 계정입니다.',403);
 if(member.role==='STUDENT')requireThat(await nativeMembership(identity.team),'WORKSPACE_DENIED','클래스 이용이 종료되었습니다.',403);
 const key=identity.team+':'+identity.user,now=Date.now();
 if((checked.get(key)??0)<now){
  const result=await new WebClient(auth.botToken,{timeout:10000,retryConfig:{retries:0}}).users.info({user:identity.user});
  activeWorkspaceMember(result.user,identity.team,identity.user);
  for(const [id,expiry]of checked)if(expiry<now)checked.delete(id);
  checked.set(key,now+60000);
 }
}
export async function redeemWebLink(token:string):Promise<{session:Session;destination:string}>{
 requireThat(/^[A-Za-z0-9_-]{43}$/.test(token),'INVALID_FLOW','Slack에서 예약하기를 다시 눌러 주세요.',401);
 if(saasEnabled()&&!databaseContext.getStore()){const r=await controlPool().query('SELECT saas_control.web_link_route($1) tenant',[digest(token)]);requireThat(r.rows[0]?.tenant,'INVALID_FLOW','연결이 만료되었습니다.',401);return withTenant(r.rows[0].tenant,()=>redeemWebLink(token));}
 // DELETE RETURNING makes concurrent redemption and replay impossible.
 const link=(await pool().query('DELETE FROM slack_web_links WHERE token_hash=$1 AND expires_at>clock_timestamp() AND ready RETURNING *',[digest(token)])).rows[0];
 if(!link){const pending=(await pool().query('SELECT 1 FROM slack_web_links WHERE token_hash=$1 AND NOT ready AND expires_at>clock_timestamp()',[digest(token)])).rowCount;requireThat(!pending,'LINK_PENDING','Slack 클릭을 확인하고 있습니다.',202);}
 requireThat(link,'INVALID_FLOW','연결이 만료되었거나 사용됐습니다. Slack에서 다시 열어 주세요.',401);
 const session:Session={memberId:link.member_id,accessVersion:link.access_version,verifiedAt:link.destination==='/admin/reservations'?Date.now():0,sessionId:randomUUID(),expiresAt:Date.now()+8*3600000,slack:{team:link.team_id,user:link.user_id}};
 await verifySlackWebSession(session);
 if(link.destination.startsWith('/admin/'))requireThat((await pool().query("SELECT 1 FROM members WHERE id=$1 AND role='ADMIN' AND status='ACTIVE'",[session.memberId])).rowCount,'FORBIDDEN','관리자 권한이 필요합니다.',403);
 return {session,destination:webDestination(link.destination)};
}
