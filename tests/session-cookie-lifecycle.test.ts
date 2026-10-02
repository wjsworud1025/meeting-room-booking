import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const m=vi.hoisted(()=>({logout:vi.fn(),login:vi.fn(),redeem:vi.fn()}));
vi.mock('../src/server/login-accounts',()=>({accountCookie:'booking-account',loginAccount:m.login,logoutAccount:m.logout}));
vi.mock('../src/server/saas/request',()=>({scopedRequest:async(_r:NextRequest,fn:()=>Promise<Response>)=>fn()}));
vi.mock('../src/server/slack-web',()=>({redeemWebLink:m.redeem,slackWebBase:()=> 'https://booking.test'}));
import {POST} from '../src/app/api/[...path]/route';
import {POST as slackLogin} from '../src/app/api/auth/slack-web/route';
function request(path:string,context:string,body:unknown){return new NextRequest('https://booking.test/api/'+path,{method:'POST',headers:{origin:'https://booking.test','content-type':'application/json','x-booking-context':context,cookie:'booking-account=admin-token; booking-session=student-token'},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('APP_BASE_URL','https://booking.test');vi.stubEnv('SESSION_SECRET','test-secret-with-at-least-32-characters');m.login.mockResolvedValue({token:'new-admin',seconds:3600,status:'ACTIVE',mustChange:false});m.redeem.mockResolvedValue({session:{memberId:'student',expiresAt:Date.now()+60000},destination:'/schedule'});});
it('admin login preserves the learner cookie',async()=>{const r=await POST(request('auth/account/login','admin',{loginId:'test_admin',password:'test'}));expect(r.status).toBe(200);expect(r.cookies.get('booking-account')?.value).toBe('new-admin');expect(r.cookies.has('booking-session')).toBe(false);});
it('Slack login preserves and does not revoke administrator login',async()=>{const r=await slackLogin(request('auth/slack-web','student',{token:'test-link'}));expect(r.status).toBe(200);expect(r.cookies.has('booking-session')).toBe(true);expect(r.cookies.has('booking-account')).toBe(false);expect(m.logout).not.toHaveBeenCalled();});
it('learner logout preserves administrator session',async()=>{const r=await POST(request('auth/logout','student',{}));expect(r.cookies.get('booking-session')?.value).toBe('');expect(r.cookies.has('booking-account')).toBe(false);expect(m.logout).not.toHaveBeenCalled();});
it('admin logout preserves learner session',async()=>{const r=await POST(request('auth/logout','admin',{}));expect(r.cookies.get('booking-account')?.value).toBe('');expect(r.cookies.has('booking-session')).toBe(false);expect(m.logout).toHaveBeenCalledWith('admin-token');});

