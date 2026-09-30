import {saasEnabled} from '../server/db';
import {inWorkspace} from '../server/saas/slack-routing';
import {slackAdmin} from '../server/slack-admin';
import type {WebClient} from '@slack/web-api';
import {ensureSlackMembers,nativeMembership} from './members';
import {slackSession} from './identity';
import {snapshot} from '../server/queries';
import {createWebLink} from '../server/slack-web';
import {localDate} from '../shared/time';
import {home} from './views';
import {AppError} from '../server/errors';
const readable=(e:unknown)=>e instanceof AppError?e.message:'연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
export async function publish(client:WebClient,team:string,user:string,strict=false,beforePublish?:()=>Promise<void>){
 const base=new URL(process.env.SLACK_WEB_BASE_URL??process.env.APP_BASE_URL!).origin;
 const native=!!(await nativeMembership(team));let view;
 try{const manager=await slackAdmin(team,user);if(native&&!manager)await ensureSlackMembers(client,team,[user]);const session=manager?{memberId:manager.id,accessVersion:manager.access_version,verifiedAt:0,expiresAt:Date.now()+60000,sessionId:'slack-home'}:await slackSession(team,user);const data=await snapshot(session,localDate());const links:Record<string,string>={};if(native&&data.me.role==='STUDENT'){const destinations=['/schedule',...data.mine.filter(r=>!['CANCELLED','ENDED'].includes(r.status)).sort((a,b)=>a.starts_at.localeCompare(b.starts_at)).slice(0,3).map(r=>'/reservations/'+r.id)];for(const destination of destinations)links[destination]=await createWebLink(team,user,session,destination,true);}if(manager)links['/admin/reservations']=await createWebLink(team,user,{...session,memberId:manager.id,accessVersion:manager.access_version},'/admin/reservations',true);view=home(data,base,undefined,team,native,links);}catch(e){if(strict)throw e;view=home(undefined,base,readable(e),team,native);}
 if(saasEnabled())await inWorkspace(team,async()=>{});
 await beforePublish?.();
 await client.views.publish({user_id:user,view});
}
