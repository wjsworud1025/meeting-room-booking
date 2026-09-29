import {z} from 'zod';
import type {HomeView,ModalView,KnownBlock,PlainTextOption} from '@slack/types';
import type {Snapshot} from '../shared/types';
import {localDate,localTime,at} from '../shared/time';
export const plain=(text:string)=>({type:'plain_text' as const,text:text.slice(0,150),emoji:false});
export const option=(value:string,label:string):PlainTextOption=>({text:plain(label.slice(0,75)),value});
export const paragraph=(text:string):KnownBlock=>({type:'section',text:{type:'plain_text',text:text.slice(0,2900)}});
export const inputSchema=z.object({date:z.iso.date(),roomId:z.uuid(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),duration:z.union([z.literal(30),z.literal(60),z.literal(90),z.literal(120)]),inviteeIds:z.array(z.uuid()).min(1).max(99)});
export type Draft=z.infer<typeof inputSchema>;
export function commandInput(draft:Draft){const v=inputSchema.parse(draft);return {roomId:v.roomId,startsAt:at(v.date,v.time).toISOString(),endsAt:new Date(at(v.date,v.time).getTime()+v.duration*60000).toISOString(),inviteeIds:[...new Set(v.inviteeIds)]};}
export function messageView(text:string):ModalView{return {type:'modal',title:plain('회의실 예약'),close:plain('닫기'),blocks:[paragraph(text)]};}
export function home(data:Snapshot|undefined,base:string,message?:string,team?:string):HomeView{
 const blocks:KnownBlock[]=[{type:'header',text:plain('회의실 예약')},paragraph(message??'예약 신청과 내 예약을 Slack에서 확인하세요.')];
 const elements:({type:'button';text:ReturnType<typeof plain>;action_id:string;url?:string})[]=[{type:'button',text:plain('웹 시간표 열기'),action_id:'web',url:base+'/schedule'},{type:'button',text:plain('새로고침'),action_id:'refresh'}];
 if(data?.me.role==='STUDENT')elements.unshift({type:'button',text:plain('예약 신청'),action_id:'new_booking'});
 if(!data)elements.unshift({type:'button',text:plain('학생·관리자 계정 연결'),action_id:'web_login',url:base+'/login'+(team?'?slack_team='+encodeURIComponent(team)+'&slack_app=1':'')});
 if(data?.me.role==='ADMIN')elements.unshift({type:'button',text:plain('관리자 웹 열기'),action_id:'web_admin',url:base+'/admin/reservations'});
 blocks.push({type:'actions',elements});
 if(data){const active=data.mine.filter(r=>!['CANCELLED','ENDED'].includes(r.status)).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));blocks.push(paragraph('내 예약 · 초대받아 참여 중인 예약'));
 for(const r of active.slice(0,15))blocks.push(paragraph(`${localDate(r.starts_at)} ${localTime(r.starts_at)}–${localTime(r.ends_at)} · ${data.rooms.find(room=>room.id===r.room_id)?.name??'회의실'}\n${r.organizer_id===data.me.id?'내가 신청':'초대받아 참여'} · ${r.status==='CONFIRMED'?'예약 확정':'인원 확인 중'} · ${r.accepted_count}명`));
 if(!active.length)blocks.push(paragraph('예정된 예약이 없습니다.'));if(active.length>15)blocks.push(paragraph('최근 15건을 표시합니다. 전체 예약은 웹에서 확인하세요.'));}
 return {type:'home',blocks};
}
export function bookingView(data:Snapshot,draft?:Draft,error?:string):ModalView{
 const rooms=data.rooms.slice(0,100).map(r=>option(r.id,`${r.name} · ${r.minimum}~${r.capacity}명`));
 const selected=draft?.inviteeIds.map(id=>option(id,data.students.find(s=>s.id===id)?.display_name??'구성원'));
 return {type:'modal',callback_id:'booking_submit',title:plain('예약 신청'),submit:plain('예약 신청'),close:plain('닫기'),blocks:[
 ...(error?[paragraph(error)]:[]),paragraph('한국 시간 기준 · 구성원은 초대 즉시 참여합니다. 신청 시 운영시간·중복·인원을 다시 확인합니다.'),
 {type:'input',block_id:'date',label:plain('이용 날짜'),element:{type:'datepicker',action_id:'value',initial_date:draft?.date??localDate(data.now)}},
 {type:'input',block_id:'room',label:plain('회의실'),element:{type:'static_select',action_id:'value',options:rooms,initial_option:rooms.find(r=>r.value===draft?.roomId)??rooms[0]}},
 {type:'input',block_id:'time',label:plain('시작 시간 (한국 시간)'),element:{type:'timepicker',action_id:'value',initial_time:draft?.time??data.rules.open}},
 {type:'input',block_id:'duration',label:plain('이용 시간'),element:{type:'static_select',action_id:'value',options:[30,60,90,120].map(n=>option(String(n),`${n}분`)),initial_option:option(String(draft?.duration??60),`${draft?.duration??60}분`)}},
 {type:'input',block_id:'people',label:plain('초대할 학생'),element:{type:'multi_external_select',action_id:'students',min_query_length:0,max_selected_items:99,placeholder:plain('이름 또는 반 검색'),...(selected?.length?{initial_options:selected}:{})}}
 ]};
}
