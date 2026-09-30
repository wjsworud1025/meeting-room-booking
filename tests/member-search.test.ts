import {beforeEach,expect,it,vi} from 'vitest';
import {searchMembers,resolveSlackMember,searchableName} from '../src/server/member-search';
const {query,list,authorization,membership,ensure}=vi.hoisted(()=>({query:vi.fn(),list:vi.fn(),authorization:vi.fn(),membership:vi.fn(),ensure:vi.fn()}));
vi.mock('../src/server/db',()=>({pool:()=>({query})}));
vi.mock('../src/slack/installations',()=>({workspaceAuthorization:authorization}));
vi.mock('../src/slack/members',async importOriginal=>({...await importOriginal<object>(),nativeMembership:membership,ensureSlackMembers:ensure}));
vi.mock('@slack/web-api',()=>({WebClient:class{users={list};}}));
const session={memberId:'me',accessVersion:1,verifiedAt:0,expiresAt:Date.now()+60000,sessionId:'test'};
const member=(id:string,team:string,extra={})=>({id,team_id:team,deleted:false,is_bot:false,real_name:'김희진',...extra});
beforeEach(()=>{vi.clearAllMocks();authorization.mockResolvedValue({botToken:'private'});membership.mockResolvedValue({cohort_id:'class',class_name:'HRI'});query.mockResolvedValue({rows:[]});});
it('paginates Slack names, excludes bots, self, outsiders and inactive internal accounts',async()=>{
 const team='T_SEARCH';list.mockResolvedValueOnce({ok:true,members:[member('SELF',team),member('U_NEW',team),member('U_BOT',team,{is_bot:true}),member('U_OTHER','OTHER')],response_metadata:{next_cursor:'next'}}).mockResolvedValueOnce({ok:true,members:[member('U_OFF',team,{deleted:true}),member('U_BLOCKED',team),member('U_VALID',team)]});
 query.mockResolvedValue({rows:[{id:'blocked',slack_user_id:'U_BLOCKED',status:'INACTIVE',role:'STUDENT',cohort_id:'class'},{id:'valid',slack_user_id:'U_VALID',status:'ACTIVE',role:'STUDENT',cohort_id:'class'}]});
 const result=await searchMembers({...session,slack:{team,user:'SELF'}},'김 희');
 expect(result.map(p=>p.id)).toEqual(['slack:U_NEW','valid']);expect(list).toHaveBeenCalledTimes(2);expect(list.mock.calls[1][0].cursor).toBe('next');expect(ensure).not.toHaveBeenCalled();
 await searchMembers({...session,slack:{team,user:'SELF'}},'희진');expect(list).toHaveBeenCalledTimes(2);expect(authorization).toHaveBeenCalledTimes(2);
});
it('does not load Slack on blank queries or non-Slack sessions',async()=>{
 expect(await searchMembers(session,' ')).toEqual([]);query.mockResolvedValue({rows:[{id:'a',display_name:'김희진',class_name:'A'}]});expect(await searchMembers(session,'김 희')).toHaveLength(1);expect(authorization).not.toHaveBeenCalled();expect(searchableName(' A Ｂ ')).toBe('ab');
});
it('only resolves selected members using the session workspace and revalidates their student account',async()=>{
 ensure.mockResolvedValue(['internal']);query.mockResolvedValue({rows:[{id:'internal',display_name:'김희진',class_name:'HRI'}]});
 const result=await resolveSlackMember({...session,slack:{team:'T_RESOLVE',user:'SELF'}},'U_NEW');expect(result.id).toBe('internal');expect(ensure.mock.calls[0].slice(1)).toEqual(['T_RESOLVE',['U_NEW']]);expect(query.mock.calls[0][0]).toContain("role='STUDENT'");
 await expect(resolveSlackMember(session,'U_NEW')).rejects.toMatchObject({status:403});
 await expect(resolveSlackMember({...session,slack:{team:'T_RESOLVE',user:'SELF'}},'SELF')).rejects.toMatchObject({status:422});
});
it('never serves a cached directory after installation authorization fails',async()=>{
 authorization.mockRejectedValueOnce(Error('revoked'));await expect(searchMembers({...session,slack:{team:'T_SEARCH',user:'SELF'}},'김')).rejects.toThrow('revoked');expect(list).not.toHaveBeenCalled();
});
