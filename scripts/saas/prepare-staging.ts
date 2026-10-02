import {randomBytes} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import pg from 'pg';
import {pool} from '../../src/server/db';
import {bindLegacyOwner} from '../../src/server/login-accounts';
import {defaultRules} from '../../src/server/policy';
import {prepareCandidate,tenantTables} from './preparation';

// Creates a new local-only database. Never migrates or copies the source database.
if(process.env.APP_ENV!=='local'||process.env.SAAS_ENABLED==='true')throw Error('LOCAL_SETUP_REQUIRED');
const original=new URL(process.env.DATABASE_URL!);
if(!['localhost','127.0.0.1','[::1]'].includes(original.hostname))throw Error('LOCAL_DATABASE_REQUIRED');
const output='.env.saas-staging.local';
if(existsSync(output))throw Error('STAGING_CONFIG_EXISTS: reuse the existing staging environment');
const suffix=Date.now().toString(),name='booking_saas_staging_'+suffix;
const roles=['staging_web_'+suffix,'staging_control_'+suffix,'staging_worker_'+suffix];
const passwords=roles.map(()=>randomBytes(32).toString('hex'));
const ownerPassword=randomBytes(24).toString('base64url');
const adminURL=new URL(original);adminURL.pathname='/postgres';
const admin=new pg.Client({connectionString:adminURL.toString()});
let db:pg.PoolClient|undefined;
try{
 await admin.connect();
 await admin.query(`CREATE DATABASE "${name}"`);
 const source=new URL(original);source.pathname='/'+name;process.env.DATABASE_URL=source.toString();
 for(const f of readdirSync('db/migrations').filter(f=>f.endsWith('.sql')).sort())await pool().query(readFileSync('db/migrations/'+f,'utf8'));
 await pool().query("INSERT INTO booking.members(email,display_name,role,status) VALUES('staging-owner@example.test','Staging Owner','ADMIN','ACTIVE')");
 await pool().query("INSERT INTO booking.policy_versions(effective_on,rules_json) VALUES('2000-01-01',$1)",[JSON.stringify({...defaultRules,rooms:{}})]);
 await bindLegacyOwner('staging_owner',ownerPassword);
 db=await pool().connect();await db.query('BEGIN');
 await prepareCandidate(db);
 for(const f of ['002_web_runtime.sql','003_slack_workers.sql','004_shared_jobs.sql','005_lifecycle.sql'])await db.query(readFileSync('db/saas-preparation/'+f,'utf8'));
 await db.query('COMMIT');
 for(let i=0;i<roles.length;i++)await admin.query(`CREATE ROLE "${roles[i]}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${passwords[i]}'`);
 await db.query(`GRANT USAGE ON SCHEMA booking,saas_control TO "${roles[0]}"`);
 for(const t of tenantTables)await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON booking.${t} TO "${roles[0]}"`);
 await db.query(`GRANT SELECT ON booking.holiday_years TO "${roles[0]}"`);
 await db.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA booking TO "${roles[0]}"`);
 await db.query(`GRANT EXECUTE ON FUNCTION saas_control.current_tenant(),saas_control.request_holidays(),saas_control.export_snapshot(uuid,uuid) TO "${roles[0]}"`);
 await db.query(`GRANT USAGE ON SCHEMA identity,saas_control TO "${roles[1]}"`);
 await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON identity.accounts,identity.sessions TO "${roles[1]}"`);
 await db.query(`GRANT SELECT ON identity.legacy_owner TO "${roles[1]}"`);
 await db.query(`GRANT EXECUTE ON FUNCTION saas_control.account_route(uuid),saas_control.create_space(uuid,text,jsonb) TO "${roles[1]}"`);
 await db.query(`GRANT EXECUTE ON FUNCTION saas_control.install_preview(text),saas_control.connect_install(text,text,text,text,text,text),saas_control.workspace_route(text),saas_control.web_link_route(text),saas_control.space_info(uuid),saas_control.space_action(uuid,text,jsonb),saas_control.download_export(uuid,uuid,integer) TO "${roles[1]}"`);
 await db.query(`GRANT USAGE ON SCHEMA saas_control TO "${roles[2]}"`);
 await db.query(`GRANT EXECUTE ON FUNCTION saas_control.claim_notification(),saas_control.delivery_allowed(uuid,uuid,uuid),saas_control.maintenance_tenants(),saas_control.claim_holidays(),saas_control.finish_holidays(uuid,integer,jsonb),saas_control.fail_holidays(uuid),saas_control.claim_export(),saas_control.finish_export(uuid,uuid,bytea),saas_control.purge_spaces(),saas_control.expire_lifecycle() TO "${roles[2]}"`);

 const connections=roles.map((r,i)=>{const u=new URL(source);u.username=r;u.password=passwords[i];return u.toString();});
 const config={APP_ENV:'production',SAAS_ENABLED:'true',SAAS_STAGING:'true',PORT:'3015',APP_BASE_URL:'https://replace-with-staging-host.invalid',DATABASE_URL:connections[0],CONTROL_DATABASE_URL:connections[1],WORKER_DATABASE_URL:connections[2],SESSION_SECRET:randomBytes(48).toString('hex'),SLACK_TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex'),SLACK_APP_ENABLED:'false',SLACK_INSTALL_ENABLED:'false',RUN_JOBS:'false',SLACK_APP_ID:'',SLACK_APP_TOKEN:'',SLACK_CLIENT_ID:'',SLACK_CLIENT_SECRET:''};
 writeFileSync(output,Object.entries(config).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{flag:'wx',mode:0o600});
 mkdirSync('.local',{recursive:true});
 writeFileSync('.local/saas-staging-access.json',JSON.stringify({database:name,roles,loginId:'staging_owner',initialPassword:ownerPassword,passwordChangeRequired:true},null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({ready:true,database:name,roles:3,productionDataCopied:false,config:output,credentials:'.local/saas-staging-access.json'}));
}catch(e){console.error('STAGING_SETUP_FAILED', (e as {code?:string}).code??'validation', 'Database retained for inspection: '+name);process.exitCode=1;}
finally{if(db)db.release();await pool().end();await admin.end();}
