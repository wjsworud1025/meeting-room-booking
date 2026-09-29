import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {decodeFlow,encodeFlow,finishSlack,slackCookie,slackEnabled,startSlack,validateSlackMember} from '../src/server/slack-auth';
import {unseal,cookieName} from '../src/server/auth';
import {admin} from '../src/server/store';
import type {Member} from '../src/shared/types';

const db=vi.hoisted(()=>({query:vi.fn(),release:vi.fn()}));
vi.mock('../src/server/db',()=>({pool:()=>({connect:async()=>db})}));
const member={id:'member-1',auth_user_id:'auth-1',email:'student@example.com',role:'STUDENT',status:'ACTIVE',access_version:3,slack_user_id:null,slack_workspace_id:null} as Member&{slack_workspace_id:string|null};
beforeEach(()=>{
 vi.stubEnv('SESSION_SECRET','test-secret-with-at-least-32-characters');vi.stubEnv('APP_ENV','production');
 vi.stubEnv('APP_BASE_URL','https://booking.example.com');vi.stubEnv('SUPABASE_URL','https://project.supabase.co');
 vi.stubEnv('SUPABASE_ANON_KEY','test-anon-key');vi.stubEnv('DATABASE_URL','postgres://unused');vi.stubEnv('SLACK_WORKSPACE_ID','T_ALLOWED');vi.stubEnv('SLACK_LOGIN_ENABLED','true');
 db.query.mockReset();db.release.mockReset();
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('Slack flow binding',()=>{
 it('creates PKCE redirect and a short lived HttpOnly cookie',async()=>{
  const r=await startSlack(),url=new URL((await r.json()).data.url),c=r.cookies.get(slackCookie)!;
  expect(url.searchParams.get('provider')).toBe('slack_oidc');expect(url.searchParams.get('code_challenge')).toBeTruthy();expect(url.searchParams.get('code_challenge_method')).toBe('s256');
  expect(url.searchParams.get('redirect_to')).toBe('https://booking.example.com/api/auth/slack/callback');
  expect(c.httpOnly).toBe(true);expect(c.secure).toBe(true);expect(c.sameSite).toBe('lax');expect(c.maxAge).toBe(600);
  expect(Object.keys(decodeFlow(c.value).storage).some(k=>k.endsWith('code-verifier'))).toBe(true);
 });
 it('rejects tampered flow cookie',()=>{const c=encodeFlow({expires:Date.now()+30000,storage:{}});expect(()=>decodeFlow('x'+c)).toThrow();});
 it('rejects expired flow cookie',()=>expect(()=>decodeFlow(encodeFlow({expires:Date.now()-1,storage:{}}))).toThrow());
 it('fails closed when settings are missing or production uses HTTP',()=>{vi.stubEnv('APP_BASE_URL','http://booking.example.com');expect(slackEnabled()).toBe(false);});
 it('does not call providers for a callback without a flow cookie',async()=>{
  const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);const r=await finishSlack(new NextRequest('https://booking.example.com/api/auth/slack/callback?code=stolen'));
  expect(r.headers.get('location')).toBe('https://booking.example.com/login?slack_error=1');expect(fetchMock).not.toHaveBeenCalled();expect(r.cookies.get(slackCookie)?.maxAge).toBe(0);expect(r.cookies.get(cookieName)).toBeUndefined();
 });
});
describe('Slack account authorization',()=>{
 it('accepts an existing active student',()=>expect(validateSlackMember(member,'auth-1','student@example.com','T_ALLOWED','U1')).toBe(member));
 it.each([
  ['wrong workspace',member,'auth-1','student@example.com','T_OTHER','U1'],
  ['unregistered',undefined,'auth-1','student@example.com','T_ALLOWED','U1'],
  ['inactive administrator',{...member,role:'ADMIN',status:'INACTIVE'},'auth-1','student@example.com','T_ALLOWED','U1'],
  ['inactive',{...member,status:'INACTIVE'},'auth-1','student@example.com','T_ALLOWED','U1'],
  ['different auth identity',member,'auth-other','student@example.com','T_ALLOWED','U1'],
  ['different email',member,'auth-1','other@example.com','T_ALLOWED','U1'],
  ['previous binding',{...member,slack_user_id:'U2',slack_workspace_id:'T_ALLOWED'},'auth-1','student@example.com','T_ALLOWED','U1'],
 ] as const)('rejects %s',(_name,m,id,email,team,user)=>expect(()=>validateSlackMember(m as typeof member,id,email,team,user)).toThrow());
});
describe('Slack callback with provider and database boundaries',()=>{
 async function callback(team='T_ALLOWED',verified=true,role:'ADMIN'|'STUDENT'='STUDENT'){
  const start=await startSlack(),cookie=start.cookies.get(slackCookie)!;
  const user={id:'auth-1',aud:'authenticated',role:'authenticated',email:'student@example.com',app_metadata:{},user_metadata:{'https://slack.com/team_id':'T_ALLOWED'},created_at:new Date().toISOString()};
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
   const url=String(input);
   if(url.includes('/token'))return Response.json({access_token:'test-access',refresh_token:'test-refresh',provider_token:'test-provider',expires_in:3600,token_type:'bearer',user});
   if(url.endsWith('/user'))return Response.json(user);
   if(url==='https://slack.com/api/openid.connect.userInfo')return Response.json({ok:true,sub:'U1',email:'student@example.com',email_verified:verified,'https://slack.com/team_id':team,'https://slack.com/user_id':'U1'});
   throw new Error('unexpected provider request');
  }));
  db.query.mockImplementation(async(sql:string)=>({rows:sql.startsWith('SELECT')?[{...member,role}]:[]}));
  return finishSlack(new NextRequest('https://booking.example.com/api/auth/slack/callback?code=test-code',{headers:{cookie:slackCookie+'='+cookie.value}}));
 }
 it('issues existing app session after provider verification and DB commit',async()=>{
  const res=await callback();expect(res.headers.get('location')).toBe('https://booking.example.com/schedule');
  const session=unseal(res.cookies.get(cookieName)!.value);expect(session.memberId).toBe('member-1');expect(session.verifiedAt).toBe(0);expect(session.accessToken).toBe('test-access');
  expect(db.query).toHaveBeenCalledWith('COMMIT');expect(res.cookies.get(slackCookie)?.maxAge).toBe(0);
 });
 it('routes existing admin to admin UI but requires email reauthentication for sensitive work',async()=>{const res=await callback('T_ALLOWED',true,'ADMIN');expect(res.headers.get('location')).toBe('https://booking.example.com/admin/reservations');const session=unseal(res.cookies.get(cookieName)!.value);expect(()=>admin({...member,role:'ADMIN'},session,new Date(),false)).not.toThrow();expect(()=>admin({...member,role:'ADMIN'},session,new Date(),true)).toThrow('이메일 코드로 다시 인증');});
 it('ignores editable user metadata when Slack returns another workspace',async()=>{const res=await callback('T_OTHER');expect(res.cookies.get(cookieName)).toBeUndefined();expect(db.query).toHaveBeenCalledWith('ROLLBACK');});
 it('rejects unverified email before touching the database',async()=>{const res=await callback('T_ALLOWED',false);expect(res.cookies.get(cookieName)).toBeUndefined();expect(db.query).not.toHaveBeenCalled();});
});
