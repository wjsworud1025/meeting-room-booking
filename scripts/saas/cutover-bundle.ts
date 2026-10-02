import {readFileSync} from 'node:fs';
import {createHash,randomBytes,scryptSync} from 'node:crypto';
import {runtimeFunctions} from './runtime-check';
import {tenantTables} from './preparation';

/** Build only. The operator freezes all writers and verifies a fresh backup before executing. */
export function cutoverBundle(suffix:string){
 if(!/^[0-9]+$/.test(suffix))throw Error('INVALID_RELEASE_SUFFIX');
 const roles=['web','control','worker'].map(kind=>({name:`saas_${kind}_${suffix}`,password:randomBytes(32).toString('hex')}));
 const files=['db/migrations/016_login_accounts.sql',...['001_candidate','002_web_runtime','003_slack_workers','004_shared_jobs','005_lifecycle'].map(n=>'db/saas-preparation/'+n+'.sql')];
 const sources=files.map(name=>({name,sql:readFileSync(name,'utf8')}));
 const hashes=sources.map(s=>({name:s.name,sha256:createHash('sha256').update(s.sql).digest('hex')}));
 const salt=randomBytes(16).toString('hex'),passwordHash=salt+':'+scryptSync('1111',salt,64).toString('hex');
 const tables=[...tenantTables,'holiday_years'];
 const fp=(t:string)=>`SELECT '${t}' name,count(*)::integer n,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5((to_jsonb(x)-'tenant_id'-'account_id')::text) h FROM booking.${t} x) q`;
 let sql=`BEGIN;
 SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s';
 SELECT pg_advisory_xact_lock(930202601);
 DO $$ BEGIN
 IF to_regnamespace('saas_control') IS NOT NULL OR to_regnamespace('identity') IS NOT NULL THEN RAISE EXCEPTION 'CUTOVER_ALREADY_APPLIED_OR_PARTIAL'; END IF;
 IF (SELECT count(*) FROM public.booking_migrations)<>15 THEN RAISE EXCEPTION 'LEGACY_MIGRATION_COUNT_MISMATCH'; END IF;
 IF (SELECT count(*) FROM booking.members WHERE role='ADMIN' AND status<>'INACTIVE')<>1 THEN RAISE EXCEPTION 'OWNER_COUNT_MISMATCH'; END IF;
 END $$;
 LOCK TABLE ${tables.map(t=>'booking.'+t).join(',')} IN ACCESS EXCLUSIVE MODE;
 CREATE TEMP TABLE cutover_before ON COMMIT DROP AS ${tables.map(fp).join(' UNION ALL ')};
 ${sources[0].sql}
 INSERT INTO identity.accounts(login_id,password_hash,must_change_password,status) VALUES('hyundai_1st','${passwordHash}',true,'ACTIVE');
 INSERT INTO identity.legacy_owner(account_id,member_id) SELECT a.id,m.id FROM identity.accounts a CROSS JOIN booking.members m WHERE a.login_id='hyundai_1st' AND m.role='ADMIN' AND m.status='ACTIVE';
 ${sources.slice(1).map(s=>s.sql).join('\n')}
 CREATE TEMP TABLE cutover_after ON COMMIT DROP AS ${tables.map(fp).join(' UNION ALL ')};
 DO $$ BEGIN IF EXISTS(SELECT * FROM cutover_before EXCEPT SELECT * FROM cutover_after) OR EXISTS(SELECT * FROM cutover_after EXCEPT SELECT * FROM cutover_before) THEN RAISE EXCEPTION 'LEGACY_DATA_CHANGED'; END IF; END $$;
 INSERT INTO public.booking_migrations(name) VALUES('016_login_accounts.sql');
 CREATE TABLE saas_control.release_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
 REVOKE ALL ON saas_control.release_migrations FROM PUBLIC;
 ${hashes.map(h=>`INSERT INTO saas_control.release_migrations(name,sha256) VALUES('${h.name}','${h.sha256}');`).join('\n')}
 `;
 roles.forEach((r,i)=>{
  sql+=`CREATE ROLE "${r.name}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD '${r.password}';\nGRANT USAGE ON SCHEMA saas_control TO "${r.name}";\n`;
  for(const f of runtimeFunctions[i])sql+=`GRANT EXECUTE ON FUNCTION saas_control.${f} TO "${r.name}";\n`;
 });
 sql+=`GRANT USAGE ON SCHEMA booking TO "${roles[0].name}";\n`;
 for(const t of tenantTables)sql+=`GRANT SELECT,INSERT,UPDATE,DELETE ON booking.${t} TO "${roles[0].name}";\n`;
 sql+=`GRANT SELECT ON booking.holiday_years TO "${roles[0].name}";
 GRANT USAGE ON ALL SEQUENCES IN SCHEMA booking TO "${roles[0].name}";
 GRANT USAGE ON SCHEMA identity TO "${roles[1].name}";
 GRANT SELECT,INSERT,UPDATE,DELETE ON identity.accounts,identity.sessions TO "${roles[1].name}";
 GRANT SELECT ON identity.legacy_owner TO "${roles[1].name}";
 SELECT 'CUTOVER_VERIFIED:'||count(*) FROM cutover_after;
 COMMIT;`;
 return {sql,roles,hashes};
}
