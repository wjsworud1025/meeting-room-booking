export const minutes=(n:number)=>n*60000;
export const localDate=(date:Date|string=new Date())=>new Date(new Date(date).getTime()+9*3600000).toISOString().slice(0,10);
export const localTime=(date:Date|string)=>new Date(new Date(date).getTime()+9*3600000).toISOString().slice(11,16);
export const at=(date:string,time:string)=>new Date(`${date}T${time}:00+09:00`);
export const addDays=(date:string,days:number)=>new Date(new Date(date+'T00:00:00Z').getTime()+days*86400000).toISOString().slice(0,10);
export const timeNumber=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3,5));
export const timeText=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export const dateLabel=(s:string,year=true)=>new Intl.DateTimeFormat('ko-KR',{year:year?'numeric':undefined,month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'}).format(new Date(s+'T00:00:00+09:00'));
