import {createCipheriv,createDecipheriv,createHash,randomBytes,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import type {NextRequest} from 'next/server';
import type {Member,Session} from '../shared/types';
import {pool,transaction} from './db';
import {requireThat,AppError} from './errors';
import {actor} from './store';
export const cookieName='booking-session';
export const isLocal=()=>process.env.APP_ENV==='local'&&process.env.NODE_ENV!=='production';
function secret(){const s=process.env.SESSION_SECRET;requireThat(s&&s.length>=32,'CONFIGURATION','서버 인증 설정이 필요합니다.',503);return createHash('sha256').update(s).digest();}
export function seal(session:Session){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret(),iv);const data=Buffer.concat([cipher.update(JSON.stringify(session)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');}
export function unseal(value:string):Session{try{const b=Buffer.from(value,'base64url'),dec=createDecipheriv('aes-256-gcm',secret(),b.subarray(0,12));dec.setAuthTag(b.subarray(12,28));const s=JSON.parse(Buffer.concat([dec.update(b.subarray(28)),dec.final()]).toString());requireThat(s.expiresAt>Date.now(),'UNAUTHENTICATED','다시 로그인해 주세요.',401);return s;}catch{throw new AppError('UNAUTHENTICATED','다시 로그인해 주세요.',401);}}
export function supabase(service=false){const url=process.env.SUPABASE_URL,key=service?process.env.SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_ANON_KEY;requireThat(url&&key,'CONFIGURATION','인증 서비스 설정이 필요합니다.',503);return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});}
export async function authenticate(request:NextRequest,allowPending=false){
 const value=request.cookies.get(cookieName)?.value;requireThat(value,'UNAUTHENTICATED','로그인이 필요합니다.',401);const session=unseal(value);
 if(!isLocal()||session.accessToken){requireThat(session.accessToken,'UNAUTHENTICATED','다시 로그인해 주세요.',401);const {data,error}=await supabase().auth.getUser(session.accessToken);requireThat(!error&&data.user,'UNAUTHENTICATED','인증이 만료되었습니다.',401);const m=await pool().query('SELECT auth_user_id FROM members WHERE id=$1',[session.memberId]);requireThat(m.rows[0]?.auth_user_id===data.user.id,'UNAUTHENTICATED','인증 정보가 일치하지 않습니다.',401);}
 const db=await pool().connect();try{return {session,me:await actor(db,session,new Date(),allowPending)};}finally{db.release();}
}
const limits=globalThis as unknown as {bookingAuthLimits?:Map<string,{until:number;count:number}>};
export function rateLimit(key:string,max=10){const map=limits.bookingAuthLimits??=new Map();const now=Date.now();for(const [k,v]of map)if(v.until<now)map.delete(k);const v=map.get(key)??{until:now+600000,count:0};v.count++;map.set(key,v);requireThat(v.count<=max,'RATE_LIMITED','요청이 많습니다. 10분 후 다시 시도해 주세요.',429);}
function hash(email:string,code:string){return createHash('sha256').update(secret()).update(email+':'+code).digest('hex');}
export function assertLocalRequest(request:NextRequest){requireThat(isLocal()&&!process.env.LAN_TEST_HOST&&['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname),'NOT_FOUND','찾을 수 없습니다.',404);}
export async function requestOTP(email:string){
 rateLimit('request:'+email,10);const m=(await pool().query<Member>('SELECT * FROM members WHERE email=$1',[email])).rows[0];if(!m||m.role==='STUDENT'&&m.status!=='ACTIVE')return;
 if(isLocal()){
  const code=String(randomInt(100000,1000000));await transaction(async(db,now)=>{
   const prev=await db.query('SELECT requested_at FROM local_auth.challenges WHERE email=$1',[email]);requireThat(!prev.rows[0]||now.getTime()-new Date(prev.rows[0].requested_at).getTime()>30000,'RATE_LIMITED','코드는 30초 후 다시 요청할 수 있습니다.',429);
   await db.query('INSERT INTO local_auth.challenges(email,code_hash,expires_at,requested_at) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO UPDATE SET code_hash=$2,expires_at=$3,requested_at=$4,attempts=0',[email,hash(email,code),new Date(now.getTime()+600000),now]);
   await db.query('INSERT INTO local_auth.mailbox(recipient,subject,body) VALUES($1,$2,$3)',[email,'회의실 예약 인증 코드',`인증 코드: ${code}\n10분 이내 입력해 주세요. 본인이 요청한 경우에만 사용하세요.`]);
  });
 }else{const {error}=await supabase().auth.signInWithOtp({email,options:{shouldCreateUser:false}});if(error)throw new AppError('AUTH_DELIVERY_FAILED','인증 메일을 보낼 수 없습니다. 잠시 후 다시 시도해 주세요.',503);}
}
export async function verifyOTP(email:string,code:string):Promise<Session>{
 rateLimit('verify:'+email,15);let authId:string|undefined,accessToken:string|undefined,expiresAt=Date.now()+8*3600000;
 if(isLocal()){
  const ok=await transaction(async(db,now)=>{const r=(await db.query('SELECT * FROM local_auth.challenges WHERE email=$1 FOR UPDATE',[email])).rows[0];if(!r||new Date(r.expires_at)<=now||r.attempts>=5)return false;
   await db.query('UPDATE local_auth.challenges SET attempts=attempts+1 WHERE email=$1',[email]);if(!timingSafeEqual(Buffer.from(r.code_hash,'hex'),Buffer.from(hash(email,code),'hex')))return false;await db.query('DELETE FROM local_auth.challenges WHERE email=$1',[email]);return true;
  });requireThat(ok,'INVALID_CODE','코드가 만료되었거나 일치하지 않습니다. 새 코드를 요청해 주세요.',401);
 }else{const {data,error}=await supabase().auth.verifyOtp({email,token:code,type:'email'});requireThat(!error&&data.user&&data.session,'INVALID_CODE','인증 코드를 확인해 주세요.',401);authId=data.user.id;accessToken=data.session.access_token;expiresAt=(data.session.expires_at??Math.floor(Date.now()/1000)+3600)*1000;}
 const m=(await pool().query<Member>('SELECT * FROM members WHERE email=$1',[email])).rows[0];requireThat(m&&(!authId||m.auth_user_id===authId),'UNAUTHENTICATED','등록된 계정으로 로그인해 주세요.',401);requireThat(m.status==='ACTIVE'||m.role==='ADMIN','ACCESS_REVOKED','비활성 계정입니다.',403);
 return {memberId:m.id,accessVersion:m.access_version,verifiedAt:Date.now(),expiresAt,sessionId:randomUUID(),accessToken};
}
