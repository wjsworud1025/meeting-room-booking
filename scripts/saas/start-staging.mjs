import {spawn} from 'node:child_process';
import pg from 'pg';

if(process.env.SAAS_STAGING!=='true'||process.env.SAAS_ENABLED!=='true'||process.env.APP_ENV!=='production')throw Error('STAGING_CONFIG_REQUIRED');
const base=new URL(process.env.APP_BASE_URL);
if(base.protocol!=='https:'||base.hostname.endsWith('.invalid')||base.origin!==process.env.APP_BASE_URL)throw Error('STAGING_HTTPS_ORIGIN_REQUIRED');
if(base.hostname==='booking-web-production-d872.up.railway.app')throw Error('PRODUCTION_HOST_FORBIDDEN');
const keys=['DATABASE_URL','CONTROL_DATABASE_URL','WORKER_DATABASE_URL'];
const urls=keys.map(k=>new URL(process.env[k]));
if(urls.some(u=>!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||!/^\/booking_saas_staging_\d+$/.test(u.pathname)))throw Error('ISOLATED_LOCAL_DATABASE_REQUIRED');
if(new Set(urls.map(u=>u.host+u.pathname)).size!==1||new Set(urls.map(u=>u.username)).size!==3)throw Error('THREE_DISTINCT_ROLES_REQUIRED');
for(let i=0;i<urls.length;i++){
 const client=new pg.Client({connectionString:urls[i].toString()});
 try{await client.connect();
 const {rows}=await client.query("SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user");
 if(!rows.length||Object.values(rows[0]).some(Boolean))throw Error('PRIVILEGED_RUNTIME_ROLE');
 if(i>0){const r=await client.query("SELECT has_table_privilege(current_user,c.oid,'SELECT') allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='booking' AND c.relname='members'");if(r.rows[0].allowed)throw Error('CONTROL_ROLE_CAN_READ_MEMBERS');}
 else {const r=await client.query('SELECT count(*)::int n FROM booking.members');if(r.rows[0].n!==0)throw Error('TENANT_CONTEXT_LEAK');}
 }finally{await client.end();}
}
if(process.env.SLACK_APP_ENABLED==='true'){
 for(const k of ['SLACK_APP_TOKEN','SLACK_APP_ID','SLACK_CLIENT_ID','SLACK_CLIENT_SECRET','SLACK_TOKEN_ENCRYPTION_KEY'])if(!process.env[k])throw Error('MISSING_'+k);
 if(process.env.SLACK_APP_ID==='A0C4QRGDJ0P')throw Error('PRODUCTION_SLACK_APP_FORBIDDEN');
}
// Schema preparation is an explicit separate command. Runtime roles never run migrations.
const children=[];let stopping=false;
function stop(code){if(stopping)return;stopping=true;process.exitCode=code;for(const c of children)c.kill('SIGTERM');setTimeout(()=>{for(const c of children)c.kill('SIGKILL');process.exit(code);},5000).unref();}
function start(args){const c=spawn(process.execPath,args,{stdio:'inherit',env:{...process.env,NODE_ENV:'production',MIGRATION_DATABASE_URL:''}});children.push(c);c.on('error',()=>{console.error('STAGING_PROCESS_START_FAILED');stop(1);});c.on('exit',code=>{if(!stopping)stop(code||1);});}
start(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',process.env.PORT||'3015']);
if(process.env.SLACK_APP_ENABLED==='true')start(['--import','tsx','src/slack/app.ts']);
process.on('SIGINT',()=>stop(0));process.on('SIGTERM',()=>stop(0));
