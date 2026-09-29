import {describe,it,expect} from 'vitest';
import {availableDurations,calendarSlots,dateProblem,periodProblem} from '../src/shared/availability';
import {defaultRules,ensureOpen,validWindow} from '../src/server/policy';
import {at} from '../src/shared/time';
import type {Snapshot,Reservation} from '../src/shared/types';
const date='2026-10-06',now=at(date,'17:00');
const base:Pick<Snapshot,'date'|'now'|'rooms'|'closed'|'rules'|'reservations'>={date,now:now.toISOString(),rules:{...defaultRules,rooms:{room:{capacity:4,minimum:2}}},rooms:[{id:'room',name:'회의실',active:true,display_order:1,capacity:4,minimum:2}],closed:[],reservations:[]};
describe('학생 화면의 신청 가능 시간',()=>{
 it('운영 종료 전 30분만 제안하고 초과 신청을 설명한다',()=>{expect(availableDurations(base,date,'room','21:00')).toEqual([30]);expect(periodProblem(base,date,'room','21:00',120)).toBe('운영시간 밖입니다.');});
 it('선택한 첫 슬롯 다음의 예약도 연속 이용 시간에서 제외한다',()=>{const data={...base,reservations:[{id:'other',room_id:'room',starts_at:at(date,'18:30').toISOString(),ends_at:at(date,'19:00').toISOString(),status:'CONFIRMED'} as Reservation]};expect(availableDurations(data,date,'room','18:00')).toEqual([30]);expect(availableDurations(data,date,'room','19:00')).toEqual([30,60,90,120]);});
 it('새 날짜 자료를 받기 전에는 선택을 허용하지 않는다',()=>{expect(dateProblem(base,'2026-10-07')).toContain('확인');expect(availableDurations(base,'2026-10-07','room','18:00')).toEqual([]);});
 it('기간 밖·지난 시간·휴관 사유를 구분한다',()=>{expect(dateProblem({...base,date:'2026-10-10'},'2026-10-10')).toContain('기간 밖');expect(periodProblem(base,date,'room','17:00',30)).toContain('이미 시작');expect(periodProblem({...base,closed:[{room_id:null,kind:'CLOSED',local_start:'18:00',local_end:'19:00'}]},date,'room','18:00',30)).toBe('휴관 시간입니다.');});
 it('예외 개방은 시간표 범위를 늘리지만 휴관이 우선한다',()=>{const data={...base,closed:[{room_id:null,kind:'OPEN',local_start:'21:30',local_end:'23:00'},{room_id:'room',kind:'CLOSED',local_start:'22:00',local_end:'22:30'}]};expect(calendarSlots(data).slots).toContain('22:30');expect(availableDurations(data,date,'room','21:30')).toEqual([30]);expect(availableDurations(data,date,'room','22:30')).toEqual([30]);});
 it('변경된 슬롯·최대시간·운영 정책에 대해 서버 시간 검증과 일치한다',()=>{
  for(const slotMinutes of [15,30,45])for(const day of ['2026-10-06','2026-10-10']){
   const data={...base,date:day,rules:{...base.rules,windowDays:7,slotMinutes,maxMinutes:90},closed:[{room_id:null,kind:'OPEN',local_start:'20:00',local_end:'23:00'},{room_id:null,kind:'CLOSED',local_start:'20:30',local_end:'21:00'}]};
   for(const time of ['18:00','18:15','18:30','20:00','20:30','21:00','22:30'])for(const duration of [15,30,45,60,90,120]){
    const start=at(day,time).toISOString(),end=new Date(at(day,time).getTime()+duration*60000).toISOString();let allowed=true;
    try{validWindow(start,end,now,data.rules);ensureOpen(start,end,'room',data.rules,data.closed);}catch{allowed=false;}
    expect(!periodProblem(data,day,'room',time,duration),`${day} ${time} ${duration} ${slotMinutes}`).toBe(allowed);
   }
  }
 });
});

 describe('예약 기간과 예외 개방의 구분',()=>{
  const day='2026-10-05';
  const data={...base,date:day,now:at('2026-09-29','14:00').toISOString(),closed:[{room_id:'room',kind:'OPEN',local_start:'09:00',local_end:'21:30'}]};
  it('10월 5일 개방은 시간표에 반영되지만 9월 29일에는 예약 기간 밖이다',()=>{
   expect(calendarSlots(data).slots[0]).toBe('09:00');
   expect(periodProblem(data,day,'room','09:00',30)).toContain('신청 가능 기간 밖');
  });
  it('10월 2일이 되면 같은 예외 개방 시간에 신청할 수 있다',()=>{
   expect(periodProblem(data,day,'room','09:00',30,at('2026-10-02','00:00').getTime())).toBe('');
   expect(periodProblem({...data,closed:[]},day,'room','09:00',30,at('2026-10-02','00:00').getTime())).toBe('운영시간 밖입니다.');
  });
 });
