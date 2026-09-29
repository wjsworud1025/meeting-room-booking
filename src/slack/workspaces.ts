import {requireThat} from '../server/errors';

// Every listed workspace shares this deployment's rooms and registered students.
// This is an explicit facility allowlist, not a multi-tenant boundary.
export function allowedWorkspaces():string[]{
 return [...new Set([process.env.SLACK_WORKSPACE_ID??'',...(process.env.SLACK_ALLOWED_WORKSPACE_IDS??'').split(',')].map(s=>s.trim()).filter(Boolean))];
}
export function assertWorkspace(team:string){
 requireThat(!!team&&allowedWorkspaces().includes(team),'WORKSPACE_DENIED','허용된 워크스페이스가 아닙니다.',403);
}
