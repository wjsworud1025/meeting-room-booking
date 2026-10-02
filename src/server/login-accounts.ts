import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash,randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {pool,controlPool,saasEnabled} from './db';
import {tenantForAccount} from './saas/runtime';
import {AppError,requireThat} from './errors';
import type {Session} from '../shared/types';
const scrypt=promisify(scryptCallback);
export const accountCookie='booking-account';
export function normalizeLogin(value:string){const id=value.trim().toLowerCase();requireThat(/^[a-z0-9_]{4,32}$/.test(id),'INVALID_LOGIN_ID','아이디는 영문 소문자·숫자·밑줄 4~32자로 입력해 주세요.',422);return id;}
export function validatePassword(p:string){requireThat(p.length>=1&&p.length<=128,'INVALID_PASSWORD','비밀번호를 1~128자로 입력해 주세요.',422);}
export async function hashPassword(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64) as Buffer).toString('hex');}
async function matches(password:string,hash:string){const [salt,key]=hash.split(':');const actual=await scrypt(password,salt,64) as Buffer;const expected=Buffer.from(key,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
const tokenHash=(v:string)=>createHash('sha256').update(v).digest('hex');
export async function registerAccount(login:string,password:string){requireThat(process.env.SAAS_RELEASE_MODE!=='pilot','REGISTRATION_PAUSED','신규 고객 가입은 준비 중입니다.',503);const id=normalizeLogin(login);requireThat(id!=='hyundai_1st','LOGIN_ID_UNAVAILABLE','사용할 수 없는 아이디입니다.',409);validatePassword(password);const hash=await hashPassword(password);try{await controlPool().query('INSERT INTO identity.accounts(login_id,password_hash) VALUES($1,$2)',[id,hash]);}catch(e){if((e as {code?:string}).code==='23505')throw new AppError('LOGIN_ID_UNAVAILABLE','사용할 수 없는 아이디입니다.',409);throw e;}}
export async function loginAccount(login:string,password:string,remember=false){
 const id=normalizeLogin(login);requireThat(password.length<=128,'INVALID_CREDENTIALS','아이디 또는 비밀번호를 확인해 주세요.',401);
 const db=await controlPool().connect();
 try {
  await db.query('BEGIN');
  const a=(await db.query('SELECT * FROM identity.accounts WHERE login_id=$1 FOR UPDATE',[id])).rows[0];
  const ok=await matches(password,a?.password_hash??'00000000000000000000000000000000:'+ '00'.repeat(64));
  if(!a||a.status==='DISABLED'||a.locked_until&&new Date(a.locked_until)>new Date()||!ok){
   if(a&&!ok)await db.query("UPDATE identity.accounts SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts+1>=5 THEN now()+interval '10 minutes' ELSE locked_until END WHERE id=$1",[a.id]);
   await db.query('COMMIT');throw new AppError('INVALID_CREDENTIALS','아이디 또는 비밀번호를 확인해 주세요.',401);
  }
  await db.query('UPDATE identity.accounts SET failed_attempts=0,locked_until=NULL WHERE id=$1',[a.id]);
  const token=randomBytes(32).toString('base64url'),seconds=a.must_change_password?900:remember?30*86400:8*3600;
  await db.query("INSERT INTO identity.sessions(token_hash,account_id,account_version,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 second')",[tokenHash(token),a.id,a.version,seconds]);
  await db.query('DELETE FROM identity.sessions WHERE expires_at<now()');
  await db.query('COMMIT');return {token,seconds,mustChange:!!a.must_change_password,status:a.status};
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
export async function accountSession(token:string|undefined){
 requireThat(token,'UNAUTHENTICATED','로그인이 필요합니다.',401);
 const a=(await controlPool().query(`SELECT a.id,a.login_id,a.status,a.must_change_password,a.version,s.expires_at,s.created_at,o.member_id
 FROM identity.sessions s JOIN identity.accounts a ON a.id=s.account_id LEFT JOIN identity.legacy_owner o ON o.account_id=a.id
 WHERE s.token_hash=$1 AND s.expires_at>now() AND s.account_version=a.version AND a.status<>'DISABLED'`,[tokenHash(token)])).rows[0];
 requireThat(a,'UNAUTHENTICATED','다시 로그인해 주세요.',401);return a;
}
export async function bookingAccountSession(token:string):Promise<Session>{
 const a=await accountSession(token);
 requireThat(!a.must_change_password,'PASSWORD_CHANGE_REQUIRED','임시 비밀번호를 먼저 변경해 주세요.',403);
 if(saasEnabled())a.member_id=(await tenantForAccount(a.id)).member_id;
 requireThat(a.status==='ACTIVE'&&a.member_id,'ACCOUNT_PENDING','독립 운영 공간을 준비 중입니다.',403);
 const m=(await pool().query("SELECT access_version FROM booking.members WHERE id=$1 AND role='ADMIN' AND status='ACTIVE'",[a.member_id])).rows[0];
 requireThat(m,'ACCESS_REVOKED','계정 접근이 해제되었습니다.',403);
 return {loginId:a.login_id,memberId:a.member_id,accessVersion:m.access_version,verifiedAt:new Date(a.created_at).getTime(),expiresAt:new Date(a.expires_at).getTime(),sessionId:randomUUID()};
}
export async function changePassword(token:string,current:string,next:string){
 validatePassword(next);const a=await accountSession(token);const nextHash=await hashPassword(next);
 const db=await controlPool().connect();try{await db.query('BEGIN');
  const row=(await db.query('SELECT * FROM identity.accounts WHERE id=$1 FOR UPDATE',[a.id])).rows[0];
  requireThat(row.version===a.version&&await matches(current,row.password_hash),'INVALID_CREDENTIALS','현재 비밀번호를 확인해 주세요.',401);
  requireThat(!await matches(next,row.password_hash),'INVALID_PASSWORD','기존과 다른 비밀번호를 입력해 주세요.',422);
  await db.query('UPDATE identity.accounts SET password_hash=$2,must_change_password=false,version=version+1,failed_attempts=0,locked_until=NULL WHERE id=$1',[a.id,nextHash]);
  await db.query('DELETE FROM identity.sessions WHERE account_id=$1',[a.id]);await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
export async function logoutAccount(token:string|undefined){if(token)await controlPool().query('DELETE FROM identity.sessions WHERE token_hash=$1',[tokenHash(token)]);}
export async function bindLegacyOwner(login:string,password:string){
 const id=normalizeLogin(login),hash=await hashPassword(password),db=await controlPool().connect();
 try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(30102026)');
  const bound=await db.query('SELECT a.login_id FROM identity.legacy_owner o JOIN identity.accounts a ON a.id=o.account_id');
  if(bound.rowCount){requireThat(bound.rows[0].login_id===id,'OWNER_ALREADY_ASSIGNED','기존 데이터 소유자가 이미 지정되어 있습니다.',409);await db.query('COMMIT');return {created:false};}
  const admins=await db.query("SELECT id FROM booking.members WHERE role='ADMIN' AND status='ACTIVE'");
  requireThat(admins.rowCount===1,'OWNER_REVIEW_REQUIRED','활성 관리자 1명을 확인해야 합니다.',409);
  const a=(await db.query("INSERT INTO identity.accounts(login_id,password_hash,must_change_password,status) VALUES($1,$2,true,'ACTIVE') RETURNING id",[id,hash])).rows[0];
  await db.query('INSERT INTO identity.legacy_owner(account_id,member_id) VALUES($1,$2)',[a.id,admins.rows[0].id]);
  await db.query('COMMIT');return {created:true};
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}

export async function reauthenticateAccount(token:string|undefined,password:string){
 requireThat(password.length>0&&password.length<=128,'INVALID_CREDENTIALS','비밀번호를 확인해 주세요.',401);
 const a=await accountSession(token);
 const db=await controlPool().connect();try{
  await db.query('BEGIN');const row=(await db.query('SELECT * FROM identity.accounts WHERE id=$1 FOR UPDATE',[a.id])).rows[0];
  if(!row||row.status==='DISABLED'||row.version!==a.version||row.must_change_password||row.locked_until&&new Date(row.locked_until)>new Date()||!await matches(password,row.password_hash)){
   if(row)await db.query("UPDATE identity.accounts SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts+1>=5 THEN now()+interval '10 minutes' ELSE locked_until END WHERE id=$1",[a.id]);
   await db.query('COMMIT');throw new AppError('INVALID_CREDENTIALS','비밀번호를 확인해 주세요.',401);
  }
  await db.query('UPDATE identity.accounts SET failed_attempts=0,locked_until=NULL WHERE id=$1',[a.id]);await db.query('COMMIT');return a;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}

export async function changeLoginId(token:string,current:string,next:string){
 const id=normalizeLogin(next),a=await reauthenticateAccount(token,current);
 requireThat(id!==a.login_id,'INVALID_LOGIN_ID','현재와 다른 아이디를 입력해 주세요.',422);
 requireThat(id!=='hyundai_1st','LOGIN_ID_UNAVAILABLE','사용할 수 없는 아이디입니다.',409);
 const db=await controlPool().connect();try{
 await db.query('BEGIN');
 const row=(await db.query('SELECT version FROM identity.accounts WHERE id=$1 FOR UPDATE',[a.id])).rows[0];
 requireThat(row?.version===a.version,'UNAUTHENTICATED','다시 로그인해 주세요.',401);
 await db.query('UPDATE identity.accounts SET login_id=$2,version=version+1 WHERE id=$1',[a.id,id]);
 await db.query('DELETE FROM identity.sessions WHERE account_id=$1',[a.id]);
 await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');if((e as {code?:string}).code==='23505')throw new AppError('LOGIN_ID_UNAVAILABLE','사용할 수 없는 아이디입니다.',409);throw e;}finally{db.release();}
}
