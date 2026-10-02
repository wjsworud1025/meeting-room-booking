import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import pg from 'pg';
import {preflight,prepareCandidate,fingerprint,tenantTables} from '../scripts/saas/preparation';
import {tenantTransaction} from '../src/server/saas/tenant-transaction';
assert.equal(process.env.APP_ENV,'local');
const base=new URL(process.env.DATABASE_URL!);
assert.ok(['localhost','127.0.0.1','[::1]'].includes(base.hostname));
const suffix=process.pid+'_'+Date.now();
const name='booking_saas_test_'+suffix,role='booking_saas_test_'+suffix;
const adminURL=new URL(base);adminURL.pathname='/postgres';
const control=new pg.Client({connectionString:adminURL.toString()});
const testURL=new URL(base);testURL.pathname='/'+name;
const db=new pg.Client({connectionString:testURL.toString()});
let created=false,roleCreated=false;let runtime:pg.Pool|undefined;
const a=randomUUID(),cohort=randomUUID(),venue=randomUUID(),room=randomUUID(),student=randomUUID(),policy=randomUUID(),reservation=randomUUID();
async function denied(fn:()=>Promise<unknown>,code:string) {await assert.rejects(fn,(e:unknown)=>(e as {code?:string}).code===code);}
try {
 await control.connect();await control.query(`CREATE DATABASE "${name}"`);created=true;
 await db.connect();
 for(const f of readdirSync('db/migrations').filter(f=>f.endsWith('.sql')).sort()) await db.query(readFileSync('db/migrations/'+f,'utf8'));
 await assert.rejects(()=>preflight(db),/SAAS_SINGLE_ACTIVE_OWNER_REQUIRED/);
 await db.query("INSERT INTO members(id,email,display_name,role,status) VALUES($1,'owner@example.test','Owner','ADMIN','ACTIVE')",[a]);
 await db.query("INSERT INTO venues(id,name) VALUES($1,'Shared name')",[venue]);
 await db.query("INSERT INTO cohorts(id,name,starts_on,ends_on,venue_id) VALUES($1,'Class','2026-01-01','2027-12-31',$2)",[cohort,venue]);
 await db.query("INSERT INTO rooms(id,name,display_order,venue_id) VALUES($1,'Room',1,$2)",[room,venue]);
 await db.query("INSERT INTO members(id,email,display_name,role,status,cohort_id,slack_workspace_id,slack_user_id) VALUES($1,'student@example.test','Student','STUDENT','ACTIVE',$2,'TA','UA')",[student,cohort]);
 await db.query("INSERT INTO policy_versions(id,effective_on,rules_json,created_by) VALUES($1,'2026-01-01','{}',$2)",[policy,a]);
 await db.query(`INSERT INTO reservations(id,cohort_id,room_id,creator_id,organizer_id,policy_version_id,capacity_snapshot,minimum_snapshot,starts_at,ends_at,status,initial_deadline,create_request_key)
 VALUES($1,$2,$3,$4,$4,$5,4,2,'2026-10-01T18:00:00+09','2026-10-01T19:00:00+09','CONFIRMED',now(),'fixture')`,[reservation,cohort,room,student,policy]);
 await db.query("INSERT INTO reservation_members(reservation_id,member_id,invited_by,status) VALUES($1,$2,$2,'ACCEPTED')",[reservation,student]);
 await db.query("INSERT INTO slack_installations(team_id,team_name,app_id,bot_user_id,bot_token_encrypted) VALUES('TA','Class','APP','BOT','synthetic-ciphertext')");
 await db.query("INSERT INTO slack_workspace_classes(team_id,class_name,cohort_id,auto_enroll) VALUES('TA','Class',$1,true)",[cohort]);
 await db.query("INSERT INTO tasks(kind,dedupe_key,payload,recipient_id) VALUES('NOTIFY','same-key','{}',$1)",[student]);
 await db.query("INSERT INTO holiday_overrides(local_date,name,source_url,reason) VALUES('2026-10-01',NULL,'test','test')");
 await db.query("INSERT INTO audit_events(actor_id,action,entity_type,entity_id,decided_at,request_id,before_summary) VALUES($1,'fixture','reservation',$2,now(),'fixture','{\"preserve\":true}')",[a,reservation]);
 const original=await fingerprint(db);
 await db.query('BEGIN');await prepareCandidate(db);await db.query('ROLLBACK');
 assert.deepEqual(await fingerprint(db),original);await preflight(db);
 await db.query('BEGIN');const result=await prepareCandidate(db);await db.query('COMMIT');
 assert.equal(result.preserved,true);
 await assert.rejects(()=>prepareCandidate(db),/SAAS_ALREADY_PREPARED/);
 const tenantA=(await db.query('SELECT first_tenant_id FROM saas_control.preparation')).rows[0].first_tenant_id;
 const tenantB=randomUUID(),accountB=randomUUID(),ownerB=randomUUID(),venueB=randomUUID(),cohortB=randomUUID();
 await db.query('BEGIN');
 await db.query("INSERT INTO saas_control.accounts(id,display_name) VALUES($1,'Other owner')",[accountB]);
 await db.query("INSERT INTO saas_control.tenants(id,name,owner_account_id) VALUES($1,'B',$2)",[tenantB,accountB]);
 await db.query("INSERT INTO booking.members(id,tenant_id,account_id,email,display_name,role,status) VALUES($1,$2,$3,'owner@example.test','Other owner','ADMIN','ACTIVE')",[ownerB,tenantB,accountB]);
 await db.query('INSERT INTO booking.settings(id,tenant_id) VALUES(1,$1)',[tenantB]);
 await db.query("INSERT INTO booking.venues(id,tenant_id,name) VALUES($1,$2,'Shared name')",[venueB,tenantB]);
 await db.query("INSERT INTO booking.cohorts(id,tenant_id,name,starts_on,ends_on,venue_id) VALUES($1,$2,'B','2026-01-01','2027-12-31',$3)",[cohortB,tenantB,venueB]);
 await db.query("INSERT INTO booking.policy_versions(tenant_id,effective_on,rules_json) VALUES($1,'2026-01-01','{}')",[tenantB]);
 await db.query("INSERT INTO booking.tasks(tenant_id,kind,dedupe_key,payload) VALUES($1,'NOTIFY','same-key','{}')",[tenantB]);
 await db.query("INSERT INTO booking.holiday_overrides(tenant_id,local_date,name,source_url,reason) VALUES($1,'2026-10-01',NULL,'test','test')",[tenantB]);
 await db.query('COMMIT');
 await denied(()=>db.query("INSERT INTO booking.slack_installations(tenant_id,team_id,team_name,app_id,bot_user_id,bot_token_encrypted) VALUES($1,'TA','steal','APP','BOT','synthetic')",[tenantB]),'23505');
 await denied(()=>db.query('UPDATE booking.slack_workspace_classes SET tenant_id=$1 WHERE team_id=$2',[tenantB,'TA']),'23503');
 await denied(()=>db.query('UPDATE booking.rooms SET venue_id=$1 WHERE id=$2',[venueB,room]),'23503');
 await denied(()=>db.query('UPDATE saas_control.tenants SET owner_account_id=$1 WHERE id=$2',[accountB,tenantA]),'23505');
 await assert.rejects(()=>db.query('UPDATE booking.members SET account_id=NULL WHERE id=$1',[ownerB]),/SAAS_OWNER_MEMBER_MISMATCH/);
 const secret=randomUUID();
 await control.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${secret}'`);roleCreated=true;
 await db.query(`GRANT USAGE ON SCHEMA booking,saas_control TO "${role}"`);
 for(const table of tenantTables) await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON booking.${table} TO "${role}"`);
 await db.query(`GRANT EXECUTE ON FUNCTION saas_control.current_tenant() TO "${role}"`);
 const runtimeURL=new URL(testURL);runtimeURL.username=role;runtimeURL.password=secret;
 runtime=new pg.Pool({connectionString:runtimeURL.toString(),max:1});
 const run=<T>(id:string,fn:(c:pg.PoolClient)=>Promise<T>)=>tenantTransaction(runtime!,id,fn);
 assert.equal((await runtime.query('SELECT * FROM booking.rooms')).rowCount,0);
 await denied(()=>runtime!.query("INSERT INTO booking.venues(tenant_id,name) VALUES($1,'No context')",[tenantA]),'42501');
 for(const table of tenantTables) {
  assert.equal((await runtime.query(`SELECT * FROM booking.${table}`)).rowCount,0,table+' denies missing context');
 }
 await denied(()=>runtime!.query('SELECT * FROM saas_control.accounts'),'42501');
 await run(tenantA,async c=>{
  assert.equal((await c.query('SELECT * FROM booking.rooms WHERE id=$1',[room])).rowCount,1);
  assert.equal((await c.query('SELECT * FROM booking.venues WHERE id=$1',[venueB])).rowCount,0);
  assert.equal((await c.query("UPDATE booking.venues SET name='Forbidden' WHERE id=$1",[venueB])).rowCount,0);
 });
 await run(tenantB,async c=>assert.equal((await c.query('SELECT * FROM booking.reservations WHERE id=$1',[reservation])).rowCount,0));
 await denied(()=>run(tenantA,c=>c.query("INSERT INTO booking.venues(tenant_id,name) VALUES($1,'Cross tenant')",[tenantB])),'42501');
 await denied(()=>run(tenantA,c=>c.query('UPDATE booking.rooms SET tenant_id=$1 WHERE id=$2',[tenantB,room])),'42501');
 await denied(()=>run(tenantA,c=>c.query('UPDATE booking.rooms SET venue_id=$1 WHERE id=$2',[venueB,room])),'23503');
 await denied(()=>run(tenantA,c=>c.query("INSERT INTO booking.venues(name) VALUES('Missing tenant')")),'42501');
 await assert.rejects(()=>run(tenantA,async()=>{throw new Error('synthetic rollback');}),/synthetic rollback/);
 assert.equal((await runtime.query('SELECT * FROM booking.rooms')).rowCount,0,'pool context cleared');
 await run(tenantB,async c=>assert.equal((await c.query('SELECT * FROM booking.members')).rowCount,1));
 await db.query("UPDATE saas_control.tenants SET status='SUSPENDED' WHERE id=$1",[tenantB]);
 await assert.rejects(()=>run(tenantB,async()=>null),/TENANT_UNAVAILABLE/);
 // Prove B uses a separate settings lock while A is held.
 await db.query("UPDATE saas_control.tenants SET status='ACTIVE' WHERE id=$1",[tenantB]);
 await db.query('BEGIN');await db.query('SELECT * FROM booking.settings WHERE tenant_id=$1 FOR UPDATE',[tenantA]);
 await run(tenantB,async()=>null);await db.query('ROLLBACK');
 const unsafe=new pg.Pool({connectionString:testURL.toString()});
 try {await assert.rejects(()=>tenantTransaction(unsafe,tenantA,async()=>null),/UNSAFE_TENANT_DB_ROLE/);} finally {await unsafe.end();}
 console.log('PASS: legacy fingerprints and rollback; tenant FK/owner constraints; all 21 tables fail closed; A/B read-write isolation; pool reuse; suspended tenant; separate locks; privileged runtime rejected.');
} finally {
 await runtime?.end();await db.end().catch(()=>{});
 if(created) {assert.match(name,/^booking_saas_test_[0-9]+_[0-9]+$/);await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);}
 if(roleCreated) await control.query(`DROP ROLE "${role}"`);
 await control.end();
}
