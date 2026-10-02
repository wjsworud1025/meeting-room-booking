import {WebClient} from '@slack/web-api';
import {pool,transaction,saasEnabled,type DB} from './db';
import {directory} from './member-search';
import {allowedWorkspaces} from '../slack/workspaces';
import {workspaceAuthorization} from '../slack/installations';

export async function importRoster(db:DB,team:string,people:{slackId:string;display_name:string}[],now:Date){
 const group=(await db.query('SELECT w.cohort_id,w.class_name FROM slack_workspace_classes w JOIN cohorts c ON c.id=w.cohort_id JOIN slack_installations i ON i.team_id=w.team_id WHERE w.team_id=$1 AND w.auto_enroll AND c.inactive_at IS NULL AND i.revoked_at IS NULL FOR SHARE OF w,c,i',[team])).rows[0];
 if(!group)return;
 await db.query("UPDATE members SET slack_directory_active=false WHERE slack_workspace_id=$1 AND role='STUDENT'",[team]);
 for(const person of people){
  const old=(await db.query('SELECT id,role,cohort_id FROM members WHERE slack_workspace_id=$1 AND slack_user_id=$2',[team,person.slackId])).rows[0];
  if(old){if(old.role==='STUDENT'&&old.cohort_id===group.cohort_id)await db.query('UPDATE members SET display_name=$2,slack_directory_active=true WHERE id=$1',[old.id,person.display_name]);continue;}
  await db.query("INSERT INTO members(email,display_name,class_name,cohort_id,role,status,slack_workspace_id,slack_user_id) VALUES(NULL,$1,$2,$3,'STUDENT','ACTIVE',$4,$5)",[person.display_name,group.class_name,group.cohort_id,team,person.slackId]);
 }
 await db.query('UPDATE slack_workspace_classes SET directory_synced_at=$2 WHERE team_id=$1',[team,now]);
}
const runs=new Map<string,{running:boolean;next:number}>();
export async function syncWorkspaceRosters(){
 const key=saasEnabled()?(await pool().query('SELECT saas_control.current_tenant() tenant')).rows[0].tenant:'legacy';
 const state=runs.get(key)??{running:false,next:0};if(state.running||Date.now()<state.next)return;state.running=true;state.next=Date.now()+30000;runs.set(key,state);
 try{
  const groups=(await pool().query("SELECT w.team_id FROM slack_workspace_classes w JOIN cohorts c ON c.id=w.cohort_id JOIN slack_installations i ON i.team_id=w.team_id WHERE w.auto_enroll AND c.inactive_at IS NULL AND i.revoked_at IS NULL AND (w.directory_synced_at IS NULL OR w.directory_synced_at<clock_timestamp()-interval '5 minutes')")).rows;
  for(const {team_id:team} of groups){try{const auth=await workspaceAuthorization(team);const people=await directory(team,new WebClient(auth.botToken,{timeout:10000,retryConfig:{retries:0}}));await transaction((db,now)=>importRoster(db,team,people,now));}catch{console.error('booking.roster: sync failed; retrying later');}}
 }finally{state.running=false;}
}
