import {afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({publish:vi.fn(),query:vi.fn(),member:vi.fn(),reservation:vi.fn()}));
vi.mock('../src/server/db',()=>({pool:()=>({connect:async()=>({query:mocks.query,release:()=>{}}),query:mocks.query}),transaction:vi.fn()}));
vi.mock('../src/server/auth',()=>({isLocal:()=>false,supabase:vi.fn()}));
vi.mock('../src/server/store',()=>({member:mocks.member,reservation:mocks.reservation}));
vi.mock('../src/slack/publish-home',()=>({publish:mocks.publish}));
vi.mock('../src/slack/installations',()=>({workspaceAuthorization:async()=>({botToken:'test-token'})}));
import {runTask} from '../src/server/jobs';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
function setup(){
 mocks.member.mockResolvedValue({id:'member',slack_user_id:'U123',status:'ACTIVE'});
 mocks.reservation.mockResolvedValue({id:'reservation',room_id:'room',starts_at:'2026-10-01T09:00:00Z',ends_at:'2026-10-01T10:00:00Z',status:'CONFIRMED',participants:[{member_id:'member',status:'ACCEPTED'}]});
 mocks.query.mockResolvedValue({rows:[{name:'회의실 A',slack_workspace_id:'T123'}]});
 const fetch=vi.fn().mockResolvedValue({json:async()=>({ok:true})});vi.stubGlobal('fetch',fetch);return fetch;
}
const task={id:'task',kind:'NOTIFY',recipient_id:'member',channel:'AUTO',payload:{reservationId:'reservation',event:'초대'},lease_token:'lease',attempts:1};
describe('Slack notifications',()=>{
 it('drops obsolete administrator invitations without sending a DM',async()=>{const fetch=setup();await runTask({...task,channel:'SLACK_ADMIN_INVITE',payload:{invitationId:'invite',event:'관리자 초대'}});expect(fetch).not.toHaveBeenCalled();expect(mocks.member).not.toHaveBeenCalled();});
 it('does not deliver revoked administrator invitations',async()=>{const fetch=setup();mocks.member.mockResolvedValue({id:'admin',role:'ADMIN',admin_slack_user:'UINVITED',admin_invite_id:'invite',invite_revoked_at:new Date().toISOString()});await runTask({...task,channel:'SLACK_ADMIN_INVITE',payload:{invitationId:'invite',event:'관리자 초대'}});expect(fetch).not.toHaveBeenCalled();});
 it('retains Slack delivery receipt instead of merely declaring completion',async()=>{const fetch=setup();fetch.mockResolvedValueOnce({json:async()=>({ok:true,channel:'D123',ts:'123.456'})});await expect(runTask(task)).resolves.toEqual({slackAccepted:true,channel:'D123',ts:'123.456'});});
 it('sends an invitation to an automatically accepted member',async()=>{const fetch=setup();await runTask(task);expect(fetch).toHaveBeenCalledOnce();const body=JSON.parse(fetch.mock.calls[0][1].body);expect(body.channel).toBe('U123');expect(body.text).toContain('회의실 A');});
 it('refreshes Home separately without sending another DM',async()=>{const fetch=setup();await runTask({...task,channel:'SLACK_HOME'});expect(mocks.publish).toHaveBeenCalledWith(expect.anything(),'T123','U123',true);expect(fetch).not.toHaveBeenCalled();});
 it('keeps Home errors isolated from DM delivery',async()=>{const fetch=setup();mocks.publish.mockRejectedValueOnce(Error('HOME_FAILED'));await expect(runTask({...task,channel:'SLACK_HOME'})).rejects.toThrow('HOME_FAILED');await runTask(task);expect(fetch).toHaveBeenCalledOnce();});
 it('retains a safe Slack error code for diagnosis and retry',async()=>{const fetch=setup();fetch.mockResolvedValueOnce({json:async()=>({ok:false,error:'missing_scope'})});await expect(runTask(task)).rejects.toThrow('SLACK_MISSING_SCOPE');});
});
