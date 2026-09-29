import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {cookieName,isLocal,seal} from './auth';
import {pool} from './db';
import {AppError,requireThat} from './errors';
import type {Member,Session} from '../shared/types';
import {allowedLocalHost} from './local-network';
import {allowedWorkspaces,assertWorkspace} from '../slack/workspaces';

export const slackCookie='booking-slack-flow';
const flowSchema=z.object({expires:z.number(),storage:z.record(z.string(),z.string()),team:z.string().optional(),returnToApp:z.boolean().optional()});
type Flow=z.infer<typeof flowSchema>;
function signature(value:string){
 const secret=process.env.SESSION_SECRET;
 requireThat(secret&&secret.length>=32,'CONFIGURATION','서버 인증 설정이 필요합니다.',503);
 return createHmac('sha256',secret).update('slack-flow:'+value).digest();
}
export function encodeFlow(flow:Flow){const value=Buffer.from(JSON.stringify(flow)).toString('base64url');return value+'.'+signature(value).toString('base64url');}
export function decodeFlow(cookie:string):Flow{
 requireThat(cookie.length<4000,'INVALID_FLOW','Slack 로그인을 다시 시작해 주세요.',401);
 const [value,mac,...rest]=cookie.split('.'),expected=signature(value??''),actual=Buffer.from(mac??'','base64url');
 requireThat(!rest.length&&actual.length===expected.length&&timingSafeEqual(actual,expected),'INVALID_FLOW','Slack 로그인을 다시 시작해 주세요.',401);
 const flow=flowSchema.parse(JSON.parse(Buffer.from(value,'base64url').toString()));
 requireThat(flow.expires>Date.now()&&flow.expires<=Date.now()+600000,'INVALID_FLOW','Slack 로그인 시간이 만료되었습니다.',401);
 return flow;
}
export function slackEnabled(){
 try{return process.env.SLACK_LOGIN_ENABLED==='true'&&!!process.env.SUPABASE_URL&&!!process.env.SUPABASE_ANON_KEY&&allowedWorkspaces().length>0&&!!process.env.DATABASE_URL&&!!process.env.SESSION_SECRET&&!!baseURL();}catch{return false;}
}
function baseURL(){
 const url=new URL(process.env.APP_BASE_URL??'');
 requireThat(url.protocol==='https:'||(isLocal()&&url.protocol==='http:'&&allowedLocalHost(url.hostname)),'CONFIGURATION','서비스 주소 설정이 필요합니다.',503);
 requireThat(!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,'CONFIGURATION','서비스 주소 설정이 필요합니다.',503);
 return url.origin;
}
function client(storage:Record<string,string>){
 return createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,{auth:{flowType:'pkce',storageKey:'booking-slack',autoRefreshToken:false,persistSession:true,detectSessionInUrl:false,storage:{getItem:key=>storage[key]??null,setItem:(key,value)=>{storage[key]=value;},removeItem:key=>{delete storage[key];}}},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}});
}
const options=()=>({httpOnly:true,sameSite:'lax' as const,secure:!isLocal(),path:'/api/auth/slack'});
export async function startSlack(team=process.env.SLACK_WORKSPACE_ID??'',returnToApp=false){
 requireThat(slackEnabled(),'CONFIGURATION','Slack 로그인 연결을 준비 중입니다.',503);
 assertWorkspace(team);
 const storage:Record<string,string>={},auth=client(storage);
 const {data,error}=await auth.auth.signInWithOAuth({provider:'slack_oidc',options:{redirectTo:baseURL()+'/api/auth/slack/callback',scopes:'openid profile email',skipBrowserRedirect:true,queryParams:{team}}});
 requireThat(!error&&data.url,'AUTH_FAILED','Slack 로그인을 시작할 수 없습니다.',503);
 const res=NextResponse.json({data:{url:data.url}},{headers:{'Cache-Control':'no-store'}});
 res.cookies.set(slackCookie,encodeFlow({expires:Date.now()+600000,storage,team,returnToApp}),{...options(),maxAge:600});return res;
}
export const slackIdentity=z.object({ok:z.literal(true),sub:z.string().min(1),email:z.email(),email_verified:z.literal(true),'https://slack.com/user_id':z.string().min(1),'https://slack.com/team_id':z.string().min(1)});
export function validateSlackMember(m:(Member&{slack_workspace_id:string|null})|undefined,authId:string,email:string,team:string,userId:string){
 assertWorkspace(team);
 requireThat(m&&(m.role==='STUDENT'||m.role==='ADMIN')&&m.status==='ACTIVE'&&m.auth_user_id===authId&&m.email?.toLowerCase()===email.toLowerCase(),'ACCOUNT_DENIED','등록된 활성 계정으로 로그인해 주세요.',403);
 requireThat((!m.slack_user_id&&!m.slack_workspace_id)||(m.slack_user_id===userId&&m.slack_workspace_id===team),'ACCOUNT_DENIED','연결된 Slack 계정이 다릅니다. 운영 담당자에게 문의해 주세요.',403);
 return m;
}
export async function finishSlack(req:NextRequest){
 let res:NextResponse;let stage="flow";
 try{
  requireThat(slackEnabled(),'CONFIGURATION','Slack 로그인 연결을 준비 중입니다.',503);
  const flow=decodeFlow(req.cookies.get(slackCookie)?.value??''),code=req.nextUrl.searchParams.get('code');
  requireThat(code&&!req.nextUrl.searchParams.has('error'),'INVALID_FLOW','Slack 인증이 취소되었거나 만료되었습니다.',401);
  stage="exchange";
  const auth=client(flow.storage),{data,error}=await auth.auth.exchangeCodeForSession(code);
  requireThat(!error&&data.session?.provider_token,'AUTH_FAILED','Slack 인증에 실패했습니다.',401);
  stage="supabase-user";
  const {data:verified,error:userError}=await auth.auth.getUser(data.session.access_token);
  requireThat(!userError&&verified.user,'AUTH_FAILED','인증 정보를 확인할 수 없습니다.',401);
  // Verify workspace/email directly with Slack, never with editable user_metadata.
  stage="slack-user";
  const reply=await fetch('https://slack.com/api/openid.connect.userInfo',{method:'POST',headers:{Authorization:'Bearer '+data.session.provider_token},cache:'no-store',signal:AbortSignal.timeout(10000)});
  requireThat(reply.ok,'AUTH_FAILED','Slack 인증 정보를 확인할 수 없습니다.',401);
  const identity=slackIdentity.parse(await reply.json()),team=identity['https://slack.com/team_id'],userId=identity['https://slack.com/user_id'];
  requireThat(identity.sub===userId,'AUTH_FAILED','Slack 인증 정보가 일치하지 않습니다.',401);
  stage="database";
  const db=await pool().connect();let session:Session;let destination="/schedule";
  try{
   await db.query('BEGIN');
   const row=(await db.query<Member&{slack_workspace_id:string|null}>('SELECT * FROM members WHERE auth_user_id=$1 FOR UPDATE',[verified.user.id])).rows[0];
   stage="member";
   const m=validateSlackMember(row,verified.user.id,identity.email,team,userId);
   requireThat(team===(flow.team??process.env.SLACK_WORKSPACE_ID),'WORKSPACE_DENIED','계정 연결을 시작한 워크스페이스로 로그인해 주세요.',403);
   await db.query('UPDATE members SET slack_workspace_id=$2,slack_user_id=$3 WHERE id=$1',[m.id,team,userId]);
   destination=m.role==='ADMIN'?'/admin/reservations':'/schedule';
   session={memberId:m.id,accessVersion:m.access_version,verifiedAt:0,expiresAt:Math.min((data.session.expires_at??0)*1000,Date.now()+8*3600000),sessionId:randomUUID(),accessToken:data.session.access_token};
   requireThat(session.expiresAt>Date.now(),'AUTH_FAILED','인증이 만료되었습니다.',401);
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  res=NextResponse.redirect(baseURL()+destination,303);
  if(flow.returnToApp&&process.env.SLACK_APP_ID){const target=new URL('https://slack.com/app_redirect');target.search=new URLSearchParams({app:process.env.SLACK_APP_ID,team}).toString();res=NextResponse.redirect(target,303);}
  res.cookies.set(cookieName,seal(session),{httpOnly:true,sameSite:'lax',secure:!isLocal(),path:'/',maxAge:Math.floor((session.expiresAt-Date.now())/1000)});
 }catch(error){
  console.warn("booking.slack.failed",{stage,code:error instanceof AppError?error.code:"FAILED"});
  // No provider errors, tokens or authorization codes in URLs/logs.
  res=NextResponse.redirect(new URL('/login?slack_error=1',process.env.APP_BASE_URL||req.url),303);
 }
 res.cookies.set(slackCookie,'',{...options(),maxAge:0});
 res.headers.set('Cache-Control','no-store');res.headers.set('Referrer-Policy','no-referrer');return res;
}
