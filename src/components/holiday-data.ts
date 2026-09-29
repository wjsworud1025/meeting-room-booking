import {api} from './api';
export type CalendarData={year:number;days:Record<string,string>;coverage:boolean;source:string;syncedAt:string|null};
const cache=new Map<number,{value:CalendarData;until:number}>(),pending=new Map<number,Promise<CalendarData>>();
export function invalidateHolidays(){cache.clear();}
export function loadHolidays(year:number):Promise<CalendarData>{
 const saved=cache.get(year);if(saved&&saved.until>Date.now())return Promise.resolve(saved.value);
 const running=pending.get(year);if(running)return running;
 const request=api<CalendarData>('holidays?year='+year).then(value=>{cache.set(year,{value,until:Date.now()+60000});return value;}).finally(()=>pending.delete(year));pending.set(year,request);return request;
}
