import type {WebClient} from '@slack/web-api';
import {pool,transaction} from '../server/db';
import {requireThat} from '../server/errors';
import {assertConnectedWorkspace} from './workspaces';

export async function nativeMembership(team:string){
 await assertConnectedWorkspace(team);
 return (await pool().query('SELECT w.class_name,w.cohort_id FROM slack_workspace_classes w JOIN cohorts c ON c.id=w.cohort_id WHERE w.team_id=$1 AND w.auto_enroll AND c.inactive_at IS NULL',[team])).rows[0] as {class_name:string;cohort_id:string}|undefined;
}
type Profile={id?:string;team_id?:string;deleted?:boolean;is_bot?:boolean;is_app_user?:boolean;is_stranger?:boolean;real_name?:string;name?:string;profile?:{display_name?:string;real_name?:string}};
export function activeWorkspaceMember(user:Profile|undefined,team:string,id:string){
 requireThat(user?.id===id&&id!=='USLACKBOT'&&user.team_id===team&&user.deleted===false&&user.is_bot===false&&!user.is_app_user&&!user.is_stranger,'ACCOUNT_DENIED','해당 클래스의 활성 구성원만 참여할 수 있습니다.',403);
 return (user.profile?.display_name||user.profile?.real_name||user.real_name||user.name||id).slice(0,100);
}
// Validate individual access immediately, independently of the background directory sync.
export async function ensureSlackMembers(client:Pick<WebClient,'users'>,team:string,ids:string[]){
 const group=await nativeMembership(team);requireThat(group,'WORKSPACE_DENIED','구성원 자동 등록이 활성화되지 않았습니다.',403);
 const unique=[...new Set(ids)];requireThat(unique.length>0&&unique.length<=100,'INVALID_INPUT','참여 인원을 확인해 주세요.',422);
 const profiles: {id:string;name:string}[]=[];
 for(const id of unique){const result=await client.users.info({user:id});requireThat(result.ok,'SLACK_UNAVAILABLE','Slack 구성원을 확인하지 못했습니다. 다시 시도해 주세요.',503);profiles.push({id,name:activeWorkspaceMember(result.user,team,id)});}
 return transaction(async(db,now)=>{
  const enabled=(await db.query('SELECT w.cohort_id FROM slack_workspace_classes w JOIN cohorts c ON c.id=w.cohort_id WHERE w.team_id=$1 AND w.auto_enroll AND c.inactive_at IS NULL FOR SHARE OF w,c',[team])).rows[0];
  requireThat(enabled&&enabled.cohort_id===group.cohort_id,'WORKSPACE_DENIED','클래스 이용 설정이 변경되었습니다.',403);
  const result=new Map<string,string>();
  for(const profile of profiles){
   const old=(await db.query('SELECT id,status FROM members WHERE slack_workspace_id=$1 AND slack_user_id=$2 FOR UPDATE',[team,profile.id])).rows[0];
   if(old){requireThat(old.status==='ACTIVE','ACCOUNT_DENIED','이용이 제한된 계정입니다. 운영 담당자에게 문의해 주세요.',403);result.set(profile.id,old.id);continue;}
   const row=(await db.query(`INSERT INTO members(email,display_name,class_name,cohort_id,role,status,slack_workspace_id,slack_user_id)
    VALUES(NULL,$1,$2,$3,'STUDENT','ACTIVE',$4,$5) RETURNING id`,[profile.name,group.class_name,group.cohort_id,team,profile.id])).rows[0];
   result.set(profile.id,row.id);
   await db.query("INSERT INTO audit_events(actor_id,action,entity_type,entity_id,decided_at,request_id,after_summary,cohort_id) VALUES(NULL,'slack.member_join','member',$1,$2,$3,$4,$5)",[row.id,now,'slack:'+team+':'+profile.id,JSON.stringify({workspace:team}),group.cohort_id]);
  }
  return ids.map(id=>result.get(id)!);
 });
}
