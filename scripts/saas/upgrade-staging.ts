import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import pg from 'pg';
import {checkRuntimeDatabases,runtimeConfiguration,runtimeFunctions} from './runtime-check';
// Local staging only; never uses or changes a Railway database.
const source=parseEnv(readFileSync('.env.local','utf8'));
const stage=parseEnv(readFileSync('.env.saas-staging.local','utf8'));
const root=new URL(source.DATABASE_URL??''),target=new URL(stage.DATABASE_URL??'');
if(source.APP_ENV!=='local'||stage.SAAS_STAGING!=='true'||!['localhost','127.0.0.1'].includes(root.hostname)||root.host!==target.host||!/^\/booking_saas_staging_[0-9]+$/.test(target.pathname))throw Error('ISOLATED_STAGING_REQUIRED');
root.pathname=target.pathname;const db=new pg.Client({connectionString:root.toString()});
try{
 await db.connect();await db.query('BEGIN');
 if(!(await db.query("SELECT to_regclass('saas_control.holiday_job') present")).rows[0].present)await db.query(readFileSync('db/saas-preparation/004_shared_jobs.sql','utf8'));
 if(!(await db.query("SELECT to_regclass('saas_control.exports') present")).rows[0].present)await db.query(readFileSync('db/saas-preparation/005_lifecycle.sql','utf8'));
 const connections=runtimeConfiguration(stage);
 for(let i=0;i<3;i++){
  const role=decodeURIComponent(new URL(connections[i]).username);
  if(!/^staging_(web|control|worker)_[0-9]+$/.test(role))throw Error('STAGING_ROLE_REQUIRED');
  for(const signature of runtimeFunctions[i])await db.query(`GRANT EXECUTE ON FUNCTION saas_control.${signature} TO "${role}"`);
 }
 await db.query('COMMIT');console.log(JSON.stringify(await checkRuntimeDatabases(connections)));
}catch{await db.query('ROLLBACK').catch(()=>{});console.error('STAGING_UPGRADE_FAILED');process.exitCode=1;}finally{await db.end();}
