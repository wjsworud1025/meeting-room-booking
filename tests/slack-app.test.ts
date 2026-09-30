import {describe,it,expect,vi,beforeEach} from 'vitest';
import {commandInput,inputSchema,home,bookingView} from '../src/slack/views';
import {slackSession} from '../src/slack/identity';
import type {Snapshot} from '../src/shared/types';
const {query}=vi.hoisted(()=>({query:vi.fn()}));vi.mock('../src/server/db',()=>({saasEnabled:()=>false,pool:()=>({query})}));
const room='f9008aed-efbb-4388-97fc-8b3decf458ab',person='2ebfa97a-9c9b-4b20-81f8-87e5e9a207b8';
const draft={date:'2026-10-01',time:'18:00',duration:60 as const,roomId:room,inviteeIds:[person]};
describe('Slack booking adapter',()=>{
 beforeEach(()=>{process.env.SLACK_WORKSPACE_ID='TTEST';query.mockReset();});
 it('converts Korean wall time and deduplicates invitees',()=>{expect(commandInput({...draft,inviteeIds:[person,person]})).toEqual({roomId:room,startsAt:'2026-10-01T09:00:00.000Z',endsAt:'2026-10-01T10:00:00.000Z',inviteeIds:[person]});});
 it('rejects invalid duration and identifiers',()=>{for(const duration of [0,15,31,150])expect(inputSchema.safeParse({...draft,duration}).success).toBe(false);expect(inputSchema.safeParse({...draft,inviteeIds:['U123']}).success).toBe(false);});
 it('denies other workspaces without querying accounts',async()=>{query.mockResolvedValue({rows:[]});await expect(slackSession('OTHER','U1')).rejects.toThrow('워크스페이스');expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0][0]).toContain("class_install_requests");});
 it('denies unlinked and inactive accounts',async()=>{query.mockResolvedValue({rows:[]});await expect(slackSession('TTEST','U1')).rejects.toThrow('계정');query.mockResolvedValue({rows:[{status:'INACTIVE'}]});await expect(slackSession('TTEST','U1')).rejects.toThrow('계정');});
 it('uses current account version without granting recent admin authentication',async()=>{query.mockResolvedValue({rows:[{id:person,status:'ACTIVE',access_version:7}]});expect(await slackSession('TTEST','U1')).toMatchObject({memberId:person,accessVersion:7,verifiedAt:0});});
 it('unlinked home contains no booking data or booking action',()=>{const json=JSON.stringify(home(undefined,'http://localhost:3002'));expect(json).toContain('web_login');expect(json).not.toContain('new_booking');});
 it('retry form keeps entered members and times and escapes text with plain_text',()=>{const data={now:'2026-09-29T00:00:00Z',rooms:[{id:room,name:'회의실 01',minimum:2,capacity:4}],students:[{id:person,display_name:'<@everyone>'}],rules:{open:'18:00'}} as unknown as Snapshot;const view=bookingView(data,draft,'시간 겹침');expect(JSON.stringify(view)).toContain('initial_date":"2026-10-01');expect(JSON.stringify(view)).toContain(person);expect(JSON.stringify(view)).not.toContain('mrkdwn');expect(view.blocks.length).toBeLessThan(100);});
});
