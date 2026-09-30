import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/server/db';
import {syncClaims} from '../src/server/booking';
import {adminCommand} from '../src/server/admin';
import type {Member,Session} from '../src/shared/types';
assert.equal(process.env.APP_ENV,'local');
const db=await pool().connect(),now=new Date();
try{
 await db.query('BEGIN');await db.query('SELECT id FROM settings WHERE id=1 FOR UPDATE');
 const admin=(await db.query<Member>("SELECT * FROM members WHERE role='ADMIN' AND status='ACTIVE' LIMIT 1")).rows[0];assert.ok(admin);
 const session:Session={memberId:admin.id,accessVersion:admin.access_version,verifiedAt:now.getTime(),expiresAt:now.getTime()+60000,sessionId:randomUUID()};
 const name='검증실 '+randomUUID(),reason='격리 검증';
 const policies=(await db.query('SELECT id,rules_json FROM policy_versions')).rows;
 const {id}=await adminCommand(db,admin,session,'room.add',{name,capacity:6,minimum:2,reason},now) as {id:string};
 for(const p of (await db.query('SELECT id,rules_json FROM policy_versions')).rows){assert.deepEqual(p.rules_json.rooms[id],{capacity:6,minimum:2});delete p.rules_json.rooms[id];assert.deepEqual(p.rules_json,policies.find(x=>x.id===p.id).rules_json);}
 await assert.rejects(()=>adminCommand(db,admin,session,'room.add',{name,capacity:4,minimum:2,reason},now),{code:'CONFLICT'});
 await assert.rejects(()=>adminCommand(db,admin,session,'room.add',{name:name+'bad',capacity:2,minimum:4,reason},now),{code:'INVALID_INPUT'});
 await adminCommand(db,admin,session,'room.rename',{id,name:name+'수정',reason},now);
 assert.equal((await db.query('SELECT name FROM rooms WHERE id=$1',[id])).rows[0].name,name+'수정');
 const cohort=(await db.query('SELECT id FROM cohorts LIMIT 1')).rows[0].id,reservation=randomUUID();
 await db.query("INSERT INTO reservations(id,cohort_id,room_id,creator_id,organizer_id,policy_version_id,capacity_snapshot,minimum_snapshot,starts_at,ends_at,status,initial_deadline,create_request_key) VALUES($1,$2,$3,$4,$4,$5,6,2,$6,$7,'CONFIRMED',$6,$8)",[reservation,cohort,id,admin.id,policies[0].id,new Date(now.getTime()+3600000),new Date(now.getTime()+7200000),reservation]);
 await assert.rejects(()=>adminCommand(db,admin,session,'room.remove',{id,reason},now),{code:'ROOM_HAS_RESERVATIONS'});
 await db.query('UPDATE members SET first_booking_at=NULL WHERE id=$1',[admin.id]);
 await db.query("INSERT INTO reservation_members(reservation_id,member_id,invited_by,status,responded_at) VALUES($1,$2,$2,'ACCEPTED',$3)",[reservation,admin.id,now]);
 await syncClaims(db,reservation);
 const first=(await db.query('SELECT first_booking_at FROM members WHERE id=$1',[admin.id])).rows[0].first_booking_at;assert.ok(first);
 await db.query("UPDATE reservations SET status='CANCELLED' WHERE id=$1",[reservation]);
 await syncClaims(db,reservation);assert.equal((await db.query('SELECT first_booking_at FROM members WHERE id=$1',[admin.id])).rows[0].first_booking_at,first);
 await adminCommand(db,admin,session,'room.remove',{id,reason},now);
 assert.equal((await db.query('SELECT active FROM rooms WHERE id=$1',[id])).rows[0].active,false);
 assert.equal((await db.query('SELECT id FROM reservations WHERE id=$1',[reservation])).rowCount,1);
 await assert.rejects(()=>adminCommand(db,{...admin,role:'STUDENT'},session,'room.add',{name,capacity:4,minimum:2,reason},now),{code:'FORBIDDEN'});
 console.log('PASS: add, policies preserved, duplicate and invalid capacity rejected, rename, future booking removal blocked, soft removal preserves history, admin authorization. Rolled back.');
}finally{await db.query('ROLLBACK');db.release();await pool().end();}
