import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {installCookie,installState,verifyInstallState,startInstall,finishInstall} from '../src/slack/oauth';
import {decryptToken,encryptToken,workspaceAuthorization,revokeInstallation} from '../src/slack/installations';
const {query}=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../src/server/db',()=>({saasEnabled:()=>false,pool:()=>({query})}));
beforeEach(()=>{
 vi.stubEnv('APP_BASE_URL','https://booking.example.com');vi.stubEnv('SLACK_INSTALL_ENABLED','true');
 vi.stubEnv('SLACK_CLIENT_ID','123.456');vi.stubEnv('SLACK_CLIENT_SECRET','test-secret');vi.stubEnv('SLACK_APP_ID','ATEST');
 vi.stubEnv('SESSION_SECRET','test-state-secret-at-least-32-characters');vi.stubEnv('SLACK_TOKEN_ENCRYPTION_KEY','11'.repeat(32));
 vi.stubEnv('SLACK_WORKSPACE_ID','T1');vi.stubEnv('SLACK_ALLOWED_WORKSPACE_IDS','T2,T3');vi.stubEnv('SLACK_BOT_TOKEN','xoxb-legacy-test');query.mockReset();
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});
describe('workspace installation',()=>{
 it('requests only bot scope and binds target workspace with a secure cookie',async()=>{
  const res=await startInstall(new NextRequest('https://booking.example.com/api/slack/install?team=T2'));
  const url=new URL(res.headers.get('location')!);expect(url.searchParams.get('scope')).toBe('chat:write,users:read');expect(url.searchParams.has('user_scope')).toBe(false);
  const cookie=res.cookies.get(installCookie)!;expect(cookie.secure).toBe(true);expect(cookie.httpOnly).toBe(true);expect(verifyInstallState(url.searchParams.get('state')!,cookie.value).team).toBe('T2');
 });
 it('rejects unapproved teams and insecure callback hosts',async()=>{
  expect((await startInstall(new NextRequest('https://booking.example.com/api/slack/install?team=OTHER'))).status).toBe(403);
  vi.stubEnv('APP_BASE_URL','http://192.168.10.64:3002');expect(()=>installState('T2')).toThrow('HTTPS');
 });
 it('rejects tampered, cross-browser, expired and removed-workspace state',()=>{
  const state=installState('T2');expect(()=>verifyInstallState('x'+state,'x'+state)).toThrow();expect(()=>verifyInstallState(state,installState('T2'))).toThrow();
  vi.stubEnv('SLACK_ALLOWED_WORKSPACE_IDS','T3');expect(()=>verifyInstallState(state,state)).toThrow();
  vi.stubEnv('SLACK_ALLOWED_WORKSPACE_IDS','T2');vi.useFakeTimers();vi.setSystemTime(Date.now()+600001);expect(()=>verifyInstallState(state,state)).toThrow();
 });
 it('encrypts tokens with random IVs and binds ciphertext to its workspace',()=>{
  const a=encryptToken('xoxb-test','T2'),b=encryptToken('xoxb-test','T2');expect(a).not.toBe(b);expect(a).not.toContain('xoxb');expect(decryptToken(a,'T2')).toBe('xoxb-test');expect(()=>decryptToken(a,'T3')).toThrow();
  const parts=a.split('.');parts[1]='A'.repeat(22);expect(()=>decryptToken(parts.join('.'),'T2')).toThrow();
 });
 async function callback(overrides:Record<string,unknown>={}){
  const state=installState('T2');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({ok:true,app_id:'ATEST',token_type:'bot',access_token:'xoxb-new-test',bot_user_id:'UBOT',scope:'chat:write,users:read',team:{id:'T2',name:'Test'},...overrides})));
  query.mockResolvedValue({rows:[]});
  return finishInstall(new NextRequest('https://booking.example.com/api/slack/install/callback?code=test&state='+state,{headers:{cookie:installCookie+'='+state}}));
 }
 it('stores installation encrypted and returns to the installed app',async()=>{
  const res=await callback();expect(res.status).toBe(303);expect(res.headers.get('location')).toBe('https://slack.com/app_redirect?app=ATEST&team=T2');expect(res.cookies.get(installCookie)?.maxAge).toBe(0);
  const params=query.mock.calls[0][1];expect(params.slice(0,4)).toEqual(['T2','Test','ATEST','UBOT']);expect(params[4]).not.toContain('xoxb');expect(decryptToken(params[4],'T2')).toBe('xoxb-new-test');
 });
 it.each([{team:{id:'T3',name:'Wrong team'}},{app_id:'WRONG'},{is_enterprise_install:true},{expires_in:3600},{scope:''},{ok:false}])('does not save an invalid installation %j',async overrides=>{const res=await callback(overrides);expect(res.status).toBe(400);expect(query).not.toHaveBeenCalled();expect(res.cookies.get(installCookie)?.maxAge).toBe(0);});
 it('does not contact Slack for an unsolicited callback',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const res=await finishInstall(new NextRequest('https://booking.example.com/api/slack/install/callback?code=stolen'));expect(res.status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
 });
 it('routes each request to its own installation; never falls back for a different team or revoked install',async()=>{
  query.mockResolvedValueOnce({rows:[{bot_token_encrypted:encryptToken('xoxb-team2','T2'),bot_user_id:'U2',revoked_at:null}]});expect(await workspaceAuthorization('T2')).toMatchObject({teamId:'T2',botToken:'xoxb-team2',botUserId:'U2'});
  query.mockResolvedValue({rows:[]});await expect(workspaceAuthorization('T2')).rejects.toThrow();expect(await workspaceAuthorization('T1')).toMatchObject({botToken:'xoxb-legacy-test'});
  query.mockResolvedValue({rows:[{revoked_at:'2026-09-29'}]});await expect(workspaceAuthorization('T1')).rejects.toThrow();
  await revokeInstallation('T1');expect(query.mock.calls.at(-1)?.[0]).toContain('ON CONFLICT');
 });
});
