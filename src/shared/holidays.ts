// Reviewed 2026-09-29. Display-only data; facility closures remain explicit admin decisions.
// Sources: https://astro.kasi.re.kr/kor/life/post/calendarData?search_year=2026
// https://astro.kasi.re.kr/kor/life/post/calendarData?search_year=2027
// https://www.kasa.go.kr/prog/plcyBrf/brief/kor/sub01_01_04/view.do?plcyBrfNo=431
// 2026 additions: MPM Labor Day announcement (2026-04-06), MOFA Constitution Day notice.
export const bundledHolidays:Record<string,string>={
 '2026-01-01':'신정','2026-02-16':'설 연휴','2026-02-17':'설날','2026-02-18':'설 연휴',
 '2026-03-01':'삼일절','2026-03-02':'대체공휴일 (삼일절)','2026-05-01':'노동절','2026-05-05':'어린이날',
 '2026-05-24':'부처님오신날','2026-05-25':'대체공휴일 (부처님오신날)','2026-06-03':'전국동시지방선거','2026-06-06':'현충일',
 '2026-07-17':'제헌절','2026-08-15':'광복절','2026-08-17':'대체공휴일 (광복절)',
 '2026-09-24':'추석 연휴','2026-09-25':'추석','2026-09-26':'추석 연휴',
 '2026-10-03':'개천절','2026-10-05':'대체공휴일 (개천절)','2026-10-09':'한글날','2026-12-25':'성탄절',
 '2027-01-01':'신정','2027-02-06':'설 연휴','2027-02-07':'설날','2027-02-08':'설 연휴','2027-02-09':'대체공휴일 (설날)',
 '2027-03-01':'삼일절','2027-05-01':'노동절','2027-05-03':'대체공휴일 (노동절)','2027-05-05':'어린이날','2027-05-13':'부처님오신날',
 '2027-06-06':'현충일','2027-07-17':'제헌절','2027-07-19':'대체공휴일 (제헌절)',
 '2027-08-15':'광복절','2027-08-16':'대체공휴일 (광복절)','2027-09-14':'추석 연휴','2027-09-15':'추석','2027-09-16':'추석 연휴',
 '2027-10-03':'개천절','2027-10-04':'대체공휴일 (개천절)','2027-10-09':'한글날','2027-10-11':'대체공휴일 (한글날)',
 '2027-12-25':'성탄절','2027-12-27':'대체공휴일 (성탄절)',
};
export const holidayName=(date:string)=>bundledHolidays[date]??null;
export const bundledYear=(year:number)=>Object.fromEntries(Object.entries(bundledHolidays).filter(([date])=>date.startsWith(year+'-')));
export const holidayYearAvailable=(year:number)=>year===2026||year===2027;
export function monthDays(month:string){const [year,m]=month.split('-').map(Number),offset=new Date(Date.UTC(year,m-1,1)).getUTCDay(),count=new Date(Date.UTC(year,m,0)).getUTCDate();return Array.from({length:Math.ceil((offset+count)/7)*7},(_,i)=>i<offset||i>=offset+count?null:`${month}-${String(i-offset+1).padStart(2,'0')}`);}
