import {pool,type DB} from './db';
import {AppError} from './errors';
import type {Member,Session} from '../shared/types';
function invitationsDisabled():never{throw new AppError('SINGLE_ADMIN_ONLY','단일 관리자 운영으로 관리자 추가·초대를 지원하지 않습니다.',403);}
export async function slackAdmin(team:string,user:string){
 return (await pool().query<Member>("SELECT * FROM members WHERE role='ADMIN' AND status='ACTIVE' AND admin_slack_team=$1 AND admin_slack_user=$2",[team,user])).rows[0];
}
export async function adminCandidates(_session:Session,_team:string,_search:string){return invitationsDisabled();}
export async function issueSlackAdmin(_db:DB,_issuer:Member,_team:string,_user:string,_now:Date,_level?:string){return invitationsDisabled();}
export async function respondSlackAdmin(_team:string,_user:string,_invitationId:string,_accept:boolean):Promise<{accepted:boolean}>{return invitationsDisabled();}
export async function decideSlackAdmin(_db:DB,_team:string,_user:string,_invitationId:string,_accept:boolean,_now:Date):Promise<{accepted:boolean}>{return invitationsDisabled();}
