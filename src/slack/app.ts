import {App,LogLevel} from '@slack/bolt';
import {createHash} from 'node:crypto';
import {slackSession} from './identity';
import {snapshot,memberConflicts} from '../server/queries';
import {execute} from '../server/commands';
import {pool} from '../server/db';
import {AppError} from '../server/errors';
import {localDate,localTime} from '../shared/time';
import {home,bookingView,messageView,inputSchema,commandInput,option,type Draft} from './views';
const required=['SLACK_BOT_TOKEN','SLACK_APP_TOKEN','SLACK_WORKSPACE_ID','DATABASE_URL','APP_BASE_URL'];
for(const name of required)if(!process.env[name])throw Error(`Missing ${name}. Configure .env.slack-app.local.`);
if(process.env.SLACK_APP_ENABLED!=='true')throw Error('Set SLACK_APP_ENABLED=true to start the Slack app.');
const base=new URL(process.env.APP_BASE_URL!).origin;
const app=new App({token:process.env.SLACK_BOT_TOKEN,appToken:process.env.SLACK_APP_TOKEN,socketMode:true,logLevel:LogLevel.ERROR});
const readable=(e:unknown)=>e instanceof AppError?e.message:'처리하지 못했습니다. 잠시 후 새로고침하거나 웹에서 확인해 주세요.';
async function publish(team:string,user:string,message?:string){
 let view;try{const session=await slackSession(team,user);view=home(await snapshot(session,localDate()),base,message);}catch(e){view=home(undefined,base,readable(e));}
 await app.client.views.publish({user_id:user,view});
}
app.event('app_home_opened',async({event,body})=>{await publish(body.team_id!,event.user);});
app.action('refresh',async({ack,body})=>{await ack();await publish(body.team?.id??'',body.user.id);});
app.action(/^web/,async({ack})=>{await ack();});
app.action('new_booking',async({ack,body})=>{
 await ack();if(!('trigger_id'in body))return;
 const opened=await app.client.views.open({trigger_id:body.trigger_id,view:messageView('신청 정보를 불러오는 중입니다…')});
 if(!opened.view?.id)return;
 try{const session=await slackSession(body.team?.id??'',body.user.id);const data=await snapshot(session,localDate());if(data.me.role!=='STUDENT')throw new AppError('FORBIDDEN','학생 계정으로 신청해 주세요.');if(!data.rooms.length)throw new AppError('NO_ROOM','운영 중인 회의실이 없습니다.');await app.client.views.update({view_id:opened.view.id,view:bookingView(data)});}catch(e){await app.client.views.update({view_id:opened.view.id,view:messageView(readable(e))});}
});
app.options('students',async({ack,body,options})=>{
 try{const session=await slackSession((body.team?.id??''),body.user.id);const rows=(await pool().query("SELECT id,display_name,class_name FROM members WHERE role='STUDENT' AND status='ACTIVE' AND id<>$1 AND strpos(display_name||' '||class_name,$2)>0 ORDER BY display_name LIMIT 100",[session.memberId,options.value??''])).rows;await ack({options:rows.map(r=>option(r.id,`${r.display_name} · ${r.class_name}`))});}catch{await ack({options:[]});}
});
app.view('booking_submit',async({ack,body,view})=>{
 const v=view.state.values;const parsed=inputSchema.safeParse({date:v.date?.value.selected_date,roomId:v.room?.value.selected_option?.value,time:v.time?.value.selected_time,duration:Number(v.duration?.value.selected_option?.value),inviteeIds:v.people?.students.selected_options?.map(o=>o.value)??[]});
 if(!parsed.success){await ack({response_action:'errors',errors:{people:'날짜·시간과 초대할 학생을 확인해 주세요.'}});return;}
 const draft:Draft=parsed.data;
 await ack({response_action:'update',view:messageView('예약 처리 중입니다. 완료 결과를 확인해 주세요. 닫았다면 앱 홈에서 내 예약을 확인할 수 있습니다.')});
 try{
  const session=await slackSession((body.team?.id??''),body.user.id);const input=commandInput(draft);
  const data=await snapshot(session,draft.date);
  const key='slack:'+createHash('sha256').update((body.team?.id??'')+':'+body.user.id+':'+view.id+':'+view.hash+':'+JSON.stringify(input)).digest('hex');
  const result=await execute(session,'booking.create',input,key);
  if(result.error){
  const conflicts=await memberConflicts(session,[session.memberId,...draft.inviteeIds],input.startsAt,input.endsAt);
  if(conflicts.length){const names=conflicts.map(c=>`${c.member_id===data.me.id?data.me.display_name:data.students.find(s=>s.id===c.member_id)?.display_name??'구성원'} · ${localTime(c.starts_at)}–${localTime(c.ends_at)}`);await app.client.views.update({view_id:view.id,view:bookingView(data,draft,'시간 겹침: '+names.join(', '))});return;}
await app.client.views.update({view_id:view.id,view:bookingView(data,draft,result.error.message)});return;}
  await app.client.views.update({view_id:view.id,view:messageView('예약이 확정되었습니다. 초대한 구성원도 자동 참여했습니다. 앱 홈에서 확인하세요.')}).catch(()=>{});
  await publish((body.team?.id??''),body.user.id);
 }catch(e){await app.client.views.update({view_id:view.id,view:messageView(readable(e))}).catch(()=>{});}
});
app.error(async()=>{console.error('booking.slack-app: request failed (details redacted)');});
const auth=await app.client.auth.test();if(auth.team_id!==process.env.SLACK_WORKSPACE_ID)throw Error('Bot workspace does not match SLACK_WORKSPACE_ID.');
await app.start();console.log('Slack booking app connected via Socket Mode.');
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.stop().then(()=>pool().end()).finally(()=>process.exit(0));});
