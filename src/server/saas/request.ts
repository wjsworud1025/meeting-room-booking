import {cookieName,unseal} from '../auth';
import {inWorkspace} from './slack-routing';
import type {NextRequest} from 'next/server';
import {NextResponse} from 'next/server';
import {accountCookie,accountSession} from '../login-accounts';
import {AppError,requireThat} from '../errors';
import {saasEnabled,basePool,controlPool} from '../db';
import {tenantForAccount,withTenant} from './runtime';
const publicPaths=new Set(['config','health','auth/account/login','auth/account/register','auth/account/me','auth/account/password','auth/account/space','auth/logout','auth/account/space-info','auth/account/space-action','auth/account/export-download']);
export async function scopedRequest(req:NextRequest,handle:()=>Promise<NextResponse>){
 if(!saasEnabled())return handle();
 try{
  const path=req.nextUrl.pathname.replace(/^\/api\//,'');
  if(path==='health'){await basePool().query('SELECT 1');return NextResponse.json({data:{ok:true}},{headers:{'Cache-Control':'no-store'}});}
  const role=await controlPool().query("SELECT rolsuper OR rolbypassrls OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='booking' AND c.relname='members' AND has_table_privilege(current_user,c.oid,'SELECT')) unsafe FROM pg_roles WHERE rolname=current_user");
  requireThat(role.rows[0]?.unsafe===false,'UNSAFE_CONTROL_ROLE','SaaS 인증 DB 역할 설정이 필요합니다.',503);
  if(publicPaths.has(path))return handle();
  // Legacy email/Slack entry paths remain closed until their own verified routing is converted.
  requireThat(!path.startsWith('auth/'),'SAAS_AUTH_UNAVAILABLE','현재는 아이디로 로그인해 주세요.',403);
  if(!req.cookies.get(accountCookie)?.value){const value=req.cookies.get(cookieName)?.value;requireThat(value,'UNAUTHENTICATED','로그인이 필요합니다.',401);const session=unseal(value);requireThat(session.slack,'UNAUTHENTICATED','Slack에서 다시 접속해 주세요.',401);return await inWorkspace(session.slack.team,handle);}
  const a=await accountSession(req.cookies.get(accountCookie)?.value);
  requireThat(!a.must_change_password,'PASSWORD_CHANGE_REQUIRED','비밀번호를 먼저 변경해 주세요.',403);
  const route=await tenantForAccount(a.id);
  return await withTenant(route.tenant_id,handle);
 }catch(e){const error=e instanceof AppError?e:new AppError('SERVICE_UNAVAILABLE','처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',503);return NextResponse.json({error:{code:error.code,message:error.message}},{status:error.status,headers:{'Cache-Control':'no-store'}});}
}
