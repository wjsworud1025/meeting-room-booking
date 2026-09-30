import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/server/db';
import {adminCommand} from '../src/server/admin';
import type {Member,Session} from '../src/shared/types';
assert.equal(process.env.APP_ENV,'local');
const db=await pool().connect(),now=new Date();
try{
 await db.query('BEGIN');
 const admin=(await db.query<Member>("SELECT * FROM members WHERE role='ADMIN' AND status='ACTIVE' LIMIT 1")).rows[0];assert.ok(admin);
 const session:Session={memberId:admin.id,accessVersion:admin.access_version,verifiedAt:now.getTime(),expiresAt:now.getTime()+60000,sessionId:randomUUID()};
 const room=(await db.query('SELECT id FROM rooms WHERE active LIMIT 1')).rows[0];
 const call=(input:unknown)=>adminCommand(db,admin,session,'exception.open',input,now);
 const base={roomId:room.id,start:'08:00',end:'09:00'};
 const count=async()=>Number((await db.query('SELECT count(*) n FROM opening_exceptions')).rows[0].n);
 const before=await count();
 await call({...base,dates:['2080-02-01','2080-01-01','2080-02-01']});
 assert.equal(await count(),before+2);
 assert.equal((await db.query("SELECT reason FROM opening_exceptions WHERE local_date='2080-01-01' AND room_id=$1 AND local_start='08:00'",[room.id])).rows[0].reason,'');
 await call({...base,dates:['2080-02-01','2080-01-01'],reason:''});assert.equal(await count(),before+2);
 await call({...base,date:'2080-03-01',reason:'밤'});assert.equal(await count(),before+3);
 for(const bad of [[],['2080-04-01','bad'],Array(61).fill('2080-04-01')])await assert.rejects(()=>call({...base,dates:bad}));
 await assert.rejects(()=>call({...base,dates:['2080-04-01'],date:'2080-04-01'}));
 await assert.rejects(()=>call({...base,dates:['2080-04-01'],end:'07:00'}),{code:'INVALID_INPUT'});
 await assert.rejects(()=>call({...base,roomId:randomUUID(),dates:['2080-04-01']}),{code:'ROOM_UNAVAILABLE'});
 assert.equal(await count(),before+3);
 console.log('PASS: multi-month dates, duplicate input and existing settings deduplicated, optional/one-character reason, legacy single date, invalid/empty/oversized batch rejected without partial writes (rolled back)');
}finally{await db.query('ROLLBACK');db.release();await pool().end();}
