import {randomUUID} from 'node:crypto';
import {pool,transaction} from '../src/server/db';
import {defaultRules} from '../src/server/policy';
import {at,localDate,addDays,localTime} from '../src/shared/time';
import {syncClaims} from '../src/server/booking';
if(process.env.APP_ENV!=='local')throw Error('Seed is restricted to APP_ENV=local');
await transaction(async(db,now)=>{
 if((await db.query('SELECT 1 FROM members LIMIT 1')).rowCount){console.log('Existing accounts found; seed skipped without modifying data.');return;}
 const cohort=randomUUID();await db.query('INSERT INTO cohorts(id,name,starts_on,ends_on) VALUES($1,$2,$3,$4)',[cohort,'2026 하반기',localDate(now),addDays(localDate(now),180)]);
 const names=['김하늘','박지훈','이서연','최도윤','정유진','정민서','김지원','이은우'],emails=['haneul','jihoon','seoyeon','doyoon','yujin','minseo','jiwon','eunwoo'],ids=names.map(()=>randomUUID());
 for(let i=0;i<ids.length;i++)await db.query("INSERT INTO members(id,auth_user_id,cohort_id,email,display_name,class_name,role,status) VALUES($1,$2,$3,$4,$5,'A반','STUDENT','ACTIVE')",[ids[i],randomUUID(),cohort,emails[i]+'@example.com',names[i]]);
 const admin=randomUUID();
 await db.query("INSERT INTO members(id,auth_user_id,email,display_name,role,status,invite_accepted_at) VALUES($1,$2,'admin@example.com','김하늘','ADMIN','ACTIVE',$3),($4,$5,'operator@example.com','박지훈','ADMIN','ACTIVE',$3)",[admin,randomUUID(),now,randomUUID(),randomUUID()]);
 await db.query("INSERT INTO members(email,display_name,role,status,admin_invite_id,issuer_type,invited_by,invite_expires_at) VALUES('pending@example.com','이서연','ADMIN','REGISTERED',$1,'ADMIN',$2,$3)",[randomUUID(),admin,new Date(now.getTime()+86400000)]);
 await db.query("INSERT INTO members(email,display_name,role,status,inactive_at) VALUES('former@example.com','최도윤','ADMIN','INACTIVE',$1)",[now]);
 await db.query('UPDATE settings SET admin_bootstrap_started_at=$1,bootstrap_admin_id=$2 WHERE id=1',[now,admin]);
 const rooms=Array.from({length:5},()=>randomUUID()),rules={...defaultRules,rooms:Object.fromEntries(rooms.map((id,i)=>[id,{capacity:i===4?8:4,minimum:i===4?4:2}]))};
 for(let i=0;i<rooms.length;i++)await db.query('INSERT INTO rooms(id,name,display_order) VALUES($1,$2,$3)',[rooms[i],`회의실 ${String(i+1).padStart(2,'0')}`,i]);
 const policy=randomUUID();await db.query('INSERT INTO policy_versions(id,effective_on,rules_json,created_by) VALUES($1,$2,$3,$4)',[policy,addDays(localDate(now),-30),JSON.stringify(rules),admin]);
 let day=localDate(now);if(localTime(now)>='17:45')day=addDays(day,1);while([0,6].includes(new Date(day+'T00:00:00Z').getUTCDay()))day=addDays(day,1);
 const samples=[{room:0,start:'18:00',end:'19:30',owner:1,accepted:[1,6,7],invited:[],status:'CONFIRMED'}, {room:1,start:'18:00',end:'19:00',owner:2,accepted:[2,0],invited:[],status:'CONFIRMED'}, {room:3,start:'19:00',end:'20:00',owner:3,accepted:[3,2],invited:[],status:'CONFIRMED'}, {room:4,start:'19:30',end:'21:00',owner:4,accepted:[4,5,0],invited:[],status:'REPLENISHING'}];
 for(const s of samples){const id=randomUUID(),confirmed=s.status!=='HOLDING',deadline=new Date(now.getTime()+600000),spec=rules.rooms[rooms[s.room]];
  await db.query('INSERT INTO reservations(id,cohort_id,room_id,creator_id,organizer_id,policy_version_id,capacity_snapshot,minimum_snapshot,starts_at,ends_at,status,initial_deadline,replenish_deadline,first_confirmed_at,first_confirmed_member_ids,create_request_key) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[id,cohort,rooms[s.room],ids[s.owner],policy,spec.capacity,spec.minimum,at(day,s.start),at(day,s.end),s.status,deadline,s.status==='REPLENISHING'?deadline:null,confirmed?now:null,confirmed?s.accepted.map(i=>ids[i]).concat(s.status==='REPLENISHING'?[ids[7]]:[]):null,'seed-'+id]);
  for(const i of s.accepted.concat(s.invited))await db.query('INSERT INTO reservation_members(reservation_id,member_id,invited_by,status) VALUES($1,$2,$3,$4)',[id,ids[i],ids[s.owner],s.accepted.includes(i)?'ACCEPTED':'INVITED']);await syncClaims(db,id);
 }
 console.log('Seeded 8 fictional students, 4 admin states, 5 rooms. Student: haneul@example.com / Admin: admin@example.com');console.log('Sample booking date:',day);
});await pool().end();
