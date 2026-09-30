import type {Reservation,Rules} from '../shared/types';
import {at,localDate,localTime,timeNumber,minutes,addDays} from '../shared/time';
import {requireThat} from './errors';
export const defaultRules:Omit<Rules,'rooms'>={windowDays:3,slotMinutes:30,maxMinutes:120,holdMinutes:10,refillMinutes:10,cooldownMinutes:10,gapMinutes:60,threshold:50,open:'18:00',close:'21:30',weekdays:[1,2,3,4,5]};
export const overlaps=(a:string,b:string,c:string,d:string)=>new Date(a)<new Date(d)&&new Date(c)<new Date(b);
export const sameGroup=(a:string[],b:string[],threshold=50)=>a.length>0&&b.length>0&&a.filter(x=>b.includes(x)).length*100>Math.min(a.length,b.length)*threshold;
export function validWindow(start:string,end:string,now:Date,rules:Rules){
 const s=new Date(start),e=new Date(end),day=localDate(s),length=(e.getTime()-s.getTime())/60000;
 requireThat(Number.isFinite(s.getTime())&&Number.isFinite(e.getTime()),'INVALID_INPUT','올바른 날짜와 시간을 입력해 주세요.',422);
 requireThat(s>now,'RESERVATION_STARTED','시작 전인 시간을 선택해 주세요.');
 requireThat(day>=localDate(now)&&day<=addDays(localDate(now),rules.windowDays),'OUTSIDE_BOOKING_WINDOW',`오늘부터 ${rules.windowDays}일 뒤까지 신청할 수 있습니다.`);
 requireThat(length>0&&length<=rules.maxMinutes&&length%rules.slotMinutes===0&&timeNumber(localTime(s))%rules.slotMinutes===0&&s.getUTCSeconds()===0&&s.getUTCMilliseconds()===0&&e.getUTCSeconds()===0&&e.getUTCMilliseconds()===0,'INVALID_INPUT',`${rules.slotMinutes}분 단위, 최대 ${rules.maxMinutes}분으로 선택해 주세요.`,422);
 requireThat(localDate(e)===day,'OUTSIDE_OPENING_HOURS','운영 날짜 안에서 이용 시간을 선택해 주세요.');
}
export function ensureOpen(start:string,end:string,roomId:string,rules:Rules,exceptions:{room_id:string|null;kind:string;local_start:string;local_end:string}[],holiday=false){
 const date=localDate(start),s=new Date(start),e=new Date(end),weekday=new Date(date+'T00:00:00Z').getUTCDay();
 const matching=exceptions.filter(x=>x.room_id===null||x.room_id===roomId);
 requireThat(!matching.some(x=>x.kind==='CLOSED'&&s<at(date,x.local_end)&&e>at(date,x.local_start)),'OUTSIDE_OPENING_HOURS','휴관 시간입니다. 다른 시간을 선택해 주세요.');
 const open=(!holiday&&rules.weekdays.includes(weekday)&&s>=at(date,rules.open)&&e<=at(date,rules.close))||matching.some(x=>x.kind==='OPEN'&&s>=at(date,x.local_start)&&e<=at(date,x.local_end));
 requireThat(open,'OUTSIDE_OPENING_HOURS','운영시간 안에서 이용 시간을 선택해 주세요.');
}
export function rosterSets(r:Reservation,now:Date):string[][]{
 if(['CANCELLED','HOLDING'].includes(r.status))return [];
 const sets:string[][]=[];if(r.first_confirmed_member_ids)sets.push(r.first_confirmed_member_ids);
 if(new Date(r.starts_at)<=now){if(r.start_member_ids)sets.push(r.start_member_ids);}
 else {const current=r.participants.filter(x=>x.status==='ACCEPTED').map(x=>x.member_id);if(current.length>=r.minimum_snapshot)sets.push(current);}
 return sets;
}
export function checkFairness(candidate:Reservation,others:Reservation[],now:Date,rules:Rules){
 const sets=rosterSets(candidate,now);
 for(const other of others){
  if(other.id===candidate.id)continue;
  const separation=Math.max(new Date(candidate.starts_at).getTime()-new Date(other.ends_at).getTime(),new Date(other.starts_at).getTime()-new Date(candidate.ends_at).getTime());
  if(separation>=minutes(rules.gapMinutes))continue;
  requireThat(!sets.some(a=>rosterSets(other,now).some(b=>sameGroup(a,b,rules.threshold))),'GROUP_GAP_REQUIRED',`같은 모임은 앞 예약 종료 후 ${rules.gapMinutes}분 간격이 필요합니다.`);
 }
}
