import {describe,it,expect} from 'vitest';
import {home} from '../src/slack/views';
import type {Snapshot} from '../src/shared/types';
const data:Snapshot={me:{id:'student',display_name:'구성원',email:null,role:'STUDENT',status:'ACTIVE',access_version:1,admin_invite_id:null,invite_expires_at:null},now:'2026-09-29T10:00:00Z',local:false,date:'2026-09-29',rooms:[],reservations:[],mine:[],invitations:[],students:[],closed:[],rules:{windowDays:7,slotMinutes:30,maxMinutes:120,holdMinutes:10,refillMinutes:10,cooldownMinutes:10,gapMinutes:30,threshold:50,open:'18:00',close:'21:30',weekdays:[1],rooms:{}}};
const links={'/schedule':'https://booking.example/slack-entry#student','/admin/reservations':'https://booking.example/slack-entry#admin'};
describe('administrator Home visibility',()=>{
 it('shows a public login link without an authenticated admin token',()=>{for(const snapshot of [data,undefined]){const view=JSON.stringify(home(snapshot,'https://booking.example',undefined,'T',true,links));expect(view).toContain('관리자 로그인');expect(view).toContain('https://booking.example/admin/login');}});
 it('never shows an admin button to a student even with an extra link',()=>{expect(JSON.stringify(home(data,'https://booking.example',undefined,'T',true,links))).not.toContain('관리자 페이지');});
 it('shows an admin button only for an active administrator and a server-issued link',()=>{const admin={...data,me:{...data.me,role:'ADMIN' as const}};expect(JSON.stringify(home(admin,'https://booking.example',undefined,'T',true,links))).toContain('관리자 페이지');expect(JSON.stringify(home(admin,'https://booking.example',undefined,'T',true,{}))).not.toContain('관리자 페이지');});
 it.each(['REGISTERED','INACTIVE'] as const)('hides the button for %s administrators',status=>{expect(JSON.stringify(home({...data,me:{...data.me,role:'ADMIN',status}},'https://booking.example',undefined,'T',true,links))).not.toContain('관리자 페이지');});
});
