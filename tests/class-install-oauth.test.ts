import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {startInstall,finishInstall,installCookie} from '../src/slack/oauth';
const {read,connect,save}=vi.hoisted(()=>({read:vi.fn(),connect:vi.fn(),save:vi.fn()}));
vi.mock('../src/server/class-install',()=>({readInstallRequest:read,connectInstallRequest:connect}));
vi.mock('../src/slack/installations',()=>({saveInstallation:save}));
beforeEach(()=>{vi.stubEnv('APP_BASE_URL','https://booking.example.com');vi.stubEnv('SLACK_INSTALL_ENABLED','true');vi.stubEnv('SLACK_CLIENT_ID','1.2');vi.stubEnv('SLACK_CLIENT_SECRET','secret');vi.stubEnv('SLACK_APP_ID','ATEST');vi.stubEnv('SLACK_TOKEN_ENCRYPTION_KEY','11'.repeat(32));vi.stubEnv('SESSION_SECRET','s'.repeat(40));read.mockReset().mockResolvedValue({name:'Class'});connect.mockReset().mockResolvedValue(undefined);save.mockReset();});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('invitation OAuth binds cookie to request and connects a newly authorized workspace without environment allowlisting',async()=>{
 const token='a'.repeat(43),start=await startInstall(new NextRequest('https://booking.example.com/api/slack/install?invite='+token));expect(start.status).toBe(303);expect(read).toHaveBeenCalledWith(token);
 const state=new URL(start.headers.get('location')!).searchParams.get('state')!;
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({ok:true,app_id:'ATEST',token_type:'bot',access_token:'xoxb-fake',bot_user_id:'UBOT',scope:'chat:write,users:read',team:{id:'TNEW',name:'New'}})));
 const result=await finishInstall(new NextRequest('https://booking.example.com/api/slack/install/callback?code=fake&state='+state,{headers:{cookie:installCookie+'='+state}}));expect(result.status).toBe(303);expect(connect).toHaveBeenCalledWith(token,expect.objectContaining({team:'TNEW'}));expect(save).not.toHaveBeenCalled();expect(result.cookies.get(installCookie)?.maxAge).toBe(0);
});
it('invalid invitation never redirects to Slack',async()=>{read.mockRejectedValue(new Error('expired'));const r=await startInstall(new NextRequest('https://booking.example.com/api/slack/install?invite=bad'));expect(r.status).toBe(400);expect(r.headers.get('location')).toBeNull();});
