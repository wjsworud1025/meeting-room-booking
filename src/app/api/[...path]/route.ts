import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {authenticate,assertLocalRequest,cookieName,isLocal,rateLimit,requestOTP,seal,verifyOTP} from '@/server/auth';
import {pool} from '@/server/db';
import {execute} from '@/server/commands';
import {adminData,snapshot,reservationDetail,memberConflicts} from '@/server/queries';
import {AppError,requireThat} from '@/server/errors';
import {localDate} from '@/shared/time';
import {holidayInfo} from '@/server/holidays';
import {slackEnabled,startSlack} from '@/server/slack-auth';
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
  if(path==='auth/slack/start'){rateLimit('slack:'+req.headers.get('x-forwarded-for'),30);const v=z.object({team:z.string().min(1).max(64).optional(),returnToApp:z.boolean().optional()}).strict().parse(body);return await startSlack(v.team,v.returnToApp);}
  if(path==='auth/otp/request'){
   rateLimit('ip:'+req.headers.get('x-forwarded-for'),30);const v=z.object({email}).strict().parse(body);await requestOTP(v.email);return response({message:'등록된 이메일이라면 인증 코드를 보냈습니다.'});
  }
  if(path==='auth/otp/verify'){
   const v=z.object({email,code:z.string().regex(/^\d{6,8}$/)}).strict().parse(body),session=await verifyOTP(v.email,v.code);const m=(await pool().query('SELECT role,status FROM members WHERE id=$1',[session.memberId])).rows[0];const res=response({role:m.role,status:m.status});res.cookies.set(cookieName,seal(session),{httpOnly:true,sameSite:'lax',secure:!isLocal(),path:'/',maxAge:Math.floor((session.expiresAt-Date.now())/1000)});return res;
  }
  if(path==='auth/logout'){const res=response({ok:true});res.cookies.delete(cookieName);return res;}
  if(path==='member-conflicts'){
   const v=z.object({ids:z.array(z.uuid()).min(1).max(100),start:z.iso.datetime(),end:z.iso.datetime()}).strict().parse(body);
   requireThat(new Date(v.end)>new Date(v.start)&&new Date(v.end).getTime()-new Date(v.start).getTime()<=86400000,'INVALID_INPUT','확인할 시간을 선택해 주세요.',422);
   const {session}=await authenticate(req);return response(await memberConflicts(session,v.ids,v.start,v.end));
  }
  if(path==='commands'){
   const v=z.object({name:z.string().max(80),input:z.unknown()}).strict().parse(body),{session}=await authenticate(req,v.name==='onboarding.accept');
   const result=await execute(session,v.name,v.input,req.headers.get('idempotency-key')??'');const res=NextResponse.json(result,{status:result.status,headers:{'Cache-Control':'no-store'}});
   if(v.name==='onboarding.accept'&&!result.error){const m=(await pool().query('SELECT access_version FROM members WHERE id=$1',[session.memberId])).rows[0];res.cookies.set(cookieName,seal({...session,accessVersion:m.access_version}),{httpOnly:true,sameSite:'lax',secure:!isLocal(),path:'/',maxAge:Math.floor((session.expiresAt-Date.now())/1000)});}return res;
  }
 }else{
  if(path==='health'){await pool().query('SELECT 1');return response({ok:true});}
  if(path==='config')return response({local:isLocal(),slack:slackEnabled()});
  if(path==='dev/mailbox'){assertLocalRequest(req);const rows=await pool().query('SELECT * FROM local_auth.mailbox ORDER BY created_at DESC LIMIT 100');return response(rows.rows);}
  const {session,me}=await authenticate(req,path==='me'||path==='admin/onboarding');
  if(path==='me')return response({id:me.id,display_name:me.display_name,email:me.email,role:me.role,status:me.status,local:isLocal()});
  if(path==='admin/onboarding')return response({id:me.id,email:me.email,name:me.display_name,invitationId:me.admin_invite_id,expiresAt:me.invite_expires_at,accepted:!!me.invite_accepted_at,revoked:!!me.invite_revoked_at});
  if(path==='snapshot'){const date=z.iso.date().parse(req.nextUrl.searchParams.get('date')??localDate());return response(await snapshot(session,date));}
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
export const GET=(req:NextRequest)=>handle(req,'GET');export const POST=(req:NextRequest)=>handle(req,'POST');
