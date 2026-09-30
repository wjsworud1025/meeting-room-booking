import {schedulerPool,pool} from '../db';
import {fetchHolidayYear,holidayKeyReady} from '../holidays';
import {localDate} from '../../shared/time';
/** Globally leased public-source cache; never uses a tenant's task payload. */
export async function tickSharedHolidays(request:typeof fetch=fetch){
 if(!holidayKeyReady())return false;
 const token=(await schedulerPool().query('SELECT saas_control.claim_holidays() token')).rows[0].token;
 if(!token)return false;
 try{
  const year=Number(localDate(new Date()).slice(0,4));
  const years=await Promise.all([fetchHolidayYear(year,request),fetchHolidayYear(year+1,request)]);
  const saved=(await schedulerPool().query('SELECT saas_control.finish_holidays($1,$2,$3) saved',[token,year,JSON.stringify(years)])).rows[0].saved;
  if(!saved)throw Error('HOLIDAY_LEASE_EXPIRED');return true;
 }catch{await schedulerPool().query('SELECT saas_control.fail_holidays($1)',[token]);return false;}
}
/** Legacy Supabase provisioning cannot safely represent workspace-scoped identities. */
export async function retireLegacyTasks(){
 await pool().query(`UPDATE tasks SET status='FAILED',lease_until=NULL,last_error_code='SAAS_SLACK_MEMBERSHIP_REQUIRED'
 WHERE kind='MEMBER_PROVISION' AND (status='PENDING' OR status='RUNNING' AND lease_until<clock_timestamp())`);
 await pool().query(`UPDATE tasks SET status='DONE',lease_until=NULL,result_summary='{"replacedBy":"shared-holiday-cache"}'
 WHERE kind='HOLIDAY_SYNC' AND (status='PENDING' OR status='RUNNING' AND lease_until<clock_timestamp())`);
}
