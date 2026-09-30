import pg from 'pg';
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {prepareCandidate} from './preparation';

// Application-data recovery drill, not a physical PostgreSQL or production backup.
const original=new URL(process.env.DATABASE_URL??'');
if(process.env.APP_ENV!=='local'||!['127.0.0.1','localhost','[::1]'].includes(original.hostname))throw Error('LOCAL_SOURCE_REQUIRED');
const suffix=Date.now().toString(),names=['booking_recovery_migrate_'+suffix,'booking_recovery_restore_'+suffix];
const folder='.local/backups/saas-recovery-'+suffix;mkdirSync(folder,{recursive:true});
const keyFolder='.local/recovery-keys';mkdirSync(keyFolder,{recursive:true});
const migrationFiles=readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort();
const migrations=migrationFiles.map(name=>({name,sql:readFileSync('db/migrations/'+name,'utf8')}));
type Table={schema:string;name:string;columns:string[];rows:string[]};
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const source=new pg.Client({connectionString:original.toString()});
const adminURL=new URL(original);adminURL.pathname='/postgres';const admin=new pg.Client({connectionString:adminURL.toString()});
const report:Record<string,unknown>={source:'local application database',productionBackup:false,databases:names,keyFile:keyFolder+'/'+suffix+'.key'};
async function tables(db:pg.Client){return (await db.query("SELECT schemaname AS schema,tablename AS name FROM pg_tables WHERE schemaname IN ('booking','identity') ORDER BY schemaname,tablename")).rows as {schema:string;name:string}[];}
async function capture(db:pg.Client):Promise<Table[]>{const result:Table[]=[];for(const t of await tables(db)){
 const columns=(await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[t.schema,t.name])).rows.map(r=>r.column_name);
 const rows=(await db.query(`SELECT to_jsonb(t)::text AS row FROM ${quote(t.schema)}.${quote(t.name)} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);
 result.push({...t,columns,rows});}return result;}
function digest(data:Table[]){return createHash('sha256').update(JSON.stringify(data)).digest('hex');}
async function restore(name:string,data:Table[]){
 assert.deepEqual(snapshot.migrations,migrations.map(m=>({name:m.name,hash:createHash('sha256').update(m.sql).digest('hex')})),'MIGRATION_VERSION_CHANGED');
 assert.ok(names.includes(name)&&name!==original.pathname.slice(1));await admin.query(`CREATE DATABASE ${quote(name)}`);
 const url=new URL(original);url.pathname='/'+name;const db=new pg.Client({connectionString:url.toString()});await db.connect();
 try{await db.query("SET timezone='UTC'");for(const m of migrations)await db.query(m.sql);
 assert.deepEqual(await tables(db),data.map(({schema,name})=>({schema,name})),'RESTORE_SCHEMA_MISMATCH');
 await db.query('BEGIN');await db.query("SET LOCAL session_replication_role='replica'");
 await db.query('TRUNCATE '+data.map(t=>quote(t.schema)+'.'+quote(t.name)).join(',')+' CASCADE');
 for(const t of data){const target=quote(t.schema)+'.'+quote(t.name),cols=t.columns.map(quote).join(',');for(const row of t.rows)await db.query(`INSERT INTO ${target} (${cols}) SELECT ${cols} FROM json_populate_record(NULL::${target},$1::json)`,[row]);}
 await db.query("SET LOCAL session_replication_role='origin'");
 // Validate all restored references, including cyclic settings/member references.
 const fks=(await db.query("SELECT n.nspname schema,c.relname tab,k.conname name,pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE k.contype='f' AND n.nspname IN ('booking','identity')")).rows;
 for(const f of fks){const target=quote(f.schema)+'.'+quote(f.tab);await db.query(`ALTER TABLE ${target} DROP CONSTRAINT ${quote(f.name)}`);await db.query(`ALTER TABLE ${target} ADD CONSTRAINT ${quote(f.name)} ${f.definition}`);}
 for(const seq of snapshot.sequences)await db.query('SELECT setval($1::regclass,$2,$3)',[seq.name,seq.last_value,seq.is_called]);
 await db.query('COMMIT');assert.equal(digest(await capture(db)),snapshot.digest,'RESTORED_DATA_CHANGED');return db;
 }catch(e){await db.query('ROLLBACK').catch(()=>{});await db.end();throw e;}
}
let snapshot:{tables:Table[];digest:string;sequences:{name:string;last_value:string;is_called:boolean}[];migrations:{name:string;hash:string}[]};
try{
 await source.connect();await source.query("SET timezone='UTC'");await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const data=await capture(source);const sequences=[];
 for(const s of (await source.query("SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname IN ('booking','identity') ORDER BY schemaname,sequencename")).rows){const name=quote(s.schemaname)+'.'+quote(s.sequencename);const v=(await source.query(`SELECT last_value::text,is_called FROM ${name}`)).rows[0];sequences.push({name,...v});}
 snapshot={tables:data,digest:digest(data),sequences,migrations:migrations.map(m=>({name:m.name,hash:createHash('sha256').update(m.sql).digest('hex')}))};await source.query('COMMIT');
 const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(JSON.stringify(snapshot)),cipher.final()]);
 const encrypted=Buffer.concat([iv,cipher.getAuthTag(),body]);writeFileSync(folder+'/application-snapshot.enc',encrypted,{mode:0o600,flag:'wx'});writeFileSync(keyFolder+'/'+suffix+'.key',key.toString('hex'),{mode:0o600,flag:'wx'});
 function decrypt(bytes:Buffer){const d=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString());}
 const damaged=Buffer.from(encrypted);damaged[damaged.length-1]^=1;assert.throws(()=>decrypt(damaged));snapshot=decrypt(readFileSync(folder+'/application-snapshot.enc'));report.encryptionTamperRejected=true;
 await admin.connect();
 const migrated=await restore(names[0],snapshot.tables);
 try{await migrated.query('BEGIN');report.migration=await prepareCandidate(migrated);for(const f of ['002_web_runtime.sql','003_slack_workers.sql','004_shared_jobs.sql','005_lifecycle.sql'])await migrated.query(readFileSync('db/saas-preparation/'+f,'utf8'));await migrated.query('COMMIT');
 const own=(await migrated.query("SELECT count(*)::int n FROM saas_control.tenants t JOIN identity.legacy_owner l ON l.account_id=t.owner_account_id JOIN identity.accounts a ON a.id=l.account_id WHERE a.login_id='hyundai_1st'")).rows[0];assert.equal(own.n,1);report.ownerPreserved=true;
 }finally{await migrated.end();}
 // Recovery from the pre-change encrypted artifact into a second clean DB.
 const restored=await restore(names[1],snapshot.tables);try{assert.equal((await restored.query("SELECT to_regnamespace('saas_control') IS NULL absent")).rows[0].absent,true);report.recoveryFingerprintMatched=true;}finally{await restored.end();}
 report.tables=snapshot.tables.length;report.rows=snapshot.tables.reduce((n,t)=>n+t.rows.length,0);report.snapshotDigest=snapshot.digest;report.notificationProcessesStarted=false;
 writeFileSync(folder+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,artifactFolder:folder}));
}catch(e){console.error('RECOVERY_REHEARSAL_FAILED',(e as {code?:string}).code??(e instanceof assert.AssertionError?'assertion':'validation'));process.exitCode=1;}
finally{await source.end();await admin.end();}
