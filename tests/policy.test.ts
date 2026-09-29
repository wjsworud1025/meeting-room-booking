import {describe,it,expect} from 'vitest';
import {sameGroup,validWindow,ensureOpen,defaultRules,checkFairness} from '../src/server/policy';
import {at,localDate,addDays} from '../src/shared/time';
import type {Rules,Reservation} from '../src/shared/types';
const rules:Rules={...defaultRules,rooms:{}};
describe('예약 정책 경계',()=>{
 it('정확히 50%와 엄격한 초과',()=>{expect(sameGroup(['A','B','C','D'],['A','B','E','F'])).toBe(false);expect(sameGroup(['A','B','C','D'],['A','B','C','E'])).toBe(true);expect(sameGroup(['A','B'],['A','B','C','D'])).toBe(true);});
 it('기관 날짜와 오늘+3일',()=>{const now=at('2026-10-06','17:00');expect(()=>validWindow(at('2026-10-09','18:00').toISOString(),at('2026-10-09','19:00').toISOString(),now,rules)).not.toThrow();expect(()=>validWindow(at('2026-10-10','18:00').toISOString(),at('2026-10-10','19:00').toISOString(),now,rules)).toThrow();expect(localDate('2026-10-06T16:00:00Z')).toBe('2026-10-07');});
 it('21시 마지막 슬롯, 운영 종료 초과 차단',()=>{expect(()=>ensureOpen(at('2026-10-06','21:00').toISOString(),at('2026-10-06','21:30').toISOString(),'room',rules,[])).not.toThrow();expect(()=>ensureOpen(at('2026-10-06','21:00').toISOString(),at('2026-10-06','22:00').toISOString(),'room',rules,[])).toThrow();});
 it('전체 휴관은 방별 개방보다 우선',()=>{expect(()=>ensureOpen(at('2026-10-06','18:00').toISOString(),at('2026-10-06','19:00').toISOString(),'room',rules,[{room_id:null,kind:'CLOSED',local_start:'18:00',local_end:'20:00'},{room_id:'room',kind:'OPEN',local_start:'18:00',local_end:'21:00'}])).toThrow();});
 it('시작 정각 및 2시간 초과 거절',()=>{const now=at('2026-10-06','18:00');expect(()=>validWindow(now.toISOString(),at('2026-10-06','19:00').toISOString(),now,rules)).toThrow();expect(()=>validWindow(at('2026-10-06','18:30').toISOString(),at('2026-10-06','21:00').toISOString(),now,rules)).toThrow();});
 it('공정성 판정은 59분 거절, 60분 허용 및 앞뒤 대칭',()=>{
  const make=(id:string,start:string,end:string)=>({id,status:'CONFIRMED',starts_at:start,ends_at:end,first_confirmed_member_ids:['A','B'],minimum_snapshot:2,participants:[{status:'ACCEPTED',member_id:'A'},{status:'ACCEPTED',member_id:'B'}]}) as Reservation;
  const a=make('a','2026-10-06T09:00:00Z','2026-10-06T10:00:00Z'),b=make('b','2026-10-06T10:59:00Z','2026-10-06T11:59:00Z'),now=at('2026-10-06','17:00');expect(()=>checkFairness(b,[a],now,rules)).toThrow();expect(()=>checkFairness(a,[b],now,rules)).toThrow();b.starts_at='2026-10-06T11:00:00Z';expect(()=>checkFairness(b,[a],now,rules)).not.toThrow();
 });
});
