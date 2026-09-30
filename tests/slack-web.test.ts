import {it,expect,vi,beforeEach} from 'vitest';
import {createWebLink,activateWebLink,redeemWebLink,slackWebBase,webDestination,verifySlackWebSession} from '../src/server/slack-web';
const {query,info,membership,authorization}=vi.hoisted(()=>({query:vi.fn(),info:vi.fn(),membership:vi.fn(),authorization:vi.fn()}));
vi.mock('../src/server/db',()=>({pool:()=>({query})}));
vi.mock('../src/slack/installations',()=>({workspaceAuthorization:authorization}));
vi.mock('../src/slack/members',()=>({nativeMembership:membership,activeWorkspaceMember:(u:{deleted:boolean})=>{if(u.deleted)throw Error('inactive');}}));
vi.mock('@slack/web-api',()=>({WebClient:class{users={info};}}));
const session={memberId:'member',accessVersion:1,verifiedAt:0,expiresAt:Date.now()+60000,sessionId:'test'};
beforeEach(()=>{vi.clearAllMocks();process.env.APP_ENV='local';process.env.SLACK_WEB_BASE_URL='http://localhost:3000';membership.mockResolvedValue({});authorization.mockResolvedValue({botToken:'test'});info.mockResolvedValue({user:{deleted:false}});});
it('only permits internal booking destinations and a safe web origin',()=>{expect(webDestination('/schedule')).toBe('/schedule');expect(()=>webDestination('//evil.test')).toThrow();process.env.SLACK_WEB_BASE_URL='http://evil.test';expect(()=>slackWebBase()).toThrow();});
it('stores only a hash and uses a fragment for the short-lived link',async()=>{
 query.mockResolvedValue({rows:[{id:'member',role:'STUDENT'}]});const url=new URL(await createWebLink('T','U',session));expect(url.search).toBe('');expect(url.hash.length).toBe(44);
 const insert=query.mock.calls.find(c=>c[0].startsWith('INSERT'));expect(insert?.[1][0]).not.toBe(url.hash.slice(1));expect(insert?.[0]).toContain("interval '2 minutes'");
});
it('rejects expired or already redeemed links before Slack lookup',async()=>{query.mockResolvedValue({rows:[]});await expect(redeemWebLink('x'.repeat(43))).rejects.toThrow('만료');expect(authorization).not.toHaveBeenCalled();expect(query.mock.calls[0][0]).toContain('DELETE FROM');});
it('creates only a student Slack session without recent admin verification',async()=>{
 query.mockResolvedValueOnce({rows:[{member_id:'member',access_version:1,team_id:'T',user_id:'U_NEW',destination:'/schedule'}]}).mockResolvedValue({rows:[{id:'member',role:'STUDENT'}]});
 const result=await redeemWebLink('y'.repeat(43));expect(result.session.slack).toEqual({team:'T',user:'U_NEW'});expect(result.session.verifiedAt).toBe(0);expect(result.session.accessToken).toBeUndefined();expect(membership).toHaveBeenCalled();
});
it('denies revoked installations and disabled internal accounts',async()=>{
 authorization.mockRejectedValueOnce(Error('revoked'));await expect(verifySlackWebSession({...session,slack:{team:'T',user:'U'}})).rejects.toThrow('revoked');
 query.mockResolvedValue({rows:[]});await expect(verifySlackWebSession({...session,slack:{team:'T',user:'U'}})).rejects.toThrow('계정');
});
it('waits for the verified Slack click instead of issuing a session from a URL alone',async()=>{
 query.mockResolvedValueOnce({rows:[],rowCount:0}).mockResolvedValueOnce({rows:[{}],rowCount:1});
 await expect(redeemWebLink('p'.repeat(43))).rejects.toMatchObject({code:'LINK_PENDING',status:202});expect(authorization).not.toHaveBeenCalled();
});
it('binds activation to the Slack workspace and user without extending an active grant',async()=>{
 query.mockResolvedValue({rows:[]});await activateWebLink('TEAM','USER','q'.repeat(43));
 expect(query.mock.calls[0][0]).toContain('team_id=$2 AND user_id=$3 AND NOT ready');expect(query.mock.calls[0][1].slice(1)).toEqual(['TEAM','USER']);
});

it('never mints an administrator destination for a student',async()=>{query.mockResolvedValue({rows:[{id:'member',role:'STUDENT'}]});await expect(createWebLink('T','U',session,'/admin/reservations')).rejects.toMatchObject({code:'FORBIDDEN'});expect(query.mock.calls.some(c=>c[0].startsWith('INSERT'))).toBe(false);});
it('permits a verified active admin to mint an admin-only link without a student cohort',async()=>{query.mockResolvedValue({rows:[{id:'member',role:'ADMIN'}]});membership.mockResolvedValue(undefined);const url=await createWebLink('T','U',session,'/admin/reservations',true);expect(url).toContain('/slack-entry#');expect(membership).not.toHaveBeenCalled();});
it('checks admin role again when redeeming a stored admin destination',async()=>{query.mockResolvedValueOnce({rows:[{member_id:'member',access_version:1,team_id:'T',user_id:'U_ADMIN',destination:'/admin/reservations'}]}).mockResolvedValueOnce({rows:[{id:'member',role:'STUDENT'}]}).mockResolvedValueOnce({rows:[],rowCount:0});await expect(redeemWebLink('z'.repeat(43))).rejects.toMatchObject({code:'FORBIDDEN'});});
