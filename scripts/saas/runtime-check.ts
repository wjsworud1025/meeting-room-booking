import pg from 'pg';
import {tenantTables} from './preparation';

export const runtimeFunctions=[
 ['current_tenant()','request_holidays()','export_snapshot(uuid,uuid)'],
 ['account_route(uuid)','create_space(uuid,text,jsonb)','install_preview(text)','connect_install(text,text,text,text,text,text)','workspace_route(text)','web_link_route(text)','space_info(uuid)','space_action(uuid,text,jsonb)','download_export(uuid,uuid,integer)'],
 ['claim_notification()','delivery_allowed(uuid,uuid,uuid)','maintenance_tenants()','claim_holidays()','finish_holidays(uuid,integer,jsonb)','fail_holidays(uuid)','claim_export()','finish_export(uuid,uuid,bytea)','purge_spaces()','expire_lifecycle()'],
];
function fail(code:string):never{throw Error('SAAS_'+code);}
export function runtimeConfiguration(env:Record<string,string|undefined>){
 if(env.APP_ENV!=='production'||env.SAAS_ENABLED!=='true')fail('PRODUCTION_MODE_REQUIRED');
 for(const k of ['DATABASE_URL','CONTROL_DATABASE_URL','WORKER_DATABASE_URL','SESSION_SECRET','APP_BASE_URL'])if(!env[k])fail('MISSING_'+k);
 if(env.MIGRATION_DATABASE_URL||env.INITIAL_ADMIN_PASSWORD)fail('MIGRATION_CREDENTIALS_FORBIDDEN');
 if(env.LAN_TEST_HOST||env.SLACK_TEST_ENV==='true')fail('TEST_CONFIGURATION_FORBIDDEN');
 let base:URL;try{base=new URL(env.APP_BASE_URL!);}catch{fail('INVALID_ORIGIN');}
 if(base.protocol!=='https:'||base.origin!==env.APP_BASE_URL||base.username||base.password)fail('HTTPS_ORIGIN_REQUIRED');
 if(env.SLACK_WEB_BASE_URL&&env.SLACK_WEB_BASE_URL!==base.origin)fail('SLACK_ORIGIN_MISMATCH');
 if(env.SESSION_SECRET!.length<32)fail('SESSION_SECRET_TOO_SHORT');
 if(!['true','false'].includes(env.RUN_JOBS??''))fail('EXPLICIT_JOB_MODE_REQUIRED');
 // Enable only after independent deletion-ledger retention and backup expiry are verified.
 if(env.SAAS_DELETION_ENABLED==='true')fail('DELETION_RETENTION_NOT_READY');
 if(env.SLACK_APP_ENABLED==='true'||env.SLACK_INSTALL_ENABLED==='true'){
  for(const k of ['SLACK_APP_ID','SLACK_CLIENT_ID','SLACK_CLIENT_SECRET','SLACK_TOKEN_ENCRYPTION_KEY'])if(!env[k])fail('MISSING_'+k);
  if(env.SLACK_APP_ENABLED==='true'&&!env.SLACK_APP_TOKEN)fail('MISSING_SLACK_APP_TOKEN');
 }
 let urls:URL[];try{urls=['DATABASE_URL','CONTROL_DATABASE_URL','WORKER_DATABASE_URL'].map(k=>new URL(env[k]!));}catch{fail('INVALID_DATABASE_URL');}
 if(urls.some(u=>!['postgres:','postgresql:'].includes(u.protocol)||!u.username||!u.password||u.pathname==='/'))fail('INVALID_DATABASE_URL');
 if(new Set(urls.map(u=>u.host+u.pathname)).size!==1||new Set(urls.map(u=>decodeURIComponent(u.username))).size!==3)fail('DISTINCT_ROLES_SAME_DATABASE_REQUIRED');
 return urls.map(u=>u.toString());
}
/** Catalog/read-only inspection only. Never claims tasks or mutates customer data. */
export async function checkRuntimeDatabases(connections:string[]){
 if(connections.length!==3)fail('THREE_CONNECTIONS_REQUIRED');
 const actualRoles:string[]=[];
 for(let index=0;index<3;index++){
  const db=new pg.Client({connectionString:connections[index],connectionTimeoutMillis:5000,query_timeout:10000});
  try{
   await db.connect();await db.query('BEGIN READ ONLY');await db.query("SET LOCAL statement_timeout='8s'");
   const role=(await db.query(`SELECT current_user name, EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER') AND (r.rolname<>current_user OR r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)) unsafe`)).rows[0];
   if(role.unsafe)fail('PRIVILEGED_ROLE');actualRoles.push(role.name);
   const owned=await db.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('booking','identity','saas_control') AND pg_has_role(current_user,c.relowner,'MEMBER') LIMIT 1`);
   if(owned.rowCount)fail('OWNER_MEMBERSHIP');
   if((await db.query("SELECT has_database_privilege(current_user,current_database(),'CREATE') allowed")).rows[0].allowed)fail('DATABASE_CREATE_PRIVILEGE');
   const schemas=(await db.query(`SELECT nspname,has_schema_privilege(current_user,oid,'CREATE') writable FROM pg_namespace WHERE nspname IN ('booking','identity','saas_control','public')`)).rows;
   if(schemas.length!==4||schemas.some(r=>r.writable))fail('SCHEMA_PRIVILEGES');
   const tables=(await db.query(`SELECT c.oid,n.nspname schema,c.relname name,c.relrowsecurity rls,c.relforcerowsecurity forced FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('booking','identity','saas_control') AND c.relkind IN ('r','p','v','m','f')`)).rows;
   for(const name of [...tenantTables,'holiday_years'])if(!tables.some(t=>t.schema==='booking'&&t.name===name))fail('MISSING_TABLE');
   for(const name of ['accounts','sessions','legacy_owner'])if(!tables.some(t=>t.schema==='identity'&&t.name===name))fail('MISSING_IDENTITY');
   for(const t of tables){
    const tenant=t.schema==='booking'&&tenantTables.some(n=>n===t.name);
    if(tenant&&(!t.rls||!t.forced))fail('RLS_NOT_FORCED');
    for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']){
     const expected=index===0&&t.schema==='booking'&&(tenant?['SELECT','INSERT','UPDATE','DELETE'].includes(privilege):t.name==='holiday_years'&&privilege==='SELECT')||index===1&&t.schema==='identity'&&(['accounts','sessions'].includes(t.name)?['SELECT','INSERT','UPDATE','DELETE'].includes(privilege):t.name==='legacy_owner'&&privilege==='SELECT');
     const actual=(await db.query('SELECT has_table_privilege(current_user,$1::oid,$2) allowed',[t.oid,privilege])).rows[0].allowed;
     if(actual!==expected)fail('TABLE_PRIVILEGES');
     if(!expected&&['SELECT','INSERT','UPDATE','REFERENCES'].includes(privilege)&&(await db.query('SELECT has_any_column_privilege(current_user,$1::oid,$2) allowed',[t.oid,privilege])).rows[0].allowed)fail('COLUMN_PRIVILEGES');
    }
   }
   const sequences=(await db.query("SELECT c.oid,n.nspname schema FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname IN ('booking','identity','saas_control')")).rows;
   for(const seq of sequences)for(const privilege of ['USAGE','SELECT','UPDATE']){
    const actual=(await db.query('SELECT has_sequence_privilege(current_user,$1::oid,$2) allowed',[seq.oid,privilege])).rows[0].allowed;
    if(actual!==(index===0&&seq.schema==='booking'&&privilege==='USAGE'))fail('SEQUENCE_PRIVILEGES');
   }
   const catalog=(await db.query(`SELECT p.oid,p.oid::regprocedure::text signature,p.prosecdef,p.proconfig,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='saas_control'`)).rows;
   for(const signature of runtimeFunctions.flat())if(!catalog.some(f=>f.signature==='saas_control.'+signature))fail('MISSING_FUNCTION');
   for(const f of catalog){
    if(f.public_execute||f.prosecdef&&(!f.proconfig?.some((s:string)=>s.startsWith('search_path='))||f.proconfig.filter((s:string)=>s.startsWith('search_path=')).some((s:string)=>s.slice(12).split(',').some(v=>!['pg_catalog','saas_control'].includes(v.trim())))))fail('FUNCTION_SECURITY');
    const expected=runtimeFunctions[index].some(s=>f.signature==='saas_control.'+s);
    if((await db.query("SELECT has_function_privilege(current_user,$1::oid,'EXECUTE') allowed",[f.oid])).rows[0].allowed!==expected)fail('FUNCTION_PRIVILEGES');
   }
   if(index===0){
    if((await db.query("SELECT NULLIF(current_setting('booking.tenant_id',true),'') tenant")).rows[0].tenant)fail('DEFAULT_TENANT_CONTEXT');
    for(const t of tenantTables)if((await db.query(`SELECT EXISTS(SELECT 1 FROM booking.${t}) visible`)).rows[0].visible)fail('TENANT_CONTEXT_LEAK');
   }
   await db.query('ROLLBACK');
  }finally{await db.end().catch(()=>{});}
 }
 if(new Set(actualRoles).size!==3)fail('DISTINCT_ROLES_REQUIRED');
 return {roles:3,tenantTables:tenantTables.length,readOnly:true};
}
