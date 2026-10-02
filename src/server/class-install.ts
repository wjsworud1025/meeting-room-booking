import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {pool,transaction,saasEnabled,controlPool,type DB} from './db';
import {requireThat} from './errors';
import {requireVenue} from './venues';
import {encryptToken} from '../slack/installations';
import {localDate} from '../shared/time';
export const tokenHash=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function installRequestCommand(db:DB,action:string,input:unknown,now:Date){
 const token=randomBytes(32).toString('base64url'),hash=tokenHash(token),expires=new Date(now.getTime()+7*86400000);
 let id:string;
 if(action==='create'){
  const v=z.object({name:z.string().trim().min(1).max(80),venueId:z.string().uuid()}).strict().parse(input);await requireVenue(db,v.venueId);
  id=(await db.query('INSERT INTO class_install_requests(name,venue_id,token_hash,expires_at) VALUES($1,$2,$3,$4) RETURNING id',[v.name,v.venueId,hash,expires])).rows[0].id;
 }else{
  const v=z.object({id:z.string().uuid()}).strict().parse(input);id=v.id;
  const r=(await db.query('SELECT * FROM class_install_requests WHERE id=$1 FOR UPDATE',[id])).rows[0];requireThat(r&&!r.completed_at,'CONFLICT','이미 연결되었거나 없는 설치 요청입니다.');
  if(action==='delete'){requireThat(r.revoked_at||new Date(r.expires_at)<=now,'CONFLICT','취소되거나 만료된 설치 요청만 삭제할 수 있습니다.');await db.query('DELETE FROM class_install_requests WHERE id=$1',[id]);return {id};}
  requireThat(action==='reissue'||action==='revoke','INVALID_INPUT','잘못된 요청입니다.',422);
  if(action==='revoke'){await db.query('UPDATE class_install_requests SET revoked_at=$2 WHERE id=$1',[id,now]);return {id};}
  await db.query('UPDATE class_install_requests SET token_hash=$2,expires_at=$3,revoked_at=NULL WHERE id=$1',[id,hash,expires]);
 }
 const base=new URL(process.env.APP_BASE_URL!);requireThat(base.protocol==='https:','CONFIGURATION','HTTPS 서비스 주소가 필요합니다.',503);
 return {id,url:base.origin+'/class-install?token='+token,expiresAt:expires.toISOString()};
}
export async function readInstallRequest(token:string,db?:Pick<DB,'query'>,lock=false){
 requireThat(/^[A-Za-z0-9_-]{43}$/.test(token),'INVALID_FLOW','유효하지 않은 설치 링크입니다.',400);
 if(saasEnabled()&&!db){const r=(await controlPool().query('SELECT * FROM saas_control.install_preview($1)',[tokenHash(token)])).rows[0];requireThat(r,'INVALID_FLOW','만료되었거나 사용된 설치 링크입니다.',400);return r;}
 db??=pool();
 const r=(await db.query(`SELECT r.*,v.name AS venue_name FROM class_install_requests r JOIN venues v ON v.id=r.venue_id WHERE token_hash=$1 ${lock?'FOR UPDATE OF r':''}`,[tokenHash(token)])).rows[0];
 requireThat(r&&!r.revoked_at&&!r.completed_at&&new Date(r.expires_at).getTime()>Date.now(),'INVALID_FLOW','만료되었거나 사용된 설치 링크입니다. 관리자에게 새 링크를 요청하세요.',400);return r;
}
export async function connectInstallRequest(token:string,data:{team:string;name:string;appId:string;botUserId:string;token:string}){
 if(saasEnabled()){await controlPool().query('SELECT saas_control.connect_install($1,$2,$3,$4,$5,$6)',[tokenHash(token),data.team,data.name,data.appId,data.botUserId,encryptToken(data.token,data.team)]);return;}
 return transaction(async(db,now)=>{
  const r=await readInstallRequest(token,db,true);
  requireThat(!(await db.query('SELECT 1 FROM slack_workspace_classes WHERE team_id=$1',[data.team])).rowCount,'CONFLICT','이미 다른 클래스에 연결된 워크스페이스입니다.');
  await db.query(`INSERT INTO slack_installations(team_id,team_name,app_id,bot_user_id,bot_token_encrypted) VALUES($1,$2,$3,$4,$5) ON CONFLICT(team_id) DO UPDATE SET team_name=$2,app_id=$3,bot_user_id=$4,bot_token_encrypted=$5,revoked_at=NULL,installed_at=clock_timestamp()`,[data.team,data.name,data.appId,data.botUserId,encryptToken(data.token,data.team)]);
  const c=(await db.query("INSERT INTO cohorts(name,starts_on,ends_on,venue_id) VALUES($1,$2,'9999-12-31',$3) RETURNING id",[r.name,localDate(now),r.venue_id])).rows[0];
  await db.query('INSERT INTO slack_workspace_classes(team_id,class_name,cohort_id,auto_enroll) VALUES($1,$2,$3,true)',[data.team,r.name,c.id]);
  await db.query('UPDATE class_install_requests SET team_id=$2,completed_at=$3 WHERE id=$1',[r.id,data.team,now]);
 });
}
