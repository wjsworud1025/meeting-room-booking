'use client';
import AccountSpace from './account-space';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {api} from './api';
import {Busy,ErrorNotice} from './ui';
export default function AccountLogin({mode='login'}:{mode?:'login'|'register'|'password'|'account'}){
 const router=useRouter(),[loginId,setLogin]=useState(''),[password,setPassword]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[remember,setRemember]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [pilot,setPilot]=useState(false);
 const [saas,setSaas]=useState<boolean|null>(null),[spaceName,setSpaceName]=useState('');
 useEffect(()=>{api<{saas?:boolean;pilot?:boolean}>('config').then(c=>{setSaas(!!c.saas);setPilot(!!c.pilot);}).catch(()=>setError('설정을 불러오지 못했습니다. 페이지를 새로고침해 주세요.'));},[]);
 async function createSpace(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{await api('auth/account/space',{name:spaceName});router.replace('/admin/reservations');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const [account,setAccount]=useState<{loginId:string;status:string;mustChange:boolean}|null>(null);
 useEffect(()=>{if(mode==='password'||mode==='account')api<NonNullable<typeof account>>('auth/account/me').then(a=>{setAccount(a);if(mode==='account'&&a.mustChange)router.replace('/account/password');}).catch(()=>router.replace('/admin/login'));},[mode,router]);
 async function submit(e:React.FormEvent){e.preventDefault();setError('');setBusy(true);try{
  if(mode==='register'){if(password!==confirm)throw Error('비밀번호가 일치하지 않습니다.');await api('auth/account/register',{loginId,password});router.replace('/admin/login?registered=1');}
  else if(mode==='password'){if(next!==confirm)throw Error('새 비밀번호가 일치하지 않습니다.');await api('auth/account/password',{current:password,next});router.replace('/admin/login?changed=1');}
  else{const a=await api<{mustChange:boolean;status:string}>('auth/account/login',{loginId,password,remember});
   if(a.mustChange){router.replace('/account/password');return;}
   if(saas){const info=await api<{space:{status:string}|null}>('auth/account/space-info');router.replace(info.space?.status==='ACTIVE'?'/admin/reservations':'/account');}
   else router.replace(a.status==='ACTIVE'?'/admin/reservations':'/account');}
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{if(mode==='login'){const q=new URLSearchParams(location.search);setNotice(q.has('transferred')?'관리자 권한을 받았습니다. 다시 로그인해 주세요.':q.has('changed')?'비밀번호를 변경했습니다. 다시 로그인해 주세요.':q.has('registered')?'아이디를 만들었습니다. 로그인해 주세요.':'');}},[mode]);
 if(mode==='register'&&pilot)return <section className="login-card"><h1>신규 가입 준비 중</h1><Link href="/admin/login">로그인으로 돌아가기</Link></section>;
 if(mode==='account'&&saas&&account)return <AccountSpace loginId={account.loginId}/>;
 if(mode==='account'&&(saas===null||!account))return <main className="login-page"><section className="login-card"><p role="status">계정을 확인하고 있습니다…</p><ErrorNotice error={error}/></section></main>;
 if(mode==='account')return <main className="login-page"><section className="login-card"><h1>{account?.loginId??'내 계정'}</h1><p>{account?.status==='ACTIVE'?'내 운영 공간을 관리하는 계정입니다.':'계정이 등록되었습니다.'}</p>{account?.status!=='ACTIVE'&&(saas?<form onSubmit={createSpace}><label>운영 공간 이름<input value={spaceName} onChange={e=>setSpaceName(e.target.value)} maxLength={80} required placeholder="예: 현대 교육센터"/></label><ErrorNotice error={error}/><button className="primary full" disabled={busy}><Busy busy={busy} label="내 운영 공간 만들기"/></button></form>:<p className="subtle">독립 운영 공간을 준비 중입니다. 활성화되면 회의실과 클래스를 등록할 수 있습니다.</p>)}{account?.status==='ACTIVE'&&<Link href="/admin/reservations">관리자 화면</Link>}<p><Link href="/account/password">비밀번호 변경</Link></p><button className="secondary" onClick={async()=>{await api('auth/logout',{});router.replace('/admin/login');}}>로그아웃</button></section></main>;
 return <section className="login-card"><span className="eyebrow">관리자 계정</span><h1>{mode==='register'?'아이디 만들기':mode==='password'?'비밀번호 변경':'관리자 로그인'}</h1>{notice&&<p role="status">{notice}</p>}{mode==='register'&&<p className="subtle">독립 운영 공간 활성화 전에는 계정만 생성됩니다.</p>}{mode==='password'&&<p className="subtle">{account?.mustChange?'서비스 이용 전 임시 비밀번호를 변경해 주세요.':'변경하면 모든 기기에서 로그아웃됩니다.'}</p>}<ErrorNotice error={error}/><form onSubmit={submit}>{mode!=='password'&&<label>아이디<input value={loginId} onChange={e=>setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} pattern="[a-zA-Z0-9_]{4,32}" minLength={4} maxLength={32} required/><small>영문·숫자·밑줄 4~32자</small></label>}<label>{mode==='password'?'현재 비밀번호':'비밀번호'}<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==='register'?'new-password':'current-password'} minLength={mode==='register'?10:1} maxLength={128} required/></label>{mode==='password'&&<label>새 비밀번호<input type="password" value={next} onChange={e=>setNext(e.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required/></label>}{mode!=='login'&&<><label>비밀번호 확인<input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required/></label><p className="fine">새 비밀번호는 10자 이상 입력해 주세요.</p></>}{mode==='login'&&<label><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>로그인 유지 (30일)</label>}<button className="primary full" disabled={busy}><Busy busy={busy} label={mode==='register'?'계정 생성':mode==='password'?'변경 후 다시 로그인':'로그인'}/></button></form>{(!pilot||mode!=='login')&&<p><Link href={mode==='login'?'/register':'/admin/login'}>{mode==='login'?'새 관리자 계정 만들기':'로그인으로 돌아가기'}</Link></p>}</section>;
}
