import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readdirSync,readFileSync} from 'node:fs';
import pg from 'pg';
import {pool} from '../src/server/db';
import {execute} from '../src/server/commands';
import {readInstallRequest,connectInstallRequest} from '../src/server/class-install';
import {workspaceAuthorization} from '../src/slack/installations';
import {nativeMembership} from '../src/slack/members';
import {importRoster} from '../src/server/workspace-roster';
import {transaction} from '../src/server/db';
import type {Session} from '../src/shared/types';
assert.equal(process.env.APP_ENV,'local');
const dbName='booking_install_test_'+process.pid,base=new URL(process.env.DATABASE_URL!);base.pathname='/postgres';
const control=new pg.Client({connectionString:base.toString()});await control.connect();await control.query(`CREATE DATABASE "${dbName}"`);
const testURL=new URL(process.env.DATABASE_URL!);testURL.pathname='/'+dbName;process.env.DATABASE_URL=testURL.toString();
process.env.APP_BASE_URL='https://booking.example.com';process.env.SLACK_TOKEN_ENCRYPTION_KEY='11'.repeat(32);
const id=randomUUID(),venue=randomUUID(),team='TNEWCLASS';
const session:Session={memberId:id,accessVersion:1,verifiedAt:Date.now(),expiresAt:Date.now()+3600000,sessionId:randomUUID()};
async function run(action:string,input:unknown){return execute(session,'admin.classInstall.'+action,input,randomUUID());}
function token(result:Awaited<ReturnType<typeof run>>){assert.equal(result.status,200,JSON.stringify(result.error));return new URL((result.data as {url:string}).url).searchParams.get('token')!;}
const data={team,name:'새 워크스페이스',appId:'ATEST',botUserId:'UBOT',token:'xoxb-test'};
try{
 for(const file of readdirSync('db/migrations').filter(f=>f.endsWith('.sql')).sort())await pool().query(readFileSync('db/migrations/'+file,'utf8'));
 await pool().query('INSERT INTO settings(id) VALUES(1) ON CONFLICT DO NOTHING');
 await pool().query("INSERT INTO members(id,email,display_name,role,status) VALUES($1,'wjsworud1025@gmail.com','관리자','ADMIN','ACTIVE')",[id]);
 await pool().query("INSERT INTO venues(id,name) VALUES($1,'테스트 수업장')",[venue]);
 assert.equal((await run('create',{name:' ',venueId:venue})).status,422);
 const created=await run('create',{name:'클래스 A',venueId:venue}),first=token(created),requestId=(created.data as {id:string}).id;
 assert.equal((await readInstallRequest(first)).name,'클래스 A');
 const second=token(await run('reissue',{id:requestId}));await assert.rejects(()=>readInstallRequest(first));
 await run('revoke',{id:requestId});await assert.rejects(()=>readInstallRequest(second));
 const third=token(await run('reissue',{id:requestId}));
 await pool().query("UPDATE class_install_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[requestId]);await assert.rejects(()=>readInstallRequest(third));
 const fresh=token(await run('reissue',{id:requestId}));
 const results=await Promise.allSettled([connectInstallRequest(fresh,data),connectInstallRequest(fresh,{...data,team:'TCONCURRENT'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const row=(await pool().query('SELECT team_id FROM class_install_requests WHERE id=$1',[requestId])).rows[0],connected=row.team_id;
 assert.equal((await workspaceAuthorization(connected)).botToken,'xoxb-test');assert.ok(await nativeMembership(connected));
 await assert.rejects(()=>readInstallRequest(fresh));assert.equal((await run('reissue',{id:requestId})).status,409);
 const another=token(await run('create',{name:'클래스 B',venueId:venue}));await assert.rejects(()=>connectInstallRequest(another,{...data,team:connected}),{code:'CONFLICT'});assert.ok(await readInstallRequest(another));
 const c=(await pool().query('SELECT c.* FROM cohorts c JOIN slack_workspace_classes w ON w.cohort_id=c.id WHERE w.team_id=$1',[connected])).rows[0];assert.equal(c.venue_id,venue);assert.equal(c.name,'클래스 A');
 await transaction((db,now)=>importRoster(db,connected,[{slackId:'UNEW',display_name:'새 구성원'}],now));
 const student=(await pool().query('SELECT * FROM members WHERE slack_workspace_id=$1',[connected])).rows[0];assert.equal(student.status,'ACTIVE');assert.equal(student.cohort_id,c.id);
 const forbidden=await execute({...session,memberId:student.id},'admin.classInstall.create',{name:'금지',venueId:venue},randomUUID());assert.equal(forbidden.status,403);
 await pool().query('UPDATE cohorts SET inactive_at=clock_timestamp() WHERE id=$1',[c.id]);await assert.rejects(()=>workspaceAuthorization(connected),{code:'WORKSPACE_DENIED'});
 console.log('PASS: create, validation, rotation, revoke, expiry, single-use concurrent callback, duplicate workspace rollback, venue/class binding, DB-authorized token selection, automatic membership, student denial, ended class denial. Isolated DB removed.');
}finally{await pool().end();await control.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);await control.end();}
