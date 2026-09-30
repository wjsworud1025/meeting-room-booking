import {readFileSync,existsSync} from 'node:fs';
import {createDecipheriv} from 'node:crypto';
import pg from 'pg';
const path='deployment/initial-data.enc';
if(existsSync(path)){
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(29092027)');
  await db.query('CREATE TABLE IF NOT EXISTS public.booking_imports(id text PRIMARY KEY, imported_at timestamptz DEFAULT now())');
  if(!(await db.query("SELECT 1 FROM public.booking_imports WHERE id='railway-initial-v1'")).rowCount){
   if(!process.env.INITIAL_IMPORT_KEY)throw Error('Initial import key required');
   if((await db.query('SELECT 1 FROM booking.members LIMIT 1')).rowCount)throw Error('Target database is not empty; import refused');
   const b=readFileSync(path),dec=createDecipheriv('aes-256-gcm',Buffer.from(process.env.INITIAL_IMPORT_KEY,'hex'),b.subarray(0,12));dec.setAuthTag(b.subarray(12,28));
   const data=JSON.parse(Buffer.concat([dec.update(b.subarray(28)),dec.final()]).toString());
   // Fresh database only. Temporarily defer FK triggers for cyclic settings/member references.
   await db.query("SET LOCAL session_replication_role='replica'");
   await db.query('DELETE FROM booking.settings');
   await db.query('DELETE FROM booking.holiday_sync');
   for(const [table,rows] of Object.entries(data)){
    if(!/^[a-z_]+$/.test(table))throw Error('Invalid table');
    for(const row of rows){const columns=Object.keys(row);if(columns.some(c=>!/^[a-z_]+$/.test(c)))throw Error('Invalid column');
     await db.query(`INSERT INTO booking.${table} (${columns.map(c=>'"'+c+'"').join(',')}) SELECT ${columns.map(c=>'"'+c+'"').join(',')} FROM json_populate_record(NULL::booking.${table},$1::json)`,[JSON.stringify(row)]);
    }
   }
   await db.query("SET LOCAL session_replication_role='origin'");
   await db.query("SELECT setval('booking.holiday_override_version',GREATEST(COALESCE((SELECT max(version) FROM booking.holiday_overrides),0),1),true)");
   await db.query("INSERT INTO public.booking_imports(id) VALUES('railway-initial-v1')");
   console.log('Initial data import completed.');
  }
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw Error('Initial data import failed: '+(e.code??e.message));}finally{await db.end();}
}
