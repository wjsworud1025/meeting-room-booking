import {controlPool,databaseContext,saasEnabled,pool} from '../db';
import {withTenant} from './runtime';
import {requireThat} from '../errors';
export async function tenantForWorkspace(team:string){
 const r=await controlPool().query('SELECT saas_control.workspace_route($1) tenant',[team]);
 requireThat(r.rows[0]?.tenant,'WORKSPACE_DENIED','연결된 활성 워크스페이스가 아닙니다.',403);return r.rows[0].tenant as string;
}
/** Team must come from a Slack-authenticated envelope or a verified, sealed server session. */
export async function inWorkspace<T>(team:string,fn:()=>Promise<T>):Promise<T>{
 if(!saasEnabled())return fn();
 const tenant=await tenantForWorkspace(team);
 if(databaseContext.getStore()){
  const r=await pool().query('SELECT saas_control.current_tenant() tenant');
  requireThat(r.rows[0]?.tenant===tenant,'WORKSPACE_DENIED','다른 고객의 워크스페이스입니다.',403);return fn();
 }
 return withTenant(tenant,fn);
}
