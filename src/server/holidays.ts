import {saasEnabled} from './db';
import {randomUUID} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {z} from 'zod';
import {pool,transaction,type DB} from './db';
import {queue,audit} from './store';
import {requireThat} from './errors';
import {bundledYear,holidayYearAvailable} from '../shared/holidays';
import {localDate} from '../shared/time';
import type {Member} from '../shared/types';
export const holidaySource='https://www.data.go.kr/data/15012690/openapi.do';
export const holidayKeyReady=()=>!!process.env.HOLIDAY_API_KEY?.trim();
export function holidayWorkerActive(heartbeat:string|null|undefined,now=Date.now()){
 const stamp=heartbeat?new Date(heartbeat).getTime():NaN;
 return Number.isFinite(stamp)&&stamp<=now&&now-stamp<90000;
}
export function parseHolidayResponse(raw:string,year:number):Record<string,string>{
 if(raw.length>200000||/<!DOCTYPE|<!ENTITY/i.test(raw))throw Error('HOLIDAY_INVALID_RESPONSE');
 let parsed;
 try{if(raw.trim().startsWith('{'))parsed=JSON.parse(raw);else{if(XMLValidator.validate(raw)!==true)throw Error();parsed=new XMLParser({parseTagValue:false,processEntities:false}).parse(raw);}}catch{throw Error('HOLIDAY_INVALID_RESPONSE');}
 const response=parsed?.response,body=response?.body;
 if(String(response?.header?.resultCode)!=='00')throw Error('HOLIDAY_PROVIDER_ERROR');
 const total=Number(body?.totalCount),source=body?.items?.item,items=Array.isArray(source)?source:source?[source]:[];
 // Reject empty/truncated years so a provider error cannot erase previously valid holidays.
 if(!Number.isInteger(total)||total<10||total>1000||items.length!==total)throw Error('HOLIDAY_INCOMPLETE_RESPONSE');
 const result:Record<string,string>={};
 for(const item of items){
  const day=String(item.locdate),name=typeof item.dateName==='string'?item.dateName.trim():'';
  if(!/^\d{8}$/.test(day)||!day.startsWith(String(year))||!name||name.length>100||!['Y','N'].includes(item.isHoliday))throw Error('HOLIDAY_INVALID_RESPONSE');
  const date=`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}`;
  if(!z.iso.date().safeParse(date).success)throw Error('HOLIDAY_INVALID_RESPONSE');
  if(item.isHoliday==='Y')result[date]=result[date]?(result[date].split(' · ').includes(name)?result[date]:result[date]+' · '+name):name;
 }
 if(Object.keys(result).length<10)throw Error('HOLIDAY_INCOMPLETE_RESPONSE');
 return result;
}
export async function fetchHolidayYear(year:number,request:typeof fetch=fetch){
 const key=process.env.HOLIDAY_API_KEY?.trim();if(!key)throw Error('HOLIDAY_KEY_MISSING');
 let decoded=key;try{decoded=decodeURIComponent(key);}catch{/* A decoded key need not be valid URI encoding. */}
 const url=new URL('https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo');
 url.search=new URLSearchParams({ServiceKey:decoded,solYear:String(year),numOfRows:'1000',pageNo:'1'}).toString();
 const response=await request(url,{signal:AbortSignal.timeout(12000),redirect:'error',cache:'no-store'});
 if(!response.ok)throw Error('HOLIDAY_HTTP_ERROR');return parseHolidayResponse(await response.text(),year);
}
export async function holidayYear(db:DB,year:number){
 const saved=(await db.query('SELECT * FROM holiday_years WHERE year=$1',[year])).rows[0];
 const base:Record<string,string>=saved?.days??bundledYear(year),days={...base};
 const overrides=(await db.query('SELECT local_date,name,source_url,reason,version,updated_at FROM holiday_overrides WHERE local_date >= $1::date AND local_date < $2::date ORDER BY local_date',[`${year}-01-01`,`${year+1}-01-01`])).rows;
 for(const row of overrides){if(row.name)days[row.local_date]=row.name;else delete days[row.local_date];}
 return {year,days,base,overrides,coverage:!!saved||holidayYearAvailable(year),source:saved?'API':'BUNDLED',syncedAt:saved?.synced_at??null};
}
export async function holidayInfo(year:number,admin=false){const db=await pool().connect();try{
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await holidayYear(db,year);
 const state=admin?(await db.query('SELECT * FROM holiday_sync WHERE id=1')).rows[0]:undefined;
 const task=admin?(await db.query("SELECT status,attempts,last_error_code,next_run_at FROM tasks WHERE kind='HOLIDAY_SYNC' AND status IN ('PENDING','RUNNING') ORDER BY created_at DESC LIMIT 1")).rows[0]:undefined;
 await db.query('COMMIT');
 const publicData={year,days:result.days,coverage:result.coverage,source:result.source,syncedAt:result.syncedAt};
 const workerActive=holidayWorkerActive(state?.worker_heartbeat);
 return admin?{...result,state,task:task??null,configured:holidayKeyReady()||workerActive,workerEnabled:workerActive}:publicData;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
export async function scheduleHolidaySync(db:DB,now:Date,manual=false){
 if(saasEnabled()){if(!manual)return {queued:false};const result=await db.query('SELECT saas_control.request_holidays() queued');return {queued:result.rows[0].queued};}
 const localWorker=holidayKeyReady()&&process.env.RUN_JOBS==='true';
 if(!manual&&!localWorker)return {queued:false};
 if(!manual)await db.query('UPDATE holiday_sync SET worker_heartbeat=$1 WHERE id=1',[now]);
 const state=(await db.query('SELECT * FROM holiday_sync WHERE id=1 FOR UPDATE')).rows[0];
 if(manual)requireThat(holidayWorkerActive(state.worker_heartbeat,now.getTime()),'WORKER_DISABLED','공휴일 동기화 서버의 연결을 확인해 주세요.',503);
 if(!manual&&new Date(state.next_run_at)>now)return {queued:false};
 const pending=await db.query("SELECT 1 FROM tasks WHERE kind='HOLIDAY_SYNC' AND status IN ('PENDING','RUNNING')");
 if(pending.rowCount)return {queued:true};
 if(manual&&state.last_attempt_at)requireThat(now.getTime()-new Date(state.last_attempt_at).getTime()>=60000,'RATE_LIMITED','마지막 조회 후 1분 뒤 다시 동기화할 수 있습니다.',429);
 const year=Number(localDate(now).slice(0,4));await queue(db,'HOLIDAY_SYNC','holidays:'+randomUUID(),{year:String(year)});
 await db.query("UPDATE holiday_sync SET next_run_at=$1::timestamptz+interval '6 hours' WHERE id=1",[now]);return {queued:true};
}
export async function holidayCommand(db:DB,me:Member,action:string,input:unknown,now:Date){
 if(action==='sync'){z.object({}).strict().parse(input);return scheduleHolidaySync(db,now,true);}
 if(action==='acknowledge'){
  const v=z.object({date:z.iso.date()}).strict().parse(input);
  await db.query('UPDATE holiday_sync SET changed_dates=changed_dates-$1::text WHERE id=1',[v.date]);return {date:v.date};
 }
 const common={date:z.iso.date().refine(v=>Number(v.slice(0,4))>=2000&&Number(v.slice(0,4))<=2100),expectedVersion:z.number().int().min(0),reason:z.string().trim().min(2).max(500)};
 if(action==='save'){
  const v=z.object({...common,name:z.string().trim().min(1).max(100).nullable(),sourceUrl:z.url().max(1000).refine(v=>/^https?:\/\//.test(v))}).strict().parse(input);
  const existing=(await db.query('SELECT version FROM holiday_overrides WHERE local_date=$1',[v.date])).rows[0];
  requireThat((existing?.version??0)===v.expectedVersion,'STALE_VERSION','휴일 정보가 변경되었습니다. 목록을 새로 확인해 주세요.');
  await db.query(`INSERT INTO holiday_overrides(local_date,name,source_url,reason,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(${saasEnabled()?'tenant_id,':''}local_date) DO UPDATE SET name=$2,source_url=$3,reason=$4,updated_by=$5,updated_at=$6,version=nextval('holiday_override_version')`,[v.date,v.name,v.sourceUrl,v.reason,me.id,now]);
  return {date:v.date};
 }
 if(action==='reset'){
  const v=z.object(common).strict().parse(input);const result=await db.query('DELETE FROM holiday_overrides WHERE local_date=$1 AND version=$2',[v.date,v.expectedVersion]);
  requireThat(result.rowCount,'STALE_VERSION','휴일 정보가 변경되었습니다. 다시 확인해 주세요.');return {date:v.date};
 }
 requireThat(false,'INVALID_INPUT','지원하지 않는 휴일 작업입니다.',422);
}
export async function syncHolidayTask(task:{id:string;lease_token:string;payload:Record<string,string>},request:typeof fetch=fetch){
 const year=z.coerce.number().int().min(2000).max(2099).parse(task.payload.year);
 await pool().query('UPDATE holiday_sync SET last_attempt_at=clock_timestamp() WHERE id=1');
 try{
  const results=await Promise.all([fetchHolidayYear(year,request),fetchHolidayYear(year+1,request)]);
  await transaction(async(db,now)=>{
   const lease=await db.query("SELECT 1 FROM tasks WHERE id=$1 AND lease_token=$2 AND status='RUNNING' AND lease_until>clock_timestamp()",[task.id,task.lease_token]);requireThat(lease.rowCount,'LEASE_EXPIRED','갱신 작업이 만료되었습니다.');
   const changed:string[]=[];
   for(let i=0;i<2;i++){
    const previous=await holidayYear(db,year+i),current=results[i];
    await db.query('INSERT INTO holiday_years(year,days,synced_at) VALUES($1,$2,$3) ON CONFLICT(year) DO UPDATE SET days=$2,synced_at=$3',[year+i,JSON.stringify(current),now]);
    const next=await holidayYear(db,year+i);
    changed.push(...[...new Set([...Object.keys(previous.days),...Object.keys(next.days)])].filter(d=>previous.days[d]!==next.days[d]));
   }
   const prior=(await db.query('SELECT changed_dates FROM holiday_sync WHERE id=1')).rows[0].changed_dates as string[];
   const unreviewed=[...new Set([...prior,...changed])].filter(d=>d>=localDate(now)).sort();
   await db.query('UPDATE holiday_sync SET last_success_at=$1,last_error=NULL,changed_dates=$2 WHERE id=1',[now,JSON.stringify(unreviewed)]);
   await audit(db,null,'holiday.sync',null,'공식 공휴일 동기화',now,randomUUID(),{years:[year,year+1],changedDates:changed});
  });
 }catch(e){
  const code=e instanceof Error&&/^HOLIDAY_[A-Z_]+$/.test(e.message)?e.message:'HOLIDAY_SYNC_FAILED';
  await pool().query("UPDATE holiday_sync SET last_error=$1 WHERE id=1 AND EXISTS(SELECT 1 FROM tasks WHERE id=$2 AND lease_token=$3 AND status='RUNNING' AND lease_until>clock_timestamp())",[code,task.id,task.lease_token]);throw Error(code);
 }
}
