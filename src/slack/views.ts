import {z} from 'zod';
import type {HomeView,ModalView,KnownBlock,PlainTextOption} from '@slack/types';
import type {Snapshot} from '../shared/types';
import {localDate,localTime,at} from '../shared/time';
export const plain=(text:string)=>({type:'plain_text' as const,text:text.slice(0,150),emoji:false});
export const option=(value:string,label:string):PlainTextOption=>({text:plain(label.slice(0,75)),value});
export const paragraph=(text:string):KnownBlock=>({type:'section',text:{type:'plain_text',text:text.slice(0,2900)}});
export const inputSchema=z.object({date:z.iso.date(),roomId:z.uuid(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),duration:z.union([z.literal(30),z.literal(60),z.literal(90),z.literal(120)]),inviteeIds:z.array(z.uuid()).min(1).max(99)});
export const nativeInputSchema=inputSchema.extend({inviteeIds:z.array(z.string().regex(/^[UW][A-Z0-9]{2,}$/)).min(1).max(99)});
export type Draft=z.infer<typeof inputSchema>;
export function commandInput(draft:Draft){const v=inputSchema.parse(draft);return {roomId:v.roomId,startsAt:at(v.date,v.time).toISOString(),endsAt:new Date(at(v.date,v.time).getTime()+v.duration*60000).toISOString(),inviteeIds:[...new Set(v.inviteeIds)]};}
export function messageView(text:string):ModalView{return {type:'modal',title:plain('회의실 예약'),close:plain('닫기'),blocks:[paragraph(text)]};}
export function home(data:Snapshot|undefined,base:string,message?:string,team?:string,native=false,links:Record<string,string>={}):HomeView{
 const adminLogin:KnownBlock={type:'context',elements:[{type:'mrkdwn',text:'<'+base+'/admin/login|운영 담당자 로그인>'}]};
 const blocks:KnownBlock[]=[{type:'header',text:plain('회의실 예약')}];
 if(message)blocks.push(paragraph(message));
 if(!data){blocks.push(paragraph('Slack에서 다시 열어 주세요.'),{type:'actions',elements:[{type:'button',text:plain('다시 시도'),action_id:'refresh'}]});if(!native)blocks.push({type:'actions',elements:[{type:'button',text:plain('계정 연결'),action_id:'web_login',url:base+'/login'+(team?'?slack_team='+encodeURIComponent(team)+'&slack_app=1':'')}]});blocks.push(adminLogin);return {type:'home',blocks};}
 blocks.push({type:'actions',elements:[data.me.role==='ADMIN'&&data.me.status==='ACTIVE'&&links['/admin/reservations']?{type:'button',text:plain('관리자 페이지'),action_id:'open_web',url:links['/admin/reservations'],value:links['/admin/reservations']?.split('#')[1]??''}:native?{type:'button',text:plain('회의실 예약하기'),style:'primary',action_id:'open_web',url:links['/schedule'],value:links['/schedule']?.split('#')[1]??''}:{type:'button',text:plain('회의실 예약하기'),style:'primary',action_id:'web_schedule',url:base+'/schedule'},{type:'button',text:plain('새로고침'),action_id:'refresh'}]});
 blocks.push({type:'divider'},{type:'header',text:plain('내 예약')});
 const active=data.mine.filter(r=>!['CANCELLED','ENDED'].includes(r.status)).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
 for(const r of active.slice(0,3)){
  blocks.push(paragraph(`${localDate(r.starts_at)}  ${localTime(r.starts_at)}–${localTime(r.ends_at)}\n${data.rooms.find(room=>room.id===r.room_id)?.name??'회의실'} · ${r.status==='CONFIRMED'?'확정':'인원 확인 중'} · ${r.accepted_count}명`));
  blocks.push({type:'actions',elements:[native?{type:'button',text:plain('예약 관리'),action_id:'open_web',url:links['/reservations/'+r.id],value:links['/reservations/'+r.id]?.split('#')[1]??''}:{type:'button',text:plain('예약 관리'),action_id:'web_detail',url:base+'/reservations/'+r.id}]});
 }
 if(!active.length)blocks.push(paragraph('예정된 예약이 없습니다.'));
 blocks.push({type:'divider'},adminLogin);
 return {type:'home',blocks};
}
export function bookingView(data:Snapshot,draft?:Draft,error?:string,native=false):ModalView{
 const rooms=data.rooms.slice(0,100).map(r=>option(r.id,`${r.name} · ${r.minimum}~${r.capacity}명`));
 const selected=draft?.inviteeIds.map(id=>option(id,data.students.find(s=>s.id===id)?.display_name??'구성원'));
 return {type:'modal',callback_id:native?'booking_submit_native':'booking_submit',title:plain('예약 신청'),submit:plain('예약 신청'),close:plain('닫기'),blocks:[
 ...(error?[paragraph(error)]:[]),paragraph('한국 시간 기준 · 구성원은 초대 즉시 참여합니다. 신청 시 운영시간·중복·인원을 다시 확인합니다.'),
 {type:'input',block_id:'date',label:plain('이용 날짜'),element:{type:'datepicker',action_id:'value',initial_date:draft?.date??localDate(data.now)}},
 {type:'input',block_id:'room',label:plain('회의실'),element:{type:'static_select',action_id:'value',options:rooms,initial_option:rooms.find(r=>r.value===draft?.roomId)??rooms[0]}},
 {type:'input',block_id:'time',label:plain('시작 시간 (한국 시간)'),element:{type:'timepicker',action_id:'value',initial_time:draft?.time??data.rules.open}},
 {type:'input',block_id:'duration',label:plain('이용 시간'),element:{type:'static_select',action_id:'value',options:[30,60,90,120].map(n=>option(String(n),`${n}분`)),initial_option:option(String(draft?.duration??60),`${draft?.duration??60}분`)}},
 {type:'input',block_id:'people',label:plain(native?'같은 클래스의 참여자':'초대할 학생'),element:native?{type:'multi_users_select',action_id:'students',max_selected_items:Math.max(1,Math.min(99,Math.max(...data.rooms.map(r=>r.capacity))-1)),placeholder:plain('Slack 구성원 선택'),...(draft?.inviteeIds.length?{initial_users:draft.inviteeIds}:{})}:{type:'multi_external_select',action_id:'students',min_query_length:0,max_selected_items:99,placeholder:plain('이름 또는 반 검색'),...(selected?.length?{initial_options:selected}:{})}}
 ]};
}
