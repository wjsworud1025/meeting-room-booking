import {describe,it,expect} from 'vitest';
import {activeWorkspaceMember} from '../src/slack/members';
import {nativeInputSchema,bookingView,home} from '../src/slack/views';
import type {Snapshot} from '../src/shared/types';
const valid={id:'U123',team_id:'T123',deleted:false,is_bot:false,profile:{display_name:'참가자'}};
describe('Slack native participants',()=>{
 it('accepts active local members, including guests, without email',()=>{expect(activeWorkspaceMember(valid,'T123','U123')).toBe('참가자');expect(activeWorkspaceMember({...valid,...{is_restricted:true}},'T123','U123')).toBe('참가자');});
 it.each([{deleted:true},{is_bot:true},{is_app_user:true},{is_stranger:true},{team_id:'TOTHER'},{id:'UOTHER'},{deleted:undefined},{is_bot:undefined}])('rejects unsuitable identity %j',change=>expect(()=>activeWorkspaceMember({...valid,...change},'T123','U123')).toThrow());
 it('rejects Slackbot even though is_bot can be false',()=>expect(()=>activeWorkspaceMember({...valid,id:'USLACKBOT'},'T123','USLACKBOT')).toThrow());
 it('uses Slack user IDs in the native picker and preserves a retry',()=>{
  const draft={roomId:'f9008aed-efbb-4388-97fc-8b3decf458ab',date:'2026-10-01',time:'18:00',duration:30 as const,inviteeIds:['U123']};
  expect(nativeInputSchema.safeParse(draft).success).toBe(true);expect(nativeInputSchema.safeParse({...draft,inviteeIds:['other']}).success).toBe(false);
  const data={now:'2026-09-29',rooms:[{id:draft.roomId,name:'공용',capacity:4,minimum:2}],students:[],rules:{open:'18:00'}} as unknown as Snapshot;
  const view=JSON.stringify(bookingView(data,draft,'확인',true));expect(view).toContain('multi_users_select');expect(view).toContain('initial_users');expect(view).toContain('booking_submit_native');expect(view).not.toContain('multi_external_select');
 });
 it('does not send native-only users to an email login when Slack lookup fails',()=>{const json=JSON.stringify(home(undefined,'http://localhost','다시 시도','T123',true));expect(json).not.toContain('web_login');expect(json).toContain('refresh');});
});
