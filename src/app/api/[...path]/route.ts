import {spaceInfo,spaceAction,downloadExport} from '@/server/saas/lifecycle';
import {scopedRequest} from '@/server/saas/request';
import {controlPool,saasEnabled} from '@/server/db';
import {defaultRules} from '@/server/policy';
import {accountCookie,accountSession,registerAccount,loginAccount,changePassword,logoutAccount} from '@/server/login-accounts';
import {adminCandidates} from '@/server/slack-admin';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {authenticate,assertLocalRequest,cookieName,isLocal,rateLimit,requestOTP,seal,verifyOTP} from '@/server/auth';
import {pool} from '@/server/db';
import {execute} from '@/server/commands';
import {adminReservationRange,adminData,snapshot,reservationDetail,memberConflicts} from '@/server/queries';
import {AppError,requireThat} from '@/server/errors';
import {localDate} from '@/shared/time';
import {holidayInfo} from '@/server/holidays';
import {slackEnabled,startSlack} from '@/server/slack-auth';
import {searchMembers,resolveSlackMember} from '@/server/member-search';
export const runtime='nodejs';export const dynamic='force-dynamic';
const email=z.string().trim().toLowerCase().email().max(254);
function response(data:unknown,status=200){return NextResponse.json({data,serverTime:new Date().toISOString(),requestId:randomUUID()},{status,headers:{'Cache-Control':'no-store'}});}
async function handle(req:NextRequest,method:string){try{
 const path=new URL(req.url).pathname.replace(/^\/api\//,'');
 if(method==='POST'){
  const origin=req.headers.get('origin');const allowed=new URL(process.env.APP_BASE_URL??req.url).origin;
  requireThat(origin&&(origin===allowed||(isLocal()&&['http://localhost:3000','http://127.0.0.1:3000'].includes(origin))),'CSRF','요청 출처를 확인할 수 없습니다.',403);
  requireThat((req.headers.get('content-type')??'').startsWith('application/json'),'INVALID_INPUT','JSON 요청이 필요합니다.',415);
  const raw=await req.text();requireThat(raw.length<=100000,'INVALID_INPUT','요청 크기가 너무 큽니다.',413);const body=JSON.parse(raw);
  if(path==='auth/account/space-action'||path==='auth/account/export-download'){
   requireThat(saasEnabled(),'SAAS_NOT_READY','운영 공간 기능을 준비 중입니다.',503);rateLimit('space-action:'+req.headers.get('x-forwarded-for'),20);
   const v=z.object({password:z.string().min(1).max(128),action:z.enum(['export.create','transfer.create','transfer.cancel','transfer.accept','delete.request','delete.cancel']).optional(),id:z.uuid().optional(),loginId:z.string().regex(/^[a-z0-9_]{4,32}$/).optional(),name:z.string().min(1).max(80).optional()}).strict().parse(body);
   const token=req.cookies.get(accountCookie)?.value;
   if(path.endsWith('export-download')){requireThat(v.id,'INVALID_INPUT','파일을 선택해 주세요.',422);const bytes=await downloadExport(token,v.password,v.id);return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="booking-${v.id}.zip"`,'Cache-Control':'no-store'}});}
   requireThat(v.action,'INVALID_INPUT','작업을 선택해 주세요.',422);
   if(['export.create','transfer.create','transfer.cancel','transfer.accept'].includes(v.action))requireThat(v.id,'INVALID_INPUT','요청 식별자가 필요합니다.',422);
   if(v.action==='transfer.create')requireThat(v.loginId,'INVALID_INPUT','대상 아이디를 입력해 주세요.',422);
   if(v.action==='delete.request')requireThat(v.name,'INVALID_INPUT','공간 이름을 입력해 주세요.',422);
   return response(await spaceAction(token,v.password,v.action,{...(v.id?{id:v.id}:{}),...(v.loginId?{loginId:v.loginId}:{}),...(v.name?{name:v.name}:{})}));
  }
  if(path.startsWith('auth/account/')){
   rateLimit('account-ip:'+req.headers.get('x-forwarded-for'),30);
   const credentials=z.object({loginId:z.string().min(4).max(32),password:z.string().min(1).max(128),remember:z.boolean().optional()}).strict();
   if(path==='auth/account/space'){requireThat(process.env.SAAS_RELEASE_MODE!=='pilot','REGISTRATION_PAUSED','신규 운영 공간은 준비 중입니다.',503);requireThat(saasEnabled(),'SAAS_NOT_READY','독립 운영 공간을 준비 중입니다.',503);const a=await accountSession(req.cookies.get(accountCookie)?.value);requireThat(!a.must_change_password,'PASSWORD_CHANGE_REQUIRED','비밀번호를 먼저 변경해 주세요.',403);const v=z.object({name:z.string().trim().min(1).max(80)}).strict().parse(body);await controlPool().query('SELECT saas_control.create_space($1,$2,$3)',[a.id,v.name,JSON.stringify(defaultRules)]);return response({created:true});}
   if(path==='auth/account/register'){const v=credentials.parse(body);rateLimit('account-register:'+req.headers.get('x-forwarded-for'),5);await registerAccount(v.loginId,v.password);return response({created:true},201);}
   if(path==='auth/account/login'){const v=credentials.parse(body);const r=await loginAccount(v.loginId,v.password,v.remember);const res=response({mustChange:r.mustChange,status:r.status});res.cookies.delete(cookieName);res.cookies.set(accountCookie,r.token,{httpOnly:true,sameSite:'lax',secure:!isLocal(),path:'/',maxAge:r.seconds});return res;}
   if(path==='auth/account/password'){const v=z.object({current:z.string().min(1).max(128),next:z.string().min(10).max(128)}).strict().parse(body);await changePassword(req.cookies.get(accountCookie)?.value??'',v.current,v.next);const res=response({changed:true});res.cookies.delete(accountCookie);res.cookies.delete(cookieName);return res;}
  }
  if(path==='auth/slack/start'){rateLimit('slack:'+req.headers.get('x-forwarded-for'),30);const v=z.object({team:z.string().min(1).max(64).optional(),returnToApp:z.boolean().optional(),admin:z.boolean().optional()}).strict().parse(body);const res=await startSlack(v.team,v.returnToApp,v.admin);await logoutAccount(req.cookies.get(accountCookie)?.value);res.cookies.delete(accountCookie);return res;}
  if(path==='auth/otp/request'){
   rateLimit('ip:'+req.headers.get('x-forwarded-for'),30);const v=z.object({email}).strict().parse(body);await requestOTP(v.email);return response({message:'등록된 이메일이라면 인증 코드를 보냈습니다.'});
  }
  if(path==='auth/otp/verify'){
   const v=z.object({email,code:z.string().regex(/^\d{6,8}$/)}).strict().parse(body),session=await verifyOTP(v.email,v.code);const m=(await pool().query('SELECT role,status FROM members WHERE id=$1',[session.memberId])).rows[0];const res=response({role:m.role,status:m.status});await logoutAccount(req.cookies.get(accountCookie)?.value);res.cookies.delete(accountCookie);res.cookies.set(cookieName,seal(session),{httpOnly:true,sameSite:'lax',secure:!isLocal(),path:'/',maxAge:Math.floor((session.expiresAt-Date.now())/1000)});return res;
  }
  if(path==='auth/logout'){await logoutAccount(req.cookies.get(accountCookie)?.value);const res=response({ok:true});res.cookies.delete(cookieName);res.cookies.delete(accountCookie);return res;}
  if(path==='member-conflicts'){
   const v=z.object({ids:z.array(z.uuid()).min(1).max(100),start:z.iso.datetime(),end:z.iso.datetime()}).strict().parse(body);
   requireThat(new Date(v.end)>new Date(v.start)&&new Date(v.end).getTime()-new Date(v.start).getTime()<=86400000,'INVALID_INPUT','확인할 시간을 선택해 주세요.',422);
   const {session}=await authenticate(req);return response(await memberConflicts(session,v.ids,v.start,v.end));
  }
  if(path==='members/resolve'){
   const {session,me}=await authenticate(req);requireThat(me.role==='STUDENT','FORBIDDEN','학생만 이용할 수 있습니다.',403);rateLimit('member-resolve:'+session.memberId,60);
   const v=z.object({slackId:z.string().regex(/^[UW][A-Z0-9]{5,30}$/)}).strict().parse(body);return response(await resolveSlackMember(session,v.slackId));
  }
  if(path==='commands'){
   const v=z.object({name:z.string().max(80),input:z.unknown()}).strict().parse(body),{session}=await authenticate(req,v.name==='onboarding.accept');
   const result=await execute(session,v.name,v.input,req.headers.get('idempotency-key')??'');const res=NextResponse.json(result,{status:result.status,headers:{'Cache-Control':'no-store'}});
   if(v.name==='onboarding.accept'&&!result.error){const m=(await pool().query('SELECT access_version FROM members WHERE id=$1',[session.memberId])).rows[0];res.cookies.set(cookieName,seal({...session,accessVersion:m.access_version}),{httpOnly:true,sameSite:'lax',secure:!isLocal(),path:'/',maxAge:Math.floor((session.expiresAt-Date.now())/1000)});}return res;
  }
 }else{
  if(path==='auth/account/space-info'){requireThat(saasEnabled(),'SAAS_NOT_READY','운영 공간 기능을 준비 중입니다.',503);return response(await spaceInfo(req.cookies.get(accountCookie)?.value));}
  if(path==='auth/account/me'){const a=await accountSession(req.cookies.get(accountCookie)?.value);return response({loginId:a.login_id,status:a.status,mustChange:a.must_change_password});}
  if(path==='health'){await pool().query('SELECT 1');return response({ok:true});}
  if(path==='config')return response({local:isLocal(),slack:!saasEnabled()&&slackEnabled(),saas:saasEnabled(),pilot:process.env.SAAS_RELEASE_MODE==='pilot'});
  if(path==='dev/mailbox'){assertLocalRequest(req);const rows=await pool().query('SELECT * FROM local_auth.mailbox ORDER BY created_at DESC LIMIT 100');return response(rows.rows);}
  const {session,me}=await authenticate(req,path==='me'||path==='admin/onboarding');
  if(path==='admin/slack-candidates')return response(await adminCandidates(session,z.string().min(1).max(64).parse(req.nextUrl.searchParams.get('team')),z.string().max(100).parse(req.nextUrl.searchParams.get('q')??'')));
  if(path==='members/search'){requireThat(me.role==='STUDENT','FORBIDDEN','학생만 이용할 수 있습니다.',403);rateLimit('member-search:'+session.memberId,200);return response(await searchMembers(session,z.string().max(100).parse(req.nextUrl.searchParams.get('q')??'')));}
  if(path==='me')return response({id:me.id,display_name:me.display_name,email:me.email,role:me.role,status:me.status,local:isLocal()});
  if(path==='admin/onboarding')return response({id:me.id,email:me.email,name:me.display_name,invitationId:me.admin_invite_id,expiresAt:me.invite_expires_at,accepted:!!me.invite_accepted_at,revoked:!!me.invite_revoked_at});
  if(path==='snapshot'){const date=z.iso.date().parse(req.nextUrl.searchParams.get('date')??localDate());return response(await snapshot(session,date));}
  if(path==='admin/reservations'){const from=z.iso.date().parse(req.nextUrl.searchParams.get('from')),to=z.iso.date().parse(req.nextUrl.searchParams.get('to'));return response(await adminReservationRange(session,from,to));}
  if(path==='admin/data')return response(await adminData(session,z.enum(['all','reservations','accounts','students','settings','reports','history']).parse(req.nextUrl.searchParams.get('section')??'all')));
  if(path==='holidays'||path==='admin/holidays'){
   if(path==='admin/holidays')requireThat(me.role==='ADMIN','FORBIDDEN','관리자만 확인할 수 있습니다.',403);
   const year=z.coerce.number().int().min(2000).max(2100).parse(req.nextUrl.searchParams.get('year')??localDate().slice(0,4));return response(await holidayInfo(year,path==='admin/holidays'));
  }
  if(path.startsWith('reservations/'))return response(await reservationDetail(session,z.uuid().parse(path.slice('reservations/'.length))));
  if(path==='my/reports')return response((await pool().query('SELECT id,type,detail,status,resolution,created_at FROM reports WHERE reporter_id=$1 ORDER BY created_at DESC',[me.id])).rows);
 }
 return response({message:'찾을 수 없습니다.'},404);
 }catch(e){const error=e instanceof AppError?e:e instanceof z.ZodError||e instanceof SyntaxError?new AppError('INVALID_INPUT','입력 형식을 확인해 주세요.',422):new AppError('SERVICE_UNAVAILABLE','처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',503);if(error.status===503)console.error('booking.api:',e instanceof Error?e.name:'unknown');return NextResponse.json({error:{code:error.code,message:error.message},serverTime:new Date().toISOString(),requestId:randomUUID()},{status:error.status,headers:{'Cache-Control':'no-store'}});}}
export const GET=(req:NextRequest)=>scopedRequest(req,()=>handle(req,'GET'));export const POST=(req:NextRequest)=>scopedRequest(req,()=>handle(req,'POST'));
