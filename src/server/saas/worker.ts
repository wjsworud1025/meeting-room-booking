import {tickExports} from './lifecycle';
import {tickSharedHolidays,retireLegacyTasks} from './shared-jobs';
import {schedulerPool,pool,transaction} from '../db';
import {withTenant} from './runtime';
import {runTask,type Task} from '../jobs';
import {boundaries} from '../booking';
import {syncWorkspaceRosters} from '../workspace-roster';
export async function assertDeliveryAllowed(task:Task){
 if(!task.tenant_id)throw Error('TASK_TENANT_REQUIRED');
 const r=await schedulerPool().query('SELECT saas_control.delivery_allowed($1,$2,$3) allowed',[task.tenant_id,task.id,task.lease_token]);
 if(r.rows[0]?.allowed!==true)throw Error('DELIVERY_REVOKED');
}
export async function deliverNextNotification(deliver:typeof runTask=runTask){
 const r=await schedulerPool().query('SELECT * FROM saas_control.claim_notification()');const claim=r.rows[0];if(!claim)return false;
 try{
  const result=await withTenant(claim.tenant_id,async()=>{
   const task=(await pool().query<Task>("SELECT * FROM tasks WHERE id=$1 AND lease_token=$2 AND status='RUNNING' AND lease_until>clock_timestamp()",[claim.id,claim.lease_token])).rows[0];
   if(!task)throw Error('TASK_LEASE_LOST');await assertDeliveryAllowed(task);return deliver(task);
  });
  await withTenant(claim.tenant_id,()=>pool().query("UPDATE tasks SET status='DONE',lease_until=NULL,result_summary=$3 WHERE id=$1 AND lease_token=$2 AND status='RUNNING'",[claim.id,claim.lease_token,JSON.stringify({completed:true,...result})]));
 }catch(e){
  // A suspended/deleted tenant cannot be entered, even for a completion write. Leave its lease to expire.
  await withTenant(claim.tenant_id,()=>pool().query("UPDATE tasks SET status=CASE WHEN attempts>=4 THEN 'FAILED' ELSE 'PENDING' END,next_run_at=clock_timestamp()+interval '5 minutes',lease_until=NULL,last_error_code=$3 WHERE id=$1 AND lease_token=$2 AND status='RUNNING'",[claim.id,claim.lease_token,e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'DELIVERY_FAILED'])).catch(()=>{});
 }
 return true;
}
export async function tickTenantJobs(){
 const role=await schedulerPool().query("SELECT rolsuper OR rolbypassrls OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='booking' AND c.relname='tasks' AND has_table_privilege(current_user,c.oid,'SELECT')) unsafe FROM pg_roles WHERE rolname=current_user");
 if(role.rows[0]?.unsafe!==false)throw Error('UNSAFE_SCHEDULER_ROLE');
 await tickSharedHolidays();
 await schedulerPool().query('SELECT saas_control.expire_lifecycle()');
 await tickExports();
 if(process.env.SAAS_DELETION_ENABLED==='true')await schedulerPool().query('SELECT saas_control.purge_spaces()');
 const due=await schedulerPool().query('SELECT saas_control.maintenance_tenants() tenant');
 for(const {tenant} of due.rows){await withTenant(tenant,async()=>{
  if(!(await pool().query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,9302026)) locked",[tenant])).rows[0].locked)return;
  await transaction(async(db,now)=>{await boundaries(db,now);await db.query('UPDATE settings SET job_heartbeat=$1',[now]);await db.query('DELETE FROM command_receipts WHERE expires_at<$1',[now]);});
  await retireLegacyTasks();
  await syncWorkspaceRosters();
 }).catch(()=>console.error('booking.saas-maintenance: tenant maintenance failed'));}
 for(let i=0;i<5;i++)if(!await deliverNextNotification())break;
}
