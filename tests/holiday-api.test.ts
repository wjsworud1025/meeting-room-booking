import {it,expect} from 'vitest';
import {parseHolidayResponse,fetchHolidayYear} from '../src/server/holidays';
const items=Array.from({length:10},(_,i)=>({locdate:'202610'+String(i+1).padStart(2,'0'),dateName:i===4?'대체공휴일':'시험 휴일 '+i,isHoliday:'Y'}));
const response=(rows=items,total=rows.length)=>JSON.stringify({response:{header:{resultCode:'00'},body:{totalCount:total,items:{item:rows}}}});
it('공식 응답 형태의 JSON과 XML을 읽고 대체공휴일 이름을 보존한다',()=>{
 expect(parseHolidayResponse(response(),2026)['2026-10-05']).toBe('대체공휴일');
 const xml='<response><header><resultCode>00</resultCode></header><body><totalCount>10</totalCount><items>'+items.map(item=>'<item>'+Object.entries(item).map(([key,value])=>`<${key}>${value}</${key}>`).join('')+'</item>').join('')+'</items></body></response>';
 expect(parseHolidayResponse(xml,2026)).toEqual(parseHolidayResponse(response(),2026));
});
it('빈 데이터, 잘린 페이지, 다른 연도, 비정상 날짜를 거절한다',()=>{
 expect(()=>parseHolidayResponse(response([],0),2026)).toThrow('INCOMPLETE');
 expect(()=>parseHolidayResponse(response(items,11),2026)).toThrow('INCOMPLETE');
 expect(()=>parseHolidayResponse(response(),2027)).toThrow('INVALID');
 expect(()=>parseHolidayResponse(response([...items.slice(0,9),{...items[9],locdate:'20260230'}]),2026)).toThrow('INVALID');
});
it('제공기관 오류와 엔티티 선언을 거절한다',()=>{
 expect(()=>parseHolidayResponse(JSON.stringify({response:{header:{resultCode:'30'}}}),2026)).toThrow('PROVIDER');
 expect(()=>parseHolidayResponse('<!DOCTYPE a><response/>',2026)).toThrow('INVALID');
});
it('API 오류 시 인증키나 요청 주소를 오류에 노출하지 않는다',async()=>{
 const old=process.env.HOLIDAY_API_KEY;process.env.HOLIDAY_API_KEY='secret%2Bkey';
 try{await expect(fetchHolidayYear(2026,async(input)=>{const url=new URL(String(input));expect(url.searchParams.get('ServiceKey')).toBe('secret+key');expect(url.searchParams.get('numOfRows')).toBe('1000');return new Response('invalid',{status:403});})).rejects.toThrow('HOLIDAY_HTTP_ERROR');}finally{if(old===undefined)delete process.env.HOLIDAY_API_KEY;else process.env.HOLIDAY_API_KEY=old;}
});
