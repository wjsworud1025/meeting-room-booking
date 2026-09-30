import {pool} from '../server/db';
import {requireThat} from '../server/errors';

// Every listed workspace shares this deployment's rooms and registered students.
// This is an explicit facility allowlist, not a multi-tenant boundary.
export function allowedWorkspaces():string[]{
 return [...new Set([process.env.SLACK_WORKSPACE_ID??'',...(process.env.SLACK_ALLOWED_WORKSPACE_IDS??'').split(',')].map(s=>s.trim()).filter(Boolean))];
}
export function assertWorkspace(team:string){
 requireThat(!!team&&allowedWorkspaces().includes(team),'WORKSPACE_DENIED','허용된 워크스페이스가 아닙니다.',403);
}

export async function assertConnectedWorkspace(team:string){
 if(allowedWorkspaces().includes(team))return;
 const row=(await pool().query(`SELECT 1 FROM class_install_requests r JOIN slack_workspace_classes w ON w.team_id=r.team_id JOIN cohorts c ON c.id=w.cohort_id JOIN slack_installations i ON i.team_id=w.team_id WHERE r.team_id=$1 AND r.completed_at IS NOT NULL AND r.revoked_at IS NULL AND w.auto_enroll AND c.inactive_at IS NULL AND i.revoked_at IS NULL`,[team])).rows[0];
 requireThat(row,'WORKSPACE_DENIED','연결된 활성 워크스페이스가 아닙니다.',403);
}
