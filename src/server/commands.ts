import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Session} from '../shared/types';
import {transaction} from './db';
import {actor,audit} from './store';
import {AppError,requireThat} from './errors';
import {bookingCommand,boundaries} from './booking';
import {adminCommand,acceptAdmin} from './admin';
export type CommandResult={data?:unknown;error?:{code:string;message:string};status:number;serverTime:string;requestId:string};
function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value);}
export async function execute(session:Session,name:string,input:unknown,key:string,testNow?:Date):Promise<CommandResult>{
 requireThat(/^[a-zA-Z0-9._:-]{8,120}$/.test(key),'INVALID_INPUT','요청 식별자가 필요합니다.',422);
 const hash=createHash('sha256').update(canonical(input)).digest('hex');
 return transaction(async(db,now)=>{
  const me=await actor(db,session,now,name==='onboarding.accept');await boundaries(db,now);
  const receipt=(await db.query('SELECT * FROM command_receipts WHERE actor_id=$1 AND command_type=$2 AND idempotency_key=$3',[me.id,name,key])).rows[0];
  if(receipt){requireThat(receipt.request_hash===hash,'IDEMPOTENCY_MISMATCH','같은 요청 키에 다른 내용이 포함되었습니다.');return receipt.result_summary;}
  const requestId=randomUUID();await db.query('SAVEPOINT command_change');let result:CommandResult;
  try{
   let data:unknown;
   if(name.startsWith('booking.'))data=await bookingCommand(db,me,name.slice(8),input,now,key);
   else if(name.startsWith('admin.'))data=await adminCommand(db,me,session,name.slice(6),input,now);
   else if(name==='onboarding.accept'){const v=z.object({invitationId:z.string().uuid()}).strict().parse(input);requireThat(now.getTime()-session.verifiedAt<600000,'RECENT_AUTH_REQUIRED','새 인증 코드로 본인 확인을 완료해 주세요.',403);data=await acceptAdmin(db,me,v.invitationId,now);}
   else if(name==='report.create'){
    requireThat(me.role==='STUDENT','FORBIDDEN','학생 계정으로 신고해 주세요.',403);const v=z.object({reservationId:z.string().uuid(),type:z.enum(['UNUSED','FACILITY','OTHER']),detail:z.string().trim().min(2).max(1000)}).strict().parse(input);const id=randomUUID();
    await db.query('INSERT INTO reports(id,cohort_id,reservation_id,reporter_id,type,detail) VALUES($1,$2,$3,$4,$5,$6)',[id,me.cohort_id,v.reservationId,me.id,v.type,v.detail]);data={id};
   }else requireThat(false,'INVALID_INPUT','지원하지 않는 요청입니다.',422);
   const record=input&&typeof input==='object'?input as Record<string,unknown>:{};
   const resultId=data&&typeof data==='object'&&'id' in data?String(data.id):null;
   await audit(db,me.id,name,resultId,String(record.reason??''),now,requestId,{result:data,...(name.startsWith('admin.holiday.')?{input}: {})},me.role==='STUDENT'?me.cohort_id:null);
   result={data,status:200,serverTime:now.toISOString(),requestId};
  }catch(e){
   await db.query('ROLLBACK TO SAVEPOINT command_change');
   if(e instanceof AppError)result={error:{code:e.code,message:e.message},status:e.status,serverTime:now.toISOString(),requestId};
   else if(e instanceof z.ZodError)result={error:{code:'INVALID_INPUT',message:'입력 내용을 확인해 주세요. '+e.issues.map(i=>`${i.path.join('.')}: ${i.message}`).slice(0,3).join(' / ')},status:422,serverTime:now.toISOString(),requestId};
   else if(e&&typeof e==='object'&&'code'in e&&['23P01','23505'].includes(String(e.code)))result={error:{code:'CONFLICT',message:'다른 요청이 먼저 처리되었습니다. 최신 상태를 확인해 주세요.'},status:409,serverTime:now.toISOString(),requestId};
   else throw e;
  }
  await db.query('INSERT INTO command_receipts(actor_id,command_type,idempotency_key,request_hash,status,result_summary,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[me.id,name,key,hash,result.status,JSON.stringify(result),now,new Date(now.getTime()+7*86400000)]);return result;
 },testNow);
}
