import type {ClientBase} from 'pg';
import {z} from 'zod';
const ledgerSchema=z.array(z.object({tenant_id:z.uuid(),deleted_at:z.iso.datetime()}).strict()).max(100000);
/** Offline restore only: caller owns the transaction and supplies a separately retained ledger. */
export async function reapplyDeletionLedger(db:ClientBase,input:unknown){
 const ledger=ledgerSchema.parse(input);let count=0;
 const databaseNow=new Date((await db.query('SELECT clock_timestamp() AS now')).rows[0].now);
 for(const item of ledger){
  if(new Date(item.deleted_at)>databaseNow)throw Error('INVALID_DELETION_TIME');
  await db.query("UPDATE saas_control.tenants SET status='DELETION_PENDING',delete_after=$2 WHERE id=$1 AND status<>'DELETED'",[item.tenant_id,item.deleted_at]);
 }
 // Bounded SQL batches; never enable application processes during restore.
 for(let i=0;i<=Math.ceil(ledger.length/5);i++){
  const n=(await db.query('SELECT saas_control.purge_spaces() n')).rows[0].n;count+=n;if(n===0)break;
 }
 return {deleted:count};
}
