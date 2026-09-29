import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {requireThat,AppError} from '../server/errors';
import {assertWorkspace} from './workspaces';
import {saveInstallation} from './installations';

export const installCookie='booking-slack-install';
const stateSchema=z.object({team:z.string().min(1),expires:z.number(),nonce:z.string().length(32)});
function settings(){
 const base=new URL(process.env.APP_BASE_URL??'http://invalid');
 requireThat(process.env.SLACK_INSTALL_ENABLED==='true'&&base.protocol==='https:'&&!base.username&&!base.password&&base.pathname==='/'&&!base.search&&!base.hash&&!!process.env.SLACK_CLIENT_ID&&!!process.env.SLACK_CLIENT_SECRET&&!!process.env.SLACK_APP_ID&&/^[a-f0-9]{64}$/i.test(process.env.SLACK_TOKEN_ENCRYPTION_KEY??'')&&(process.env.SESSION_SECRET?.length??0)>=32,'CONFIGURATION','HTTPS 주소와 Slack 설치 설정이 필요합니다.',503);
 return {redirect:base.origin+'/api/slack/install/callback',client:process.env.SLACK_CLIENT_ID!,secret:process.env.SLACK_CLIENT_SECRET!};
}
function sign(value:string){return createHmac('sha256',process.env.SESSION_SECRET!).update('slack-install:'+value).digest();}
export function installState(team:string){
 settings();assertWorkspace(team);
 const value=Buffer.from(JSON.stringify({team,expires:Date.now()+600000,nonce:randomBytes(16).toString('hex')})).toString('base64url');
 return value+'.'+sign(value).toString('base64url');
}
export function verifyInstallState(value:string,cookie:string){
 settings();requireThat(value.length<2048&&value===cookie,'INVALID_FLOW','설치를 다시 시작해 주세요.',400);
 const [data,mac,...rest]=value.split('.'),actual=Buffer.from(mac??'','base64url'),expected=sign(data??'');
 requireThat(!rest.length&&actual.length===expected.length&&timingSafeEqual(actual,expected),'INVALID_FLOW','설치를 다시 시작해 주세요.',400);
 const state=stateSchema.parse(JSON.parse(Buffer.from(data,'base64url').toString('utf8')));
 requireThat(state.expires>Date.now()&&state.expires<=Date.now()+600000,'INVALID_FLOW','설치 요청이 만료되었습니다.',400);assertWorkspace(state.team);return state;
}
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
const cookieOptions={httpOnly:true,secure:true,sameSite:'lax' as const,path:'/api/slack/install'};
function failure(error:unknown){return NextResponse.json({error:error instanceof AppError?error.message:'설치하지 못했습니다. 설치 링크에서 다시 시도해 주세요.'},{status:error instanceof AppError?error.status:400,headers});}
export function startInstall(req:NextRequest){
 try{
  const cfg=settings(),team=req.nextUrl.searchParams.get('team')??'',state=installState(team);
  const url=new URL('https://slack.com/oauth/v2/authorize');
  url.search=new URLSearchParams({client_id:cfg.client,scope:'chat:write',redirect_uri:cfg.redirect,state,team}).toString();
  const res=NextResponse.redirect(url,303);res.cookies.set(installCookie,state,{...cookieOptions,maxAge:600});Object.entries(headers).forEach(([k,v])=>res.headers.set(k,v));return res;
 }catch(e){return failure(e);}
}
const installed=z.object({ok:z.literal(true),app_id:z.string(),token_type:z.literal('bot'),access_token:z.string().startsWith('xoxb-'),bot_user_id:z.string().min(1),scope:z.string(),team:z.object({id:z.string(),name:z.string()}),is_enterprise_install:z.boolean().optional(),expires_in:z.number().optional()});
export async function finishInstall(req:NextRequest){
 let res:NextResponse;
 try{
  const cfg=settings(),state=verifyInstallState(req.nextUrl.searchParams.get('state')??'',req.cookies.get(installCookie)?.value??'');
  const code=req.nextUrl.searchParams.get('code');requireThat(!!code&&!req.nextUrl.searchParams.has('error'),'INVALID_FLOW','앱 설치가 취소되었습니다.',400);
  const reply=await fetch('https://slack.com/api/oauth.v2.access',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cfg.client,client_secret:cfg.secret,code,redirect_uri:cfg.redirect}),signal:AbortSignal.timeout(10000),cache:'no-store'});
  requireThat(reply.ok,'INSTALL_FAILED','Slack 설치 응답을 확인해 주세요.',502);
  const data=installed.parse(await reply.json());
  requireThat(data.team.id===state.team&&data.app_id===process.env.SLACK_APP_ID&&!data.is_enterprise_install&&!data.expires_in&&data.scope.split(',').includes('chat:write'),'INSTALL_FAILED','선택한 워크스페이스와 앱 설정을 확인해 주세요.',400);
  await saveInstallation({team:data.team.id,name:data.team.name,appId:data.app_id,botUserId:data.bot_user_id,token:data.access_token});
  const url=new URL('https://slack.com/app_redirect');url.search=new URLSearchParams({app:data.app_id,team:data.team.id}).toString();
  res=NextResponse.redirect(url,303);Object.entries(headers).forEach(([k,v])=>res.headers.set(k,v));
 }catch(e){res=failure(e);}
 res.cookies.set(installCookie,'',{...cookieOptions,maxAge:0});return res;
}
