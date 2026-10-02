import {readFileSync} from 'node:fs';
import type {ClientBase} from 'pg';
export const tenantTables = [
 'settings','venues','cohorts','rooms','policy_versions','opening_exceptions','members',
 'reservations','reservation_members','member_claims','reports','sanctions','audit_events',
 'command_receipts','tasks','holiday_overrides','holiday_sync','slack_installations',
 'slack_workspace_classes','slack_web_links','class_install_requests',
] as const;
const legacyTables = [...tenantTables,'holiday_years'].sort();
export async function preflight(db: ClientBase) {
 const {rows}=await db.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname='booking' ORDER BY tablename");
 if(JSON.stringify(rows.map(r=>r.tablename))!==JSON.stringify(legacyTables)) {
  const actual=rows.map(r=>r.tablename);
  // Only schema names; never include database row values in diagnostic output.
  throw new Error('SAAS_SCHEMA_INVENTORY_MISMATCH: missing='+legacyTables.filter(n=>!actual.includes(n)).join(',')+'; unexpected='+actual.filter(n=>!legacyTables.includes(n as typeof legacyTables[number])).join(','));
 }
 const prepared=await db.query("SELECT 1 FROM information_schema.schemata WHERE schema_name='saas_control'");
 if(prepared.rowCount) throw new Error('SAAS_ALREADY_PREPARED');
 const owners=await db.query("SELECT count(*) FILTER(WHERE status='ACTIVE')::int active,count(*)::int total FROM booking.members WHERE role='ADMIN' AND status<>'INACTIVE'");
 if(owners.rows[0].active!==1 || owners.rows[0].total!==1) throw new Error('SAAS_SINGLE_ACTIVE_OWNER_REQUIRED');
 const settings=await db.query('SELECT count(*)::int n FROM booking.settings WHERE id=1');
 if(settings.rows[0].n!==1) throw new Error('SAAS_SETTINGS_REQUIRED');
 return fingerprint(db);
}
// Compare all original columns, including IDs, encrypted tokens and JSON. Never log row content.
export async function fingerprint(db: ClientBase) {
 const result:Record<string,{count:number;digest:string}>= {};
 for(const table of legacyTables) {
  const {rows}=await db.query(`SELECT count(*)::int count,md5(COALESCE(string_agg(hash,'' ORDER BY hash),'')) digest
   FROM (SELECT md5((to_jsonb(t)-'tenant_id'-'account_id')::text) hash FROM booking.${table} t) s`);
  result[table]=rows[0];
 }
 return result;
}
export async function prepareCandidate(db:ClientBase) {
 await preflight(db);
 await db.query(`LOCK TABLE ${[...tenantTables,'holiday_years'].map(t=>'booking.'+t).join(',')} IN ACCESS EXCLUSIVE MODE`);
 const before=await fingerprint(db);
 await db.query(readFileSync(new URL('../../db/saas-preparation/001_candidate.sql',import.meta.url),'utf8'));
 const after=await fingerprint(db);
 if(JSON.stringify(before)!==JSON.stringify(after)) throw new Error('SAAS_LEGACY_DATA_CHANGED');
 for(const table of tenantTables) {
  const {rows}=await db.query(`SELECT count(*)::int n FROM booking.${table} WHERE tenant_id IS NULL OR tenant_id<>(SELECT first_tenant_id FROM saas_control.preparation)`);
  if(rows[0].n!==0) throw new Error('SAAS_BACKFILL_MISMATCH');
 }
 return {tables:tenantTables.length,rows:Object.values(before).reduce((n,v)=>n+v.count,0),preserved:true};
}
