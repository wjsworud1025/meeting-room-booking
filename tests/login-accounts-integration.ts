import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import pg from 'pg';
import {pool} from '../src/server/db';
import {bindLegacyOwner,registerAccount,loginAccount,accountSession,bookingAccountSession,changePassword,logoutAccount} from '../src/server/login-accounts';
import {prepareCandidate} from '../scripts/saas/preparation';
assert.equal(process.env.APP_ENV,'local');
const original=new URL(process.env.DATABASE_URL!);assert.ok(['127.0.0.1','localhost','[::1]'].includes(original.hostname));
const name='booking_accounts_test_'+process.pid+'_'+Date.now();
const controlURL=new URL(original);controlURL.pathname='/postgres';
const control=new pg.Client({connectionString:controlURL.toString()});
await control.connect();await control.query(`CREATE DATABASE "${name}"`);
const url=new URL(original);url.pathname='/'+name;process.env.DATABASE_URL=url.toString();
try {
 for(const f of readdirSync('db/migrations').filter(f=>f.endsWith('.sql')).sort())await pool().query(readFileSync('db/migrations/'+f,'utf8'));
 const admin=randomUUID();await pool().query("INSERT INTO booking.members(id,email,display_name,role,status) VALUES($1,'original@example.test','Original','ADMIN','ACTIVE')",[admin]);
 assert.equal((await bindLegacyOwner('hyundai_1st','1111')).created,true);
 assert.equal((await bindLegacyOwner('hyundai_1st','replacement-must-not-reset')).created,false);
 const stored=(await pool().query('SELECT password_hash FROM identity.accounts')).rows[0].password_hash;
 assert.notEqual(stored,'1111');assert.ok(!stored.includes('1111:'));
 const owner=await loginAccount('HYUNDAI_1ST','1111',true);assert.equal(owner.mustChange,true);assert.equal(owner.seconds,900);
 await assert.rejects(()=>bookingAccountSession(owner.token),{code:'PASSWORD_CHANGE_REQUIRED'});
 await assert.rejects(()=>changePassword(owner.token,'bad','new-password-123'),{code:'INVALID_CREDENTIALS'});
 await assert.rejects(()=>changePassword(owner.token,'1111','1111'),{code:'INVALID_PASSWORD'});
 await changePassword(owner.token,'1111','new-password-123');
 await assert.rejects(()=>accountSession(owner.token),{code:'UNAUTHENTICATED'});
 await assert.rejects(()=>loginAccount('hyundai_1st','1111'),{code:'INVALID_CREDENTIALS'});
 const changed=await loginAccount('hyundai_1st','new-password-123');assert.equal(changed.mustChange,false);
 assert.equal((await bookingAccountSession(changed.token)).memberId,admin);
 await registerAccount('new_owner','different-password-456');
 await assert.rejects(()=>registerAccount('NEW_OWNER','different-password-456'),{code:'LOGIN_ID_UNAVAILABLE'});
 await assert.rejects(()=>registerAccount('bad-id','different-password-456'),{code:'INVALID_LOGIN_ID'});
 const fresh=await loginAccount('new_owner','different-password-456');assert.equal(fresh.status,'PENDING');
 await assert.rejects(()=>bookingAccountSession(fresh.token),{code:'ACCOUNT_PENDING'});
 await assert.rejects(()=>accountSession('forged'),{code:'UNAUTHENTICATED'});
 await logoutAccount(fresh.token);await assert.rejects(()=>accountSession(fresh.token),{code:'UNAUTHENTICATED'});
 for(let i=0;i<5;i++)await assert.rejects(()=>loginAccount('new_owner','incorrect'),{code:'INVALID_CREDENTIALS'});
 await assert.rejects(()=>loginAccount('new_owner','different-password-456'),{code:'INVALID_CREDENTIALS'});
 const ownerId=(await pool().query('SELECT account_id FROM identity.legacy_owner')).rows[0].account_id;
 const db=await pool().connect();try{
  await db.query('BEGIN');await prepareCandidate(db);
  assert.equal((await db.query('SELECT owner_account_id FROM saas_control.tenants')).rows[0].owner_account_id,ownerId);
  await db.query('ROLLBACK');
 }finally{db.release();}
 console.log('PASS: original ADMIN binding; hashed password; idempotent bootstrap; temporary credential gate; change/revocation; login normalization/uniqueness; pending account denied booking; lockout; SaaS owner ID preserved.');
}finally {await pool().end();assert.match(name,/^booking_accounts_test_[0-9]+_[0-9]+$/);await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);await control.end();}
