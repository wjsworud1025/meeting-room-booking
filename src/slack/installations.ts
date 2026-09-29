import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {pool} from '../server/db';
import {requireThat} from '../server/errors';
import {assertWorkspace} from './workspaces';

function key(){
 const value=process.env.SLACK_TOKEN_ENCRYPTION_KEY??'';
 requireThat(/^[a-f0-9]{64}$/i.test(value),'CONFIGURATION','Slack 토큰 암호화 키 설정이 필요합니다.',503);
 return Buffer.from(value,'hex');
}
export function encryptToken(token:string,team:string){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
 cipher.setAAD(Buffer.from(team));
 const ciphertext=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
 return [iv,cipher.getAuthTag(),ciphertext].map(v=>v.toString('base64url')).join('.');
}
export function decryptToken(value:string,team:string){
 const parts=value.split('.');requireThat(parts.length===3,'CONFIGURATION','Slack 설치 정보를 확인해 주세요.',503);
 const [iv,tag,ciphertext]=parts.map(v=>Buffer.from(v,'base64url'));
 const decipher=createDecipheriv('aes-256-gcm',key(),iv);decipher.setAAD(Buffer.from(team));decipher.setAuthTag(tag);
 return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');
}
export async function saveInstallation(installation:{team:string;name:string;appId:string;botUserId:string;token:string}){
 assertWorkspace(installation.team);
 const {team,name,appId,botUserId,token}=installation;
 await pool().query(`INSERT INTO slack_installations(team_id,team_name,app_id,bot_user_id,bot_token_encrypted)
 VALUES($1,$2,$3,$4,$5) ON CONFLICT(team_id) DO UPDATE SET team_name=$2,app_id=$3,bot_user_id=$4,bot_token_encrypted=$5,installed_at=clock_timestamp(),revoked_at=NULL`,[team,name,appId,botUserId,encryptToken(token,team)]);
}
export async function workspaceAuthorization(team:string){
 assertWorkspace(team);
 const row=(await pool().query('SELECT bot_token_encrypted,bot_user_id,revoked_at FROM slack_installations WHERE team_id=$1',[team])).rows[0];
 if(row){
  requireThat(!row.revoked_at,'WORKSPACE_DENIED','앱을 다시 설치해 주세요.',403);
  return {teamId:team,botToken:decryptToken(row.bot_token_encrypted,team),botUserId:row.bot_user_id as string};
 }
 // Preserve the existing single-workspace deployment during migration.
 requireThat(team===process.env.SLACK_WORKSPACE_ID&&!!process.env.SLACK_BOT_TOKEN,'WORKSPACE_DENIED','설치된 워크스페이스가 아닙니다.',403);
 return {teamId:team,botToken:process.env.SLACK_BOT_TOKEN!,botUserId:process.env.SLACK_BOT_USER_ID};
}
export async function revokeInstallation(team:string){
 assertWorkspace(team);
 // A tombstone also prevents falling back to the legacy environment token.
 await pool().query(`INSERT INTO slack_installations(team_id,team_name,app_id,bot_user_id,bot_token_encrypted,revoked_at)
 VALUES($1,'','','','',clock_timestamp()) ON CONFLICT(team_id) DO UPDATE SET revoked_at=clock_timestamp(),bot_token_encrypted=''`,[team]);
}
