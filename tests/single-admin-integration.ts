import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/server/db';
import {adminCommand,issueAdmin} from '../src/server/admin';
import type {Member,Session} from '../src/shared/types';
assert.equal(process.env.APP_ENV,'local');
const db=await pool().connect(),now=new Date();
try{
 await db.query('BEGIN');
 const owners=(await db.query<Member>("SELECT * FROM members WHERE role='ADMIN' AND status<>'INACTIVE'")).rows;assert.equal(owners.length,1);const owner=owners[0];
 const session:Session={memberId:owner.id,accessVersion:owner.access_version,verifiedAt:now.getTime(),expiresAt:now.getTime()+60000,sessionId:randomUUID()};
 for(const action of ['account.slackInvite','account.invite','account.resend','account.reinvite','account.revoke','account.deactivate'])await assert.rejects(()=>adminCommand(db,owner,session,action,{},now),{code:'SINGLE_ADMIN_ONLY'});
 await assert.rejects(()=>issueAdmin(db,{email:'another@example.com',name:'검증',reason:'검증',issuer:'ADMIN',by:owner.id},now),{code:'SINGLE_ADMIN_ONLY'});
 for(const status of ['ACTIVE','REGISTERED','PROVISIONING']){
  await db.query('SAVEPOINT singleton');
  await assert.rejects(()=>db.query("INSERT INTO members(email,display_name,role,status) VALUES($1,'추가 관리자 검증','ADMIN',$2)",[randomUUID()+'@example.com',status]),{code:'23505'});
  await db.query('ROLLBACK TO SAVEPOINT singleton');
 }
 // Global facility management remains available to the sole administrator.
 const room=(await db.query('SELECT id,name FROM rooms WHERE active LIMIT 1')).rows[0];assert.ok(room);
 await adminCommand(db,owner,session,'room.rename',{id:room.id,name:room.name,reason:'전체 시설 관리 검증'},now);
 assert.equal((await db.query("SELECT count(*)::int n FROM members WHERE role='ADMIN' AND status<>'INACTIVE'")).rows[0].n,1);
 console.log('PASS: one administrator, invitation APIs blocked, DB singleton constraint, full facility management (rolled back)');
}finally{await db.query('ROLLBACK');db.release();await pool().end();}
