import pg from 'pg';
import {readdirSync,readFileSync} from 'node:fs';
const c=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});await c.connect();
await c.query('CREATE TABLE IF NOT EXISTS public.booking_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
for(const name of readdirSync('db/migrations').filter(x=>x.endsWith('.sql')).sort()){
 await c.query('BEGIN');
 try{
  await c.query("SELECT pg_advisory_xact_lock(29092026)");
  if(!(await c.query('SELECT 1 FROM public.booking_migrations WHERE name=$1',[name])).rowCount){
   await c.query(readFileSync('db/migrations/'+name,'utf8'));
   await c.query('INSERT INTO public.booking_migrations(name) VALUES($1)',[name]);console.log('Applied',name);
  }
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}
}
if(process.env.APP_ENV==='local'){
 await c.query(`CREATE SCHEMA IF NOT EXISTS local_auth;
 CREATE TABLE IF NOT EXISTS local_auth.challenges(email text PRIMARY KEY, code_hash text NOT NULL,expires_at timestamptz NOT NULL,attempts integer NOT NULL DEFAULT 0,requested_at timestamptz NOT NULL);
 CREATE TABLE IF NOT EXISTS local_auth.mailbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),recipient text NOT NULL,subject text NOT NULL,body text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
 REVOKE ALL ON SCHEMA local_auth FROM PUBLIC;`);
}
await c.end();
