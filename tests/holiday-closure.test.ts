import {it,expect} from 'vitest';
import {ensureOpen,defaultRules} from '../src/server/policy';
import {periodProblem} from '../src/shared/availability';
import type {Snapshot} from '../src/shared/types';
const rules={...defaultRules,rooms:{},windowDays:10};
const start='2026-10-05T09:00:00Z',end='2026-10-05T10:00:00Z';
it('closes holidays by default and opens only the specified room and interval',()=>{expect(()=>ensureOpen(start,end,'room',rules,[],true)).toThrow();const exceptions=[{room_id:'room',kind:'OPEN',local_start:'18:00',local_end:'19:00'}];expect(()=>ensureOpen(start,end,'room',rules,exceptions,true)).not.toThrow();expect(()=>ensureOpen(start,end,'other',rules,exceptions,true)).toThrow();expect(()=>ensureOpen(start,'2026-10-05T10:30:00Z','room',rules,exceptions,true)).toThrow();expect(()=>ensureOpen(start,end,'room',rules,[...exceptions,{room_id:null,kind:'CLOSED',local_start:'18:00',local_end:'19:00'}],true)).toThrow();});
it('uses the same holiday and exception rules in the student schedule',()=>{const data={date:'2026-10-05',now:'2026-10-01T00:00:00Z',rules,rooms:[{id:'room'}],closed:[],reservations:[],holiday:'대체공휴일'} as unknown as Snapshot;expect(periodProblem(data,data.date,'room','18:00',60)).toContain('공휴일');data.closed=[{room_id:'room',kind:'OPEN',local_start:'18:00',local_end:'19:00'}];expect(periodProblem(data,data.date,'room','18:00',60)).toBe('');});
