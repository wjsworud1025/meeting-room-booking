import {WebClient} from '@slack/web-api';
import type {Session} from '../shared/types';
import {pool} from './db';
import {requireThat} from './errors';
import {workspaceAuthorization} from '../slack/installations';
import {activeWorkspaceMember,ensureSlackMembers,nativeMembership} from '../slack/members';

type Person={id:string;display_name:string;class_name:string;slackId?:string};
type DirectoryPerson={slackId:string;display_name:string;search:string};
const cache=new Map<string,{until:number;people:DirectoryPerson[]}>();
const pending=new Map<string,Promise<DirectoryPerson[]>>();
export function searchableName(value:string){return value.normalize('NFKC').toLocaleLowerCase().replace(/\s/g,'');}
export async function directory(team:string,client:WebClient){
 const now=Date.now();for(const [key,value] of cache)if(value.until<=now)cache.delete(key);
 const saved=cache.get(team);if(saved)return saved.people;
 const running=pending.get(team);if(running)return running;
 const task=(async()=>{const people:DirectoryPerson[]=[];let cursor:string|undefined;
  do{const page=await client.users.list({limit:200,cursor});requireThat(page.ok,'SLACK_UNAVAILABLE','Slack 구성원을 불러오지 못했습니다.',503);
   for(const user of page.members??[]){try{const name=activeWorkspaceMember(user,team,user.id??'');people.push({slackId:user.id!,display_name:name,search:searchableName([name,user.real_name,user.name,user.profile?.real_name].join(' '))});}catch{/* Bots, deactivated and external members are not candidates. */}}
   cursor=page.response_metadata?.next_cursor?.trim()||undefined;
  }while(cursor);
  cache.set(team,{until:Date.now()+60000,people});return people;
 })();pending.set(team,task);try{return await task;}finally{pending.delete(team);}
}
export async function searchMembers(session:Session,query:string):Promise<Person[]>{
 const needle=searchableName(query);if(!needle)return [];
 if(!session.slack){const rows=(await pool().query("SELECT m.id,m.display_name,m.class_name FROM members m JOIN cohorts c ON c.id=m.cohort_id WHERE m.role='STUDENT' AND m.status='ACTIVE' AND m.id<>$1 AND c.venue_id=(SELECT own_c.venue_id FROM members own JOIN cohorts own_c ON own_c.id=own.cohort_id WHERE own.id=$1) ORDER BY m.display_name",[session.memberId])).rows as Person[];return rows.filter(p=>searchableName(p.display_name+' '+p.class_name).includes(needle)).slice(0,20);}
 const {team,user}=session.slack,group=await nativeMembership(team);requireThat(group,'WORKSPACE_DENIED','클래스 이용 설정을 확인해 주세요.',403);
 const auth=await workspaceAuthorization(team),client=new WebClient(auth.botToken,{timeout:10000,retryConfig:{retries:0}});
 const people=await directory(team,client);
 const members=(await pool().query('SELECT id,slack_user_id,status,role,cohort_id FROM members WHERE slack_workspace_id=$1',[team])).rows;
 const bySlack=new Map(members.map(m=>[m.slack_user_id,m]));
 return people.filter(p=>p.slackId!==user&&p.search.includes(needle)).filter(p=>{const m=bySlack.get(p.slackId);return !m||m.status==='ACTIVE'&&m.role==='STUDENT'&&m.cohort_id===group.cohort_id;}).slice(0,20).map(p=>({id:bySlack.get(p.slackId)?.id??'slack:'+p.slackId,slackId:p.slackId,display_name:p.display_name,class_name:group.class_name}));
}
export async function resolveSlackMember(session:Session,id:string):Promise<Person>{
 requireThat(session.slack,'FORBIDDEN','Slack에서 예약 화면을 열어 주세요.',403);
 const {team,user}=session.slack;requireThat(id!==user,'INVALID_INPUT','본인은 이미 참여합니다.',422);
 const auth=await workspaceAuthorization(team),client=new WebClient(auth.botToken,{timeout:10000,retryConfig:{retries:0}});
 const [memberId]=await ensureSlackMembers(client,team,[id]);
 const group=await nativeMembership(team);
 const row=(await pool().query("SELECT id,display_name,class_name FROM members WHERE id=$1 AND role='STUDENT' AND status='ACTIVE' AND cohort_id=$2",[memberId,group?.cohort_id])).rows[0];
 requireThat(row,'ACCOUNT_DENIED','참여 가능한 학생이 아닙니다.',403);return row;
}
