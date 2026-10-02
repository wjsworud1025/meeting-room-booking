import type {Pool,PoolClient} from 'pg';
/** Internal boundary for the SaaS cutover. Call only with a server-verified tenant.
 * This helper does NOT authenticate a client-supplied tenant ID. Legacy routes do not use it yet.
 */
export async function tenantTransaction<T>(pool:Pool,tenantId:string,fn:(db:PoolClient)=>Promise<T>):Promise<T> {
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) throw new Error('INVALID_TENANT');
 const db=await pool.connect();
 let broken=false;
 try {
  await db.query('BEGIN');
  const role=await db.query(`SELECT r.rolsuper OR r.rolbypassrls OR EXISTS(
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('booking','saas_control') AND pg_has_role(current_user,c.relowner,'MEMBER')
  ) unsafe FROM pg_roles r WHERE r.rolname=current_user`);
  if(role.rows[0]?.unsafe!==false) throw new Error('UNSAFE_TENANT_DB_ROLE');
  await db.query("SELECT set_config('booking.tenant_id',$1,true)",[tenantId]);
  await db.query("SET LOCAL lock_timeout='10s'");
  const {rows}=await db.query('SELECT tenant_id FROM booking.settings WHERE tenant_id=$1 FOR UPDATE',[tenantId]);
  if(rows.length!==1) throw new Error('TENANT_UNAVAILABLE');
  const result=await fn(db);
  await db.query('COMMIT');
  return result;
 } catch(error) {
  await db.query('ROLLBACK').catch(()=>{broken=true;});
  throw error;
 } finally {db.release(broken);}
}
