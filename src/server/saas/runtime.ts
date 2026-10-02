import {basePool,controlPool,databaseContext} from '../db';
import {requireThat} from '../errors';
/** Internal only: caller resolves tenant through verified identity, never HTTP input. */
export async function withTenant<T>(tenantId:string,fn:()=>Promise<T>):Promise<T>{
 requireThat(!databaseContext.getStore(),'NESTED_TENANT','고객 컨텍스트 중첩은 허용하지 않습니다.',503);
 const db=await basePool().connect();let broken=false,accepting=true;
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const role=await db.query(`SELECT r.rolsuper OR r.rolbypassrls OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('booking','saas_control') AND pg_has_role(current_user,c.relowner,'MEMBER')) unsafe FROM pg_roles r WHERE rolname=current_user`);
  requireThat(role.rows[0]?.unsafe===false,'UNSAFE_DB_ROLE','SaaS 전용 DB 역할이 필요합니다.',503);
  await db.query("SELECT set_config('booking.tenant_id',$1,true)",[tenantId]);
  await db.query("SET LOCAL search_path=booking,public; SET LOCAL lock_timeout='10s'");
  requireThat((await db.query('SELECT 1 FROM settings WHERE tenant_id=$1',[tenantId])).rowCount===1,'NOT_FOUND','운영 공간을 찾을 수 없습니다.',404);
  // Existing modules own nested transactions. Keep them as savepoints inside this boundary.
  const nested:string[]=[];let sequence=0;
  const query=async(text:string,values?:unknown[])=>{
   requireThat(accepting,'CONTEXT_CLOSED','종료된 고객 컨텍스트입니다.',503);
   if(/^BEGIN(?:\s|$)/i.test(text)){const n='tenant_nested_'+ ++sequence;nested.push(n);return db.query('SAVEPOINT '+n);}
   if(/^COMMIT\s*;?$/i.test(text)){const n=nested.pop();requireThat(n,'TRANSACTION_STATE','트랜잭션 상태가 잘못되었습니다.',503);return db.query('RELEASE SAVEPOINT '+n);}
   if(/^ROLLBACK\s*;?$/i.test(text)){const n=nested.pop();requireThat(n,'TRANSACTION_STATE','트랜잭션 상태가 잘못되었습니다.',503);await db.query('ROLLBACK TO SAVEPOINT '+n);return db.query('RELEASE SAVEPOINT '+n);}
   return db.query(text,values);
  };
  const borrowed=new Proxy(db,{get(target,key){if(key==='query')return query;if(key==='release')return ()=>{};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const scoped=new Proxy(basePool(),{get(target,key){if(key==='query')return query;if(key==='connect')return async()=>{requireThat(accepting,'CONTEXT_CLOSED','종료된 고객 컨텍스트입니다.',503);return borrowed;};if(key==='end')return ()=>{throw Error('SCOPED_POOL_CLOSE_FORBIDDEN');};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const result=await databaseContext.run(scoped,fn);
  requireThat(nested.length===0,'TRANSACTION_STATE','종료되지 않은 트랜잭션이 있습니다.',503);
  accepting=false;const commit=await db.query('COMMIT');requireThat(commit.command==='COMMIT','TRANSACTION_ABORTED','요청을 완료하지 못했습니다.',503);return result;
 }catch(e){await db.query('ROLLBACK').catch(()=>{broken=true;});throw e;}finally{accepting=false;db.release(broken);}
}
export async function tenantForAccount(accountId:string){const r=await controlPool().query('SELECT * FROM saas_control.account_route($1)',[accountId]);requireThat(r.rows[0],'ACCOUNT_PENDING','운영 공간을 먼저 만들어 주세요.',403);return r.rows[0] as {tenant_id:string;member_id:string};}
