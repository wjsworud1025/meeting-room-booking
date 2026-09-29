import {randomUUID} from 'node:crypto';
import {pool} from '../server/db';
import {requireThat} from '../server/errors';
import type {Session} from '../shared/types';
export async function slackSession(team:string,user:string):Promise<Session>{
 requireThat(!!process.env.SLACK_WORKSPACE_ID&&team===process.env.SLACK_WORKSPACE_ID,'WORKSPACE_DENIED','허용된 워크스페이스가 아닙니다.',403);
 const rows=(await pool().query("SELECT id,access_version,status FROM members WHERE slack_workspace_id=$1 AND slack_user_id=$2",[team,user])).rows;
 requireThat(rows.length===1&&rows[0].status==='ACTIVE','ACCOUNT_DENIED','먼저 웹에서 Slack 로그인을 완료해 등록 계정을 연결해 주세요.',403);
 return {memberId:rows[0].id,accessVersion:rows[0].access_version,verifiedAt:0,expiresAt:Date.now()+60000,sessionId:randomUUID()};
}
