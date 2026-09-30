import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readdirSync,readFileSync} from 'node:fs';
import pg from 'pg';
import {pool} from '../src/server/db';
import {execute} from '../src/server/commands';
import {snapshot,reservationDetail,memberConflicts} from '../src/server/queries';
import {defaultRules} from '../src/server/policy';
import {localDate,addDays,at} from '../src/shared/time';
import type {Session} from '../src/shared/types';
assert.equal(process.env.APP_ENV,'local');
const dbName='booking_venues_test_'+process.pid,base=new URL(process.env.DATABASE_URL!);base.pathname='/postgres';
const control=new pg.Client({connectionString:base.toString()});await control.connect();await control.query(`CREATE DATABASE "${dbName}"`);
const testURL=new URL(process.env.DATABASE_URL!);testURL.pathname='/'+dbName;process.env.DATABASE_URL=testURL.toString();
const now=new Date(),date=addDays(localDate(now),1),start=at(date,'18:00').toISOString(),end=at(date,'19:00').toISOString();
const admin=randomUUID(),students=Array.from({length:4},()=>randomUUID()),cohorts=Array.from({length:4},()=>randomUUID()),venues=[randomUUID(),randomUUID()];
const session=(id:string):Session=>({memberId:id,accessVersion:1,verifiedAt:Date.now(),expiresAt:Date.now()+3600000,sessionId:randomUUID()});
async function run(id:string,name:string,input:unknown){return execute(session(id),name,input,randomUUID(),now);}
function ok(result:Awaited<ReturnType<typeof execute>>){assert.equal(result.status,200,JSON.stringify(result.error));return (result.data as {id:string}).id;}
try{
 for(const file of readdirSync('db/migrations').filter(f=>f.endsWith('.sql')).sort())await pool().query(readFileSync('db/migrations/'+file,'utf8'));
 await pool().query('INSERT INTO settings(id) VALUES(1) ON CONFLICT DO NOTHING');
 await pool().query("INSERT INTO members(id,email,display_name,role,status) VALUES($1,'wjsworud1025@gmail.com','관리자','ADMIN','ACTIVE')",[admin]);
 await pool().query("INSERT INTO venues(id,name) VALUES($1,'수업장 A'),($2,'수업장 B')",venues);
 for(let i=0;i<4;i++){
  await pool().query("INSERT INTO cohorts(id,name,starts_on,ends_on,venue_id) VALUES($1,$2,'2026-01-01','9999-12-31',$3)",[cohorts[i],'클래스 '+i,i<2?venues[0]:i===2?venues[1]:null]);
  await pool().query("INSERT INTO slack_workspace_classes(team_id,class_name,cohort_id,auto_enroll) VALUES($1,$2,$3,true)",['TTEST'+i,'클래스 '+i,cohorts[i]]);
  await pool().query("INSERT INTO members(id,email,display_name,role,status,cohort_id) VALUES($1,$2,$3,'STUDENT','ACTIVE',$4)",[students[i],i+'@example.com','학생 '+i,cohorts[i]]);
 }
 await pool().query("INSERT INTO policy_versions(effective_on,rules_json) VALUES('2020-01-01',$1)",[JSON.stringify({...defaultRules,weekdays:[0,1,2,3,4,5,6],rooms:{}})]);
 await pool().query("INSERT INTO holiday_overrides(local_date,name,source_url,reason) VALUES($1,NULL,'test','휴일 제외')",[date]);
 const roomA=ok(await run(admin,'admin.room.add',{name:'회의실 01',venueId:venues[0],capacity:4,minimum:2,reason:'테스트'}));
 const roomB=ok(await run(admin,'admin.room.add',{name:'회의실 01',venueId:venues[1],capacity:4,minimum:2,reason:'테스트'}));
 for(const index of [0,1]){const view=await snapshot(session(students[index]),date);assert.deepEqual(view.rooms.map(r=>r.id),[roomA]);assert.deepEqual(Object.keys(view.rules.rooms),[roomA]);assert.equal(view.venue?.id,venues[0]);}
 assert.deepEqual((await snapshot(session(students[2]),date)).rooms.map(r=>r.id),[roomB]);
 assert.equal((await snapshot(session(students[3]),date)).rooms.length,0);
 assert.equal((await snapshot(session(admin),date)).rooms.length,2);
 const input={roomId:roomA,startsAt:start,endsAt:end,inviteeIds:[students[1]]};
 assert.equal((await run(students[0],'booking.create',{...input,roomId:roomB})).error?.code,'ROOM_NOT_ALLOWED');
 assert.equal((await run(students[0],'booking.create',{...input,inviteeIds:[students[2]]})).error?.code,'MEMBER_VENUE_MISMATCH');
 const booking=ok(await run(students[0],'booking.create',input));
 assert.equal((await snapshot(session(students[2]),date)).reservations.length,0);
 await assert.rejects(()=>reservationDetail(session(students[2]),booking),{code:'ROOM_NOT_ALLOWED'});
 await assert.rejects(()=>memberConflicts(session(students[2]),[students[0]],start,end),{code:'FORBIDDEN'});
 assert.equal((await run(students[0],'booking.invite',{id:booking,expectedVersion:1,inviteeIds:[students[2]]})).error?.code,'MEMBER_VENUE_MISMATCH');
 assert.equal((await run(students[0],'booking.change',{...input,id:booking,expectedVersion:1,roomId:roomB,inviteeIds:undefined})).status,422);
 const change={id:booking,expectedVersion:1,roomId:roomB,startsAt:start,endsAt:end,reason:'변경 검사'};
 assert.equal((await run(admin,'booking.change',change)).error?.code,'ROOM_NOT_ALLOWED');
 assert.equal((await run(admin,'admin.room.assign',{id:roomA,venueId:venues[1],reason:'변경 검사'})).error?.code,'ROOM_HAS_RESERVATIONS');
 assert.equal((await run(admin,'admin.workspace.assign',{teamId:'TTEST1',venueId:venues[1],reason:'변경 검사'})).error?.code,'CLASS_HAS_RESERVATIONS');
 ok(await run(admin,'admin.workspace.assign',{teamId:'TTEST3',venueId:venues[1],reason:'미지정 연결'}));
 assert.deepEqual((await snapshot(session(students[3]),date)).rooms.map(r=>r.id),[roomB]);
 console.log('PASS: 2 venues / multiple classes, isolated room lists and rules, unassigned deny, same-venue booking, cross-venue creation/invite/change/detail/conflicts denied, reassignment protects reservations, admin sees all');
}finally{
 await pool().end();await control.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);await control.end();
}
