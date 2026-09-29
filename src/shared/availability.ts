import type {Snapshot} from './types';
import {addDays,at,localDate,timeNumber,timeText} from './time';

type Calendar=Pick<Snapshot,'date'|'now'|'rules'|'rooms'|'closed'|'reservations'>;
export function dateProblem(data:Calendar,date:string,now=new Date(data.now).getTime()){
 if(data.date!==date)return '선택한 날짜의 예약 정보를 확인하고 있습니다.';
 const today=localDate(new Date(now));
 if(date<today)return '지난 날짜에는 신청할 수 없습니다.';
 if(date>addDays(today,data.rules.windowDays))return `신청 가능 기간 밖입니다. ${today}부터 ${addDays(today,data.rules.windowDays)}까지 신청할 수 있습니다.`;
 return '';
}
export function periodProblem(data:Calendar,date:string,roomId:string,time:string,duration:number,now=new Date(data.now).getTime()){
 const dayError=dateProblem(data,date,now);if(dayError)return dayError;
 if(!data.rooms.some(r=>r.id===roomId))return '운영 중인 회의실을 선택해 주세요.';
 const start=at(date,time),end=new Date(start.getTime()+duration*60000),rules=data.rules;
 if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||duration<=0||duration>rules.maxMinutes||duration%rules.slotMinutes!==0||timeNumber(time)%rules.slotMinutes!==0)return `${rules.slotMinutes}분 단위, 최대 ${rules.maxMinutes}분으로 선택해 주세요.`;
 if(start.getTime()<=now)return '이미 시작한 시간입니다.';
 if(localDate(end)!==date)return '같은 날짜 안에서 이용 시간을 선택해 주세요.';
 const exceptions=data.closed.filter(e=>e.room_id===null||e.room_id===roomId);
 if(exceptions.some(e=>e.kind==='CLOSED'&&start<at(date,e.local_end)&&end>at(date,e.local_start)))return '휴관 시간입니다.';
 const regular=rules.weekdays.includes(new Date(date+'T00:00:00Z').getUTCDay())&&start>=at(date,rules.open)&&end<=at(date,rules.close);
 if(!regular&&!exceptions.some(e=>e.kind==='OPEN'&&start>=at(date,e.local_start)&&end<=at(date,e.local_end)))return '운영시간 밖입니다.';
 if(data.reservations.some(r=>r.room_id===roomId&&!['CANCELLED','ENDED'].includes(r.status)&&start<new Date(r.ends_at)&&end>new Date(r.starts_at)))return '다른 예약과 겹칩니다.';
 return '';
}
export function availableDurations(data:Calendar,date:string,roomId:string,time:string,now=new Date(data.now).getTime()){
 return Array.from({length:Math.floor(data.rules.maxMinutes/data.rules.slotMinutes)},(_,i)=>(i+1)*data.rules.slotMinutes).filter(n=>!periodProblem(data,date,roomId,time,n,now));
}
export function calendarSlots(data:Calendar){
 const opens=data.closed.filter(e=>e.kind==='OPEN');
 const from=Math.min(timeNumber(data.rules.open),...opens.map(e=>timeNumber(e.local_start))),to=Math.max(timeNumber(data.rules.close),...opens.map(e=>timeNumber(e.local_end)));
 const first=Math.ceil(from/data.rules.slotMinutes)*data.rules.slotMinutes;
 return {from:first,to,slots:Array.from({length:Math.max(0,Math.ceil((to-first)/data.rules.slotMinutes))},(_,i)=>timeText(first+i*data.rules.slotMinutes))};
}
