import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
const m=vi.hoisted(()=>({workspace:vi.fn(),tenant:vi.fn(),account:vi.fn()}));
vi.mock('../src/server/db',()=>({saasEnabled:()=>true,controlPool:()=>({query:async()=>({rows:[{unsafe:false}]})})}));
vi.mock('../src/server/auth',()=>({cookieName:'booking-session',unseal:()=>({slack:{team:'student-team'}})}));
vi.mock('../src/server/login-accounts',()=>({accountCookie:'booking-account',accountSession:m.account}));
vi.mock('../src/server/saas/slack-routing',()=>({inWorkspace:m.workspace}));
vi.mock('../src/server/saas/runtime',()=>({tenantForAccount:async()=>({tenant_id:'admin-tenant'}),withTenant:m.tenant}));
import {scopedRequest} from '../src/server/saas/request';
beforeEach(()=>{vi.clearAllMocks();m.account.mockResolvedValue({id:'admin',must_change_password:false});m.workspace.mockImplementation(async(_id,fn)=>fn());m.tenant.mockImplementation(async(_id,fn)=>fn());});
it('routes learner requests to Slack workspace even when a different owner is signed in',async()=>{
 const req=new NextRequest('https://booking.test/api/snapshot',{headers:{cookie:'booking-session=student; booking-account=admin','x-booking-context':'student'}});
 await scopedRequest(req,async()=>NextResponse.json({ok:true}));
 expect(m.workspace).toHaveBeenCalledWith('student-team',expect.any(Function));expect(m.tenant).not.toHaveBeenCalled();expect(m.account).not.toHaveBeenCalled();
});
it('routes admin requests to the owner tenant with both cookies present',async()=>{
 await scopedRequest(new NextRequest('https://booking.test/api/snapshot',{headers:{cookie:'booking-session=student; booking-account=admin','x-booking-context':'admin'}}),async()=>NextResponse.json({ok:true}));
 expect(m.tenant).toHaveBeenCalledWith('admin-tenant',expect.any(Function));expect(m.workspace).not.toHaveBeenCalled();
});
it('does not fall back to learner workspace when admin session is missing',async()=>{
 const handler=vi.fn();const result=await scopedRequest(new NextRequest('https://booking.test/api/snapshot',{headers:{cookie:'booking-session=student','x-booking-context':'admin'}}),handler);
 expect(result.status).toBe(401);expect(handler).not.toHaveBeenCalled();expect(m.workspace).not.toHaveBeenCalled();
});
