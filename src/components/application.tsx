'use client';
import {requestId} from '../shared/request-id';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {CalendarDays,UserRound,Mail,Info,Settings,TriangleAlert,History,Users,DoorOpen,LogOut,Menu,X,RefreshCw} from 'lucide-react';
import type {Snapshot} from '@/shared/types';
import {localDate} from '@/shared/time';
import {api,APIError} from './api';
import {clearBookingDraft} from './booking-draft';
import AccountLogin from './account-login';
import Login,{Mailbox,Onboarding} from './login';
import dynamic from 'next/dynamic';
const StudentScreens=dynamic(()=>import('./student'));
const AdminScreens=dynamic(()=>import('./admin'));
import {ErrorNotice} from './ui';
export type RunCommand=(name:string,input:unknown)=>Promise<unknown>;
export default function Application(){
 const path=usePathname();if(path==='/account')return <AccountLogin mode="account"/>;if(path==='/register'||path==='/account/password')return <main className="login-page"><AccountLogin mode={path==='/register'?'register':'password'}/></main>;if(path==='/dev/mailbox')return <Mailbox/>;if(path==='/admin/onboarding')return <Onboarding/>;if(path==='/login'||path==='/admin/login'||path==='/')return <Login admin={path.startsWith('/admin')}/>;return <Workspace/>;
}
function Workspace(){
 const path=usePathname(),router=useRouter(),[date,setDate]=useState(localDate()),[data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[connected,setConnected]=useState(true),[menu,setMenu]=useState(false),[refresh,setRefresh]=useState(0),[lastSeen,setLastSeen]=useState('');
 const keys=useRef(new Map<string,string>()),sequence=useRef(0),pending=useRef(false);const admin=path.startsWith('/admin');
 const load=useCallback(async()=>{const request=++sequence.current;pending.current=true;try{const result=await api<Snapshot>('snapshot?date='+date);if(request!==sequence.current)return;if((result.me.role==='ADMIN')!==admin){router.replace(result.me.role==='ADMIN'?'/admin/reservations':'/schedule');return;}setData(result);setConnected(true);setError('');setLastSeen(new Date().toLocaleTimeString('ko-KR'));}catch(e){if(request!==sequence.current)return;if(e instanceof APIError&&(e.status===401||e.status===403)){clearBookingDraft();router.replace(admin?'/admin/login':'/login');}else{setConnected(false);setError((e as Error).message);}}finally{if(request===sequence.current)pending.current=false;}},[date,admin,router]);
 useEffect(()=>{load();const run=()=>{if(document.visibilityState==='visible'&&!pending.current)load();};const timer=setInterval(run,3000);document.addEventListener('visibilitychange',run);return()=>{sequence.current++;pending.current=false;clearInterval(timer);document.removeEventListener('visibilitychange',run);};},[load]);
 useEffect(()=>{setMenu(false);setError('');},[path]);
 const command:RunCommand=async(name,input)=>{const signature=name+JSON.stringify(input);const key=keys.current.get(signature)??requestId();keys.current.set(signature,key);try{const result=await api('commands',{name,input},key);keys.current.delete(signature);await load();setRefresh(x=>x+1);return result;}catch(e){if(e instanceof APIError)keys.current.delete(signature);throw e;}};
 const studentNav=[['전체 시간표','/schedule',CalendarDays],['내 예약','/my-reservations',UserRound],['초대받은 예약','/invitations',Mail],['이용 안내','/guide',Info]] as const;
 const adminNav=[['예약 현황','/admin/reservations',CalendarDays],['구성원 관리','/admin/students',UserRound],['관리자 계정','/admin/accounts',Users],['시설·운영 설정','/admin/settings',Settings],['신고 관리','/admin/reports',TriangleAlert],['변경 이력','/admin/history',History]] as const;
 async function logout(){await api('auth/logout',{});clearBookingDraft();router.replace(admin?'/admin/login':'/login');}
 return <div className={'app '+(admin?'admin-app':'')}><header className="mobile-bar"><button aria-label="메뉴 열기" className="icon-button" onClick={()=>setMenu(!menu)}>{menu?<X/>:<Menu/>}</button><b>회의실 예약</b>{admin&&<span className="role-tag">관리자</span>}</header><aside className={'sidebar '+(menu?'open':'')}><Link className="brand" href={admin?'/admin/reservations':'/schedule'}><DoorOpen size={32}/><span>회의실 예약</span></Link>{admin&&<span className="role-tag">관리자</span>}<nav aria-label="주 메뉴">{(admin?adminNav:studentNav).map(([label,href,Icon])=><Link key={href} href={href} className={path===href?'active':''} aria-current={path===href?'page':undefined}><Icon size={23}/><span>{label}</span>{href==='/invitations'&&!!data?.invitations.length&&<b className="count-badge">{data.invitations.length}건</b>}</Link>)}</nav><div className="sidebar-bottom"><div className="profile"><UserRound size={23}/><span>{data?.me.login_id??data?.me.display_name??'불러오는 중'} · {admin?'ADMIN':'교육생'}</span></div>{admin&&<Link className="text-link" href="/account">내 로그인 계정 · 비밀번호 변경</Link>}<button className="logout" onClick={logout}><LogOut size={15}/>로그아웃</button>{data?.local&&<Link className="dev-link" href="/dev/mailbox" target="_blank">로컬 이메일함 ↗</Link>}</div></aside><main className="workspace">{!connected&&<div className="connection-banner" role="status">연결을 확인해 주세요. 마지막 확인 {lastSeen||'없음'}<button onClick={()=>{setError('');load();}}><RefreshCw size={16}/>다시 시도</button></div>}<ErrorNotice error={error}/>{!data?<div className="loading">예약 정보를 불러오는 중입니다…</div>:admin?<AdminScreens data={data} date={date} setDate={setDate} command={command} revision={refresh}/>:<StudentScreens data={data} date={date} setDate={setDate} command={command}/>}</main></div>;
}
