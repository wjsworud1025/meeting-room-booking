import {it,expect} from 'vitest';
import {holidayName,holidayYearAvailable,monthDays} from '../src/shared/holidays';
it('설·추석 연휴와 대체공휴일을 구분한다',()=>{expect(holidayName('2026-09-25')).toBe('추석');expect(holidayName('2026-10-05')).toContain('대체공휴일');expect(holidayName('2027-02-09')).toContain('설날');});
it('최근 공휴일 추가와 대체가 없는 날을 반영한다',()=>{expect(holidayName('2026-05-01')).toBe('노동절');expect(holidayName('2026-07-17')).toBe('제헌절');expect(holidayName('2026-06-08')).toBeNull();});
it('지원하지 않는 연도는 휴일 없음으로 단정하지 않는다',()=>{expect(holidayYearAvailable(2028)).toBe(false);expect(holidayYearAvailable(2027)).toBe(true);});
it('월 경계와 요일 정렬을 유지한다',()=>{const days=monthDays('2026-10');expect(days.slice(0,4)).toEqual([null,null,null,null]);expect(days.filter(Boolean)).toHaveLength(31);expect(days.length%7).toBe(0);expect(monthDays('2028-02').filter(Boolean)).toHaveLength(29);});
