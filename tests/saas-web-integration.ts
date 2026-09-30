import {reapplyDeletionLedger} from '../scripts/saas/deletion-replay';
import {tickExports} from '../src/server/saas/lifecycle';
import {unzipSync,strFromU8} from 'fflate';
import {installRuntimeRoles} from '../scripts/saas/runtime-roles';
import {tickSharedHolidays,retireLegacyTasks} from '../src/server/saas/shared-jobs';
import {holidayYear} from '../src/server/holidays';
import {checkRuntimeDatabases} from '../scripts/saas/runtime-check';
import {importRoster} from '../src/server/workspace-roster';
import {connectInstallRequest,readInstallRequest} from '../src/server/class-install';
import {deliverNextNotification} from '../src/server/saas/worker';
import {runTask} from '../src/server/jobs';
import {queue} from '../src/server/store';
import {inWorkspace} from '../src/server/saas/slack-routing';
import {execute} from '../src/server/commands';
import {localDate,addDays,at} from '../src/shared/time';
import type {Session} from '../src/shared/types';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import pg from 'pg';
import {NextRequest} from 'next/server';
import {pool,basePool,controlPool,schedulerPool} from '../src/server/db';
import {bindLegacyOwner} from '../src/server/login-accounts';
import {prepareCandidate,tenantTables} from '../scripts/saas/preparation';
import {GET,POST} from '../src/app/api/[...path]/route';
import {defaultRules} from '../src/server/policy';
import {withTenant,tenantForAccount} from '../src/server/saas/runtime';
assert.equal(process.env.APP_ENV,'local');
const original=new URL(process.env.DATABASE_URL!);assert.ok(['127.0.0.1','localhost','[::1]'].includes(original.hostname));
const suffix=process.pid+'_'+Date.now(),name='booking_web_test_'+suffix;
const roles=['saas_web_'+suffix,'saas_control_'+suffix,'saas_worker_'+suffix];
const cURL=new URL(original);cURL.pathname='/postgres';const control=new pg.Client({connectionString:cURL.toString()});
await control.connect();await control.query(`CREATE DATABASE "${name}"`);
const url=new URL(original);url.pathname='/'+name;process.env.DATABASE_URL=url.toString();process.env.APP_BASE_URL='http://localhost:3015';
let db:pg.PoolClient|undefined;let rolesMade=false;
const globalDB=globalThis as unknown as {bookingPool?:pg.Pool;bookingControlPool?:pg.Pool;bookingSchedulerPool?:pg.Pool};
async function request(path:string,token?:string,body?:unknown){const req=new NextRequest('http://localhost:3015/api/'+path,{method:body===undefined?'GET':'POST',headers:{origin:'http://localhost:3015','content-type':'application/json',...(token?{cookie:'booking-account='+token}:{}),'idempotency-key':randomUUID()},body:body===undefined?undefined:JSON.stringify(body)});return body===undefined?GET(req):POST(req);}
async function ok(path:string,token?:string,body?:unknown){const r=await request(path,token,body);const json=await r.json();assert.ok(r.status<300,JSON.stringify({path,status:r.status,json}));return {response:r,data:json.data};}
try{
 for(const f of readdirSync('db/migrations').filter(f=>f.endsWith('.sql')).sort())await pool().query(readFileSync('db/migrations/'+f,'utf8'));
 await pool().query("INSERT INTO booking.members(email,display_name,role,status) VALUES('owner@example.test','Original','ADMIN','ACTIVE')");
 await pool().query("INSERT INTO booking.policy_versions(effective_on,rules_json) VALUES('2000-01-01',$1)",[JSON.stringify({...defaultRules,rooms:{}})]);
 await bindLegacyOwner('hyundai_1st','initial-test-password');
 await pool().query('UPDATE identity.accounts SET must_change_password=false');
 db=await pool().connect();await db.query('BEGIN');await prepareCandidate(db);await db.query(readFileSync('db/saas-preparation/002_web_runtime.sql','utf8'));await db.query(readFileSync('db/saas-preparation/003_slack_workers.sql','utf8'));await db.query(readFileSync('db/saas-preparation/004_shared_jobs.sql','utf8'));await db.query(readFileSync('db/saas-preparation/005_lifecycle.sql','utf8'));await db.query('COMMIT');
 await db.query('BEGIN');const installed=await installRuntimeRoles(db,roles);await db.query('COMMIT');rolesMade=true;
 db.release();db=undefined;await pool().end();delete globalDB.bookingPool;
 const runtimeURL=new URL(url);runtimeURL.username=roles[0];runtimeURL.password=installed[0].password;
 const identityURL=new URL(url);identityURL.username=roles[1];identityURL.password=installed[1].password;
 const schedulerURL=new URL(url);schedulerURL.username=roles[2];schedulerURL.password=installed[2].password;process.env.WORKER_DATABASE_URL=schedulerURL.toString();
 process.env.DATABASE_URL=runtimeURL.toString();process.env.CONTROL_DATABASE_URL=identityURL.toString();process.env.SAAS_ENABLED='true';
 const runtimeConnections=[runtimeURL.toString(),identityURL.toString(),schedulerURL.toString()];
 assert.equal((await checkRuntimeDatabases(runtimeConnections)).roles,3);
 const guardAdmin=new pg.Client({connectionString:url.toString()});await guardAdmin.connect();
 try{
  await guardAdmin.query(`GRANT SELECT ON booking.members TO "${roles[1]}"`);
  await assert.rejects(()=>checkRuntimeDatabases(runtimeConnections),/SAAS_TABLE_PRIVILEGES/);
  await guardAdmin.query(`REVOKE SELECT ON booking.members FROM "${roles[1]}"`);
  await guardAdmin.query('ALTER TABLE booking.members NO FORCE ROW LEVEL SECURITY');
  await assert.rejects(()=>checkRuntimeDatabases(runtimeConnections),/SAAS_RLS_NOT_FORCED/);
  await guardAdmin.query('ALTER TABLE booking.members FORCE ROW LEVEL SECURITY');
  await guardAdmin.query(`REVOKE EXECUTE ON FUNCTION saas_control.claim_notification() FROM "${roles[2]}"`);
  await assert.rejects(()=>checkRuntimeDatabases(runtimeConnections),/SAAS_FUNCTION_PRIVILEGES/);
  await guardAdmin.query(`GRANT EXECUTE ON FUNCTION saas_control.claim_notification() TO "${roles[2]}"`);
  await guardAdmin.query(`GRANT "${roles[0]}" TO "${roles[1]}"`);
  await assert.rejects(()=>checkRuntimeDatabases(runtimeConnections),/SAAS_PRIVILEGED_ROLE/);
  await guardAdmin.query(`REVOKE "${roles[0]}" FROM "${roles[1]}"`);
  assert.equal((await checkRuntimeDatabases(runtimeConnections)).tenantTables,21);
 }finally{await guardAdmin.end();}
 console.log('RUNTIME GUARD PASS: valid roles accepted; excess read, RLS disabled, missing function grant and role membership rejected.');
 assert.throws(()=>pool(),/TENANT_CONTEXT_REQUIRED/);
 const a=(await ok('auth/account/login',undefined,{loginId:'hyundai_1st',password:'initial-test-password'})).response.cookies.get('booking-account')!.value;
 await ok('auth/account/register',undefined,{loginId:'customer_b',password:'customer-password'});
 const b=(await ok('auth/account/login',undefined,{loginId:'customer_b',password:'customer-password'})).response.cookies.get('booking-account')!.value;
 assert.equal((await request('admin/data',b)).status,403);
 await ok('auth/account/space',b,{name:'Customer B'});await ok('auth/account/space',b,{name:'Retry does not create another'});
 const av=await ok('admin/data?section=settings',a),bv=await ok('admin/data?section=settings',b);
 assert.equal(bv.data.venues.length,1);assert.notEqual(av.data.venues[0].id,bv.data.venues[0].id);
 const roomA=(await ok('commands',a,{name:'admin.room.add',input:{name:'A only',venueId:av.data.venues[0].id,capacity:4,minimum:2,reason:'test'}})).data.id;
 const roomB=(await ok('commands',b,{name:'admin.room.add',input:{name:'B only',venueId:bv.data.venues[0].id,capacity:4,minimum:2,reason:'test'}})).data.id;
 const sa=(await ok('snapshot',a)).data,sb=(await ok('snapshot',b)).data;
 await ok('commands',a,{name:'admin.policy',input:{effectiveOn:'2099-01-01',rules:{...defaultRules,rooms:{[roomA]:{capacity:4,minimum:2}}}}});
 assert.equal(sa.me.login_id,'hyundai_1st','Sidebar identity must use authenticated login ID, not the legacy member display name');
 assert.deepEqual(sa.rooms.map((r:{id:string})=>r.id),[roomA]);assert.deepEqual(sb.rooms.map((r:{id:string})=>r.id),[roomB]);
 const forbidden=await request('commands',b,{name:'admin.room.rename',input:{id:roomA,name:'stolen',reason:'test'}});assert.ok(forbidden.status>=400);
 assert.equal((await ok('snapshot',a)).data.rooms[0].name,'A only');
 const tenantA=await tenantForAccount((await controlPool().query("SELECT id FROM identity.accounts WHERE login_id='hyundai_1st'")).rows[0].id);
 const tenantB=await tenantForAccount((await controlPool().query("SELECT id FROM identity.accounts WHERE login_id='customer_b'")).rows[0].id);
 const holidayOps=new pg.Client({connectionString:url.toString()});await holidayOps.connect();
 const previousHolidayKey=process.env.HOLIDAY_API_KEY;process.env.HOLIDAY_API_KEY='synthetic-only';
 try{
  const year=Number(localDate(new Date()).slice(0,4));const date=`${year}-12-01`;
  await withTenant(tenantA.tenant_id,()=>pool().query("INSERT INTO holiday_overrides(local_date,name,source_url,reason,updated_by) VALUES($1,'A override','https://example.test','test',$2)",[date,tenantA.member_id]));
  let requests=0;
  const holidayFetch:typeof fetch=async input=>{
   requests++;const y=new URL(String(input)).searchParams.get('solYear');
   const item=Array.from({length:10},(_,i)=>({locdate:`${y}12${String(i+1).padStart(2,'0')}`,dateName:'Fixture holiday',isHoliday:'Y'}));
   return new Response(JSON.stringify({response:{header:{resultCode:'00'},body:{totalCount:10,items:{item}}}}));
  };
  const outcomes=await Promise.all([tickSharedHolidays(holidayFetch),tickSharedHolidays(holidayFetch)]);
  assert.equal(outcomes.filter(Boolean).length,1);assert.equal(requests,2);
  for(const [t,expected] of [[tenantA,'A override'],[tenantB,'Fixture holiday']] as const)await withTenant(t.tenant_id,async()=>{const d=await pool().connect();try{assert.equal((await holidayYear(d,year)).days[date],expected);}finally{d.release();}});
  await assert.rejects(()=>schedulerPool().query('SELECT * FROM saas_control.holiday_job'),{code:'42501'});
  await holidayOps.query("UPDATE saas_control.holiday_job SET next_run_at=now()-interval '1 minute'");
  const oldLease=(await schedulerPool().query('SELECT saas_control.claim_holidays() token')).rows[0].token;
  await holidayOps.query("UPDATE saas_control.holiday_job SET lease_until=now()-interval '1 second'");
  const newLease=(await schedulerPool().query('SELECT saas_control.claim_holidays() token')).rows[0].token;
  assert.notEqual(oldLease,newLease);assert.equal((await schedulerPool().query('SELECT saas_control.fail_holidays($1) result',[oldLease])).rows[0].result,false);
  assert.equal((await schedulerPool().query('SELECT saas_control.fail_holidays($1) result',[newLease])).rows[0].result,true);
  await holidayOps.query("UPDATE saas_control.holiday_job SET next_run_at=now()-interval '1 minute'");
  assert.equal(await tickSharedHolidays(async()=>new Response('provider failure',{status:503})),false);
  assert.equal((await holidayOps.query('SELECT count(*)::int n FROM booking.holiday_years')).rows[0].n,2);
  await withTenant(tenantA.tenant_id,async()=>{const d=await pool().connect();try{await queue(d,'MEMBER_PROVISION','legacy-provision',{memberId:tenantA.member_id,role:'ADMIN'});await queue(d,'HOLIDAY_SYNC','legacy-holiday',{year:String(year)});}finally{d.release();}await retireLegacyTasks();});
  assert.equal((await holidayOps.query("SELECT status FROM booking.tasks WHERE dedupe_key='legacy-provision'")).rows[0].status,'FAILED');
  assert.equal((await holidayOps.query("SELECT status FROM booking.tasks WHERE dedupe_key='legacy-holiday'")).rows[0].status,'DONE');
  assert.equal((await request('commands',a,{name:'admin.student.register',input:{}})).status,409);
 }finally{if(previousHolidayKey===undefined)delete process.env.HOLIDAY_API_KEY;else process.env.HOLIDAY_API_KEY=previousHolidayKey;await holidayOps.end();}
 console.log('SHARED JOBS PASS: one global lease, A/B overrides preserved, stale lease rejected, failed provider retains cache, legacy provisioning disabled.');

 const studentsA=[randomUUID(),randomUUID()],studentsB=[randomUUID(),randomUUID()];
 const fixture=new pg.Client({connectionString:url.toString()});await fixture.connect();
 const date=addDays(localDate(),1);
 try {
  for(const [route,students,venue] of [[tenantA,studentsA,av.data.venues[0].id],[tenantB,studentsB,bv.data.venues[0].id]] as const){
   const cohort=randomUUID();
   await fixture.query("INSERT INTO booking.cohorts(id,tenant_id,name,starts_on,ends_on,venue_id) VALUES($1,$2,'Fixture','2020-01-01','9999-12-31',$3)",[cohort,route.tenant_id,venue]);
   for(let i=0;i<students.length;i++)await fixture.query("INSERT INTO booking.members(id,tenant_id,cohort_id,email,display_name,role,status) VALUES($1,$2,$3,$4,'Learner','STUDENT','ACTIVE')",[students[i],route.tenant_id,cohort,'learner'+i+'@example.test']);
   await fixture.query("UPDATE booking.policy_versions SET rules_json=jsonb_set(rules_json,'{weekdays}','[0,1,2,3,4,5,6]') WHERE tenant_id=$1",[route.tenant_id]);
   await fixture.query("INSERT INTO booking.holiday_overrides(tenant_id,local_date,name,source_url,reason) VALUES($1,$2,NULL,'fixture','fixture')",[route.tenant_id,date]);
  }
 }finally{await fixture.end();}
 const session=(id:string):Session=>({memberId:id,accessVersion:1,verifiedAt:Date.now(),expiresAt:Date.now()+3600000,sessionId:randomUUID()});
 const bookingInput={roomId:roomA,startsAt:at(date,'18:00').toISOString(),endsAt:at(date,'19:00').toISOString(),inviteeIds:[studentsA[1]]};
 const booked=await withTenant(tenantA.tenant_id,()=>execute(session(studentsA[0]),'booking.create',bookingInput,randomUUID()));
 assert.equal(booked.status,200,JSON.stringify(booked.error));const bookingId=(booked.data as {id:string}).id;
 assert.equal((await request('reservations/'+bookingId,b)).status,404);
 assert.equal((await request('reservations/'+bookingId,a)).status,200);
 const cross=await withTenant(tenantA.tenant_id,()=>execute(session(studentsA[0]),'booking.create',{...bookingInput,roomId:roomB},randomUUID()));assert.notEqual(cross.status,200);
 const crossMember=await withTenant(tenantA.tenant_id,()=>execute(session(studentsA[0]),'booking.invite',{id:bookingId,expectedVersion:1,inviteeIds:[studentsB[0]]},randomUUID()));assert.notEqual(crossMember.status,200);
 await withTenant(tenantA.tenant_id,async()=>assert.ok((await pool().query('SELECT * FROM tasks')).rowCount!>0));
 await withTenant(tenantB.tenant_id,async()=>assert.equal((await pool().query('SELECT * FROM tasks')).rowCount,0));
 // Symmetric dummy bookings: the same time and learner emails must work independently.
 const bookedB=await withTenant(tenantB.tenant_id,()=>execute(session(studentsB[0]),'booking.create',{...bookingInput,roomId:roomB,inviteeIds:[studentsB[1]]},randomUUID()));
 assert.equal(bookedB.status,200,JSON.stringify(bookedB.error));const bookingB=(bookedB.data as {id:string}).id;
 assert.equal((await request('reservations/'+bookingB,a)).status,404);
 assert.equal((await request('reservations/'+bookingB,b)).status,200);
 for(const [token,own,other,ownStudents,otherStudents] of [[a,bookingId,bookingB,studentsA,studentsB],[b,bookingB,bookingId,studentsB,studentsA]] as const){
  const view=(await ok('snapshot?date='+date,token)).data;
  assert.ok(view.reservations.some((r:{id:string})=>r.id===own));
  assert.ok(!view.reservations.some((r:{id:string})=>r.id===other));
  assert.deepEqual(view.students.map((m:{id:string})=>m.id).sort(),[...ownStudents].sort());
  const all=(await ok('admin/data',token)).data;
  assert.ok(!JSON.stringify(all).includes(other));
  for(const id of otherStudents)assert.ok(!JSON.stringify(all).includes(id));
 }
 // User-supplied customer hints cannot switch the authenticated customer.
 const forged=(await ok('snapshot?date='+date+'&tenant_id='+tenantA.tenant_id,b)).data;
 assert.deepEqual(forged.rooms.map((r:{id:string})=>r.id),[roomB]);
 for(let i=0;i<10;i++){
  const [left,right]=await Promise.all([ok('snapshot?date='+date,a),ok('snapshot?date='+date,b)]);
  assert.deepEqual(left.data.rooms.map((r:{id:string})=>r.id),[roomA]);
  assert.deepEqual(right.data.rooms.map((r:{id:string})=>r.id),[roomB]);
 }
 for(const [tenant,own,other] of [[tenantA,bookingId,bookingB],[tenantB,bookingB,bookingId]] as const){
  await withTenant(tenant.tenant_id,async()=>{
   const tasks=(await pool().query('SELECT payload FROM tasks')).rows;
   assert.ok(tasks.some(t=>t.payload.reservationId===own));
   assert.ok(!tasks.some(t=>t.payload.reservationId===other));
   assert.equal((await pool().query('DELETE FROM reservations WHERE id=$1',[other])).rowCount,0);
  });
 }
 console.log('DUMMY CHECK PASS: 2 customers, 2 rooms, 4 learners (matching emails), 2 simultaneous bookings; bidirectional detail/list/member/audit/task isolation; tenant hint forgery; 20 concurrent snapshot requests; cross-delete denied.');
 const unknown=randomUUID();assert.equal((await request('reservations/'+unknown,a)).status,404);
 const account=(await controlPool().query("SELECT id FROM identity.accounts WHERE login_id='customer_b'")).rows[0];
 const route=await tenantForAccount(account.id);
 await assert.rejects(()=>withTenant(route.tenant_id,()=>pool().query('SELECT * FROM identity.accounts')),{code:'42501'});
 const escaped=await withTenant(route.tenant_id,async()=>pool());
 await assert.rejects(()=>escaped.query('SELECT * FROM booking.rooms'),{code:'CONTEXT_CLOSED'});
 assert.equal((await basePool().query('SELECT * FROM booking.rooms')).rowCount,0);
 assert.equal((await request('auth/slack/start',b,{})).status,403);
 // Install links bind two Slack workspaces to their issuing customers atomically.
 process.env.SLACK_TOKEN_ENCRYPTION_KEY='ab'.repeat(32);
 process.env.APP_BASE_URL='https://example.test';
 async function installation(route:{tenant_id:string;member_id:string},venueId:string,label:string){
  const r=await withTenant(route.tenant_id,()=>execute(session(route.member_id),'admin.classInstall.create',{name:label,venueId},randomUUID()));
  assert.equal(r.status,200,JSON.stringify(r.error));return new URL((r.data as {url:string}).url).searchParams.get('token')!;
 }
 const installA=await installation(tenantA,av.data.venues[0].id,'Class A'),installB=await installation(tenantB,bv.data.venues[0].id,'Class B');
 assert.equal((await readInstallRequest(installA)).name,'Class A');
 const dataA={team:'TSAASA',name:'A',appId:'APP',botUserId:'BOT_A',token:'xoxb-synthetic-A'};
 const dataB={team:'TSAASB',name:'B',appId:'APP',botUserId:'BOT_B',token:'xoxb-synthetic-B'};
 await connectInstallRequest(installA,dataA);
 await assert.rejects(()=>connectInstallRequest(installB,{...dataB,team:dataA.team}),{code:'23505'});
 await connectInstallRequest(installB,dataB);
 await assert.rejects(()=>readInstallRequest(installA),{code:'INVALID_FLOW'});
 await assert.rejects(()=>connectInstallRequest(installA,dataA));
 await assert.rejects(()=>withTenant(tenantA.tenant_id,()=>inWorkspace(dataB.team,async()=>null)),{code:'WORKSPACE_DENIED'});
 assert.equal(await inWorkspace(dataA.team,async()=> (await pool().query('SELECT count(*)::int n FROM slack_installations')).rows[0].n),1);
 for(const [team,label] of [[dataA.team,'A roster'],[dataB.team,'B roster']])await inWorkspace(team,async()=>{const db=await pool().connect();try{await importRoster(db,team,[{slackId:'USAME',display_name:label}],new Date());}finally{db.release();}});
 await inWorkspace(dataA.team,async()=>{const list=(await pool().query("SELECT display_name FROM members WHERE slack_user_id='USAME'")).rows;assert.deepEqual(list.map(r=>r.display_name),['A roster']);});
 await inWorkspace(dataB.team,async()=>{const list=(await pool().query("SELECT display_name FROM members WHERE slack_user_id='USAME'")).rows;assert.deepEqual(list.map(r=>r.display_name),['B roster']);});
 const ops=new pg.Client({connectionString:url.toString()});await ops.connect();
 const sent:{auth:string;channel:string;text:string}[]=[];const originalFetch=globalThis.fetch,originalEnv=process.env.APP_ENV;
 try{
  const expired=await installation(tenantA,av.data.venues[0].id,'Expired');const preview=await readInstallRequest(expired);await ops.query("UPDATE booking.class_install_requests SET expires_at=now()-interval '1 second' WHERE id=$1",[preview.id]);await assert.rejects(()=>readInstallRequest(expired),{code:'INVALID_FLOW'});await assert.rejects(()=>connectInstallRequest(expired,{...dataA,team:'TEXPIRED'}));
  await ops.query("UPDATE booking.tasks SET status='DONE'");
  for(const [id,team,user] of [[studentsA[0],dataA.team,'UA'],[studentsB[0],dataB.team,'UB']])await ops.query('UPDATE booking.members SET slack_workspace_id=$2,slack_user_id=$3 WHERE id=$1',[id,team,user]);
  await withTenant(tenantA.tenant_id,()=>queueTask(studentsA[0],bookingId,'same-notification'));
  await withTenant(tenantB.tenant_id,()=>queueTask(studentsB[0],bookingB,'same-notification'));
  process.env.APP_ENV='production';
  globalThis.fetch=async(input,init)=>{assert.equal(String(input),'https://slack.com/api/chat.postMessage');const body=JSON.parse(String(init?.body));sent.push({auth:new Headers(init?.headers).get('Authorization')!,channel:body.channel,text:body.text});return new Response(JSON.stringify({ok:true,channel:body.channel,ts:'1'}),{headers:{'content-type':'application/json'}});};
  await Promise.all([deliverNextNotification(),deliverNextNotification()]);
  assert.equal(sent.length,2);
  assert.equal(sent.find(m=>m.channel==='UA')?.auth,'Bearer xoxb-synthetic-A');
  assert.equal(sent.find(m=>m.channel==='UB')?.auth,'Bearer xoxb-synthetic-B');
  assert.ok(sent.find(m=>m.channel==='UA')?.text.includes('A only'));
  assert.ok(!sent.find(m=>m.channel==='UA')?.text.includes('B only'));
  await assert.rejects(()=>schedulerPool().query('SELECT * FROM booking.tasks'),{code:'42501'});
  // Malicious payload references another tenant's reservation. No network call is allowed.
  await withTenant(tenantA.tenant_id,()=>queueTask(studentsA[0],bookingB,'foreign-payload'));
  await deliverNextNotification();assert.equal(sent.length,2);
  assert.equal((await ops.query("SELECT status FROM booking.tasks WHERE dedupe_key='foreign-payload'")).rows[0].status,'PENDING');
  // Suspend after lease acquisition, before delivery: recheck sees current state, not old snapshot.
  await withTenant(tenantA.tenant_id,()=>queueTask(studentsA[0],bookingId,'suspend-before-send'));
  await deliverNextNotification(async task=>{await ops.query("UPDATE saas_control.tenants SET status='SUSPENDED' WHERE id=$1",[tenantA.tenant_id]);return runTask(task);});
  assert.equal(sent.length,2);
  assert.equal(await deliverNextNotification(),false);
 }finally{globalThis.fetch=originalFetch;process.env.APP_ENV=originalEnv;process.env.APP_BASE_URL='http://localhost:3015';await ops.end();}
 async function queueTask(member:string,reservation:string,key:string){const db=await pool().connect();try{await queue(db,'NOTIFY',key,{reservationId:reservation,event:'격리 테스트'},member,'AUTO');}finally{db.release();}}
 console.log('SLACK/WORKER PASS: A/B class installation, token replay and workspace takeover denied, own bot tokens/recipients, concurrent claims, foreign reservation payload denied, suspension before send denied; transport mocked, no real messages sent.');

 const lifeOps=new pg.Client({connectionString:url.toString()});await lifeOps.connect();
 try{
  await lifeOps.query("UPDATE saas_control.tenants SET status='ACTIVE' WHERE id=$1",[tenantA.tenant_id]);
  const exportId=randomUUID();
  await ok('auth/account/space-action',a,{action:'export.create',id:exportId,password:'initial-test-password'});
  assert.equal(await tickExports(),true);
  const archive=await request('auth/account/export-download',a,{id:exportId,password:'initial-test-password'});assert.equal(archive.status,200);
  const files=unzipSync(new Uint8Array(await archive.arrayBuffer()));const memberRows=JSON.parse(strFromU8(files['members.json']));
  assert.ok(memberRows.length>0);assert.ok(!JSON.stringify(memberRows).includes('auth_user_id'));assert.ok(!Object.keys(files).some(f=>f.includes('slack')||f.includes('session')));
  assert.equal((await request('auth/account/export-download',b,{id:exportId,password:'customer-password'})).status,404);
  assert.equal((await request('auth/account/space-action',a,{action:'delete.request',name:'wrong',password:'initial-test-password'})).status,409);
  const space=(await ok('auth/account/space-info',a)).data.space;
  await ok('auth/account/space-action',a,{action:'delete.request',name:space.name,password:'initial-test-password'});
  assert.equal((await request('snapshot',a)).status,403);
  await ok('auth/account/space-action',a,{action:'delete.cancel',password:'initial-test-password'});
  await ok('auth/account/register',undefined,{loginId:'successor',password:'successor-password'});
  const c=(await ok('auth/account/login',undefined,{loginId:'successor',password:'successor-password'})).response.cookies.get('booking-account')!.value;
  const transfer=randomUUID();await ok('auth/account/space-action',a,{action:'transfer.create',id:transfer,loginId:'successor',password:'initial-test-password'});
  assert.equal((await ok('auth/account/space-info',c)).data.incoming[0].id,transfer);
  await ok('auth/account/space-action',c,{action:'transfer.accept',id:transfer,password:'successor-password'});
  assert.equal((await request('auth/account/me',a)).status,401);
  const c2=(await ok('auth/account/login',undefined,{loginId:'successor',password:'successor-password'})).response.cookies.get('booking-account')!.value;
  assert.equal((await ok('auth/account/space-info',c2)).data.space.id,tenantA.tenant_id);
  assert.equal((await request('auth/account/export-download',c2,{id:exportId,password:'successor-password'})).status,404);
  await ok('auth/account/space-action',c2,{action:'delete.request',name:space.name,password:'successor-password'});
  assert.equal((await schedulerPool().query('SELECT saas_control.purge_spaces() n')).rows[0].n,0);
  await lifeOps.query('BEGIN');
  await lifeOps.query("UPDATE saas_control.tenants SET delete_after=now()-interval '1 second' WHERE id=$1",[tenantA.tenant_id]);
  assert.equal((await lifeOps.query('SELECT saas_control.purge_spaces() n')).rows[0].n,1);
  const tombstones=(await lifeOps.query('SELECT tenant_id,deleted_at FROM saas_control.deletion_ledger')).rows.map(r=>({...r,deleted_at:new Date(r.deleted_at).toISOString()}));
  await lifeOps.query('ROLLBACK'); // Simulates a backup restoring the pre-deletion customer.
  await lifeOps.query('BEGIN');assert.equal((await reapplyDeletionLedger(lifeOps,tombstones)).deleted,1);await lifeOps.query('COMMIT');
  assert.equal((await lifeOps.query('SELECT count(*)::int n FROM booking.members WHERE tenant_id=$1',[tenantA.tenant_id])).rows[0].n,0);
  assert.equal((await lifeOps.query('SELECT count(*)::int n FROM saas_control.deletion_ledger WHERE tenant_id=$1',[tenantA.tenant_id])).rows[0].n,1);
  assert.ok((await ok('snapshot',b)).data.rooms.length>0);
 }finally{await lifeOps.end();}
 console.log('LIFECYCLE PASS: private ZIP export, foreign download denied, deletion pause/cancel, ID transfer/session revoke, seven-day purge and unaffected customer B.');
 process.env.SAAS_RELEASE_MODE='pilot';
 assert.equal((await request('auth/account/register',undefined,{loginId:'pilot_denied',password:'customer-password'})).status,503);
 assert.equal((await request('auth/account/space',b,{name:'second space'})).status,503);
 assert.equal((await request('auth/account/space-action',b,{action:'delete.request',name:'test',password:'customer-password'})).status,503);
 assert.ok((await ok('snapshot',b)).data.rooms.length>0);
 delete process.env.SAAS_RELEASE_MODE;
 console.log('PILOT PASS: existing customer works; signup/new spaces/deletion requests remain closed.');
 await ok('auth/logout',b,{});assert.equal((await request('snapshot',b)).status,401);
 console.log('PASS: real API registration/login/provision retry; restricted control/web roles; owner routes; A/B snapshot/commands; cross-tenant change denied; logout; no-context and legacy Slack blocked.');
}finally{
 db?.release();await globalDB.bookingPool?.end();await globalDB.bookingControlPool?.end();await globalDB.bookingSchedulerPool?.end();delete globalDB.bookingPool;delete globalDB.bookingControlPool;delete globalDB.bookingSchedulerPool;delete process.env.SAAS_ENABLED;
 assert.match(name,/^booking_web_test_[0-9]+_[0-9]+$/);await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
 if(rolesMade)for(const r of roles)await control.query(`DROP ROLE "${r}"`);await control.end();
}
