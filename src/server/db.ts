import {Pool,types,type PoolClient} from 'pg';
types.setTypeParser(1184,v=>new Date(v).toISOString());
types.setTypeParser(1082,v=>v);
const globalDB=globalThis as unknown as {bookingPool?:Pool};
export function pool(){return globalDB.bookingPool??=new Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,options:'-c search_path=booking,public'});}
export type DB=PoolClient;
export async function transaction<T>(fn:(db:DB,now:Date)=>Promise<T>,testNow?:Date):Promise<T>{
 const db=await pool().connect();
 try{await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='10s'");await db.query('SELECT id FROM settings WHERE id=1 FOR UPDATE');const {rows}=await db.query('SELECT clock_timestamp() as now');
 const now=testNow??new Date(rows[0].now);const result=await fn(db,now);await db.query('COMMIT');return result;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
