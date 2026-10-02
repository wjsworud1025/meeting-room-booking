import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({account:vi.fn(),actor:vi.fn(),release:vi.fn()}));
vi.mock('../src/server/login-accounts',()=>({accountCookie:'booking-account',bookingAccountSession:mocks.account}));
vi.mock('../src/server/db',()=>({pool:()=>({connect:async()=>({release:mocks.release})})}));
vi.mock('../src/server/store',()=>({actor:mocks.actor}));
vi.mock('../src/server/slack-web',()=>({verifySlackWebSession:vi.fn()}));
import {authenticate,seal} from '../src/server/auth';
beforeEach(()=>{vi.stubEnv('SESSION_SECRET','test-secret-with-at-least-32-characters');vi.stubEnv('APP_ENV','local');vi.stubEnv('NODE_ENV','test');mocks.account.mockResolvedValue({memberId:'admin'});mocks.actor.mockImplementation(async(_db,s)=>({id:s.memberId,role:s.memberId==='admin'?'ADMIN':'STUDENT'}));});
it('keeps learner identity when the same browser also has an administrator session',async()=>{
 const student=seal({memberId:'student',accessVersion:1,verifiedAt:0,expiresAt:Date.now()+60000,sessionId:'test'});
 const cookie=`booking-session=${student}; booking-account=admin-token`;
 const learner=await authenticate(new NextRequest('https://booking.test/api/snapshot',{headers:{cookie,'x-booking-context':'student'}}));
 expect(learner.me.role).toBe('STUDENT');
 const admin=await authenticate(new NextRequest('https://booking.test/api/snapshot',{headers:{cookie,'x-booking-context':'admin'}}));
 expect(admin.me.role).toBe('ADMIN');
});
it('does not substitute an administrator session for a missing learner session',async()=>{
 await expect(authenticate(new NextRequest('https://booking.test/api/snapshot',{headers:{cookie:'booking-account=admin-token','x-booking-context':'student'}}))).rejects.toMatchObject({status:401});
});
