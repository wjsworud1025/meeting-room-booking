import {describe,it,expect} from 'vitest';
import {studentImport,validPeriod} from '../src/shared/admin-ux';
describe('admin input safety',()=>{
 it('rejects blank, reversed and malformed time ranges',()=>{for(const pair of [['','21:30'],['22:00','21:00'],['25:00','26:00']])expect(validPeriod(...pair as [string,string])).toBe(false);expect(validPeriod('09:00','21:30')).toBe(true);});
 it('keeps source line numbers and normalizes email',()=>{const x=studentImport('이름,이메일,반\n\n홍길동,HELLO@example.com,A');expect(x.errors).toEqual([]);expect(x.rows[0]).toMatchObject({line:3,email:'hello@example.com'});});
 it('blocks duplicates and existing active accounts',()=>{const x=studentImport('가,a@example.com,A\n나,A@example.com,B',[{email:'a@example.com',status:'ACTIVE'}]);expect(x.errors.some(e=>e.includes('중복'))).toBe(true);expect(x.errors.some(e=>e.includes('이미 등록'))).toBe(true);});
 it('rejects role columns and excessive rows',()=>{expect(studentImport('name,email,role\n가,a@example.com,ADMIN').errors.length).toBeGreaterThan(0);expect(studentImport(Array.from({length:201},(_,i)=>`가,a${i}@example.com,A`).join('\n')).errors).toContain('한 번에 최대 200명까지 등록할 수 있습니다.');});
});
