'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {api} from './api';
import {ErrorNotice} from './ui';
export default function LoginIdChange({loginId,onBusyChange}:{loginId:string;onBusyChange?:(busy:boolean)=>void}){
 const router=useRouter(),[open,setOpen]=useState(false),[current,setCurrent]=useState(''),[next,setNext]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);onBusyChange?.(true);setError('');try{await api('auth/account/login-id',{current,next});router.replace('/admin/login?loginIdChanged=1');}catch(e){setError((e as Error).message);}finally{setBusy(false);onBusyChange?.(false);}}
 return <><div className="credential-links"><Link href="/account/password">비밀번호 변경</Link><span aria-hidden="true">/</span><button type="button" aria-expanded={open} onClick={()=>setOpen(true)}>아이디 변경</button></div>{open&&<form onSubmit={submit}><label>새 아이디<input autoComplete="username" autoCapitalize="none" spellCheck={false} value={next} onChange={e=>setNext(e.target.value)} pattern="[a-zA-Z0-9_]{4,32}" minLength={4} maxLength={32} required disabled={busy}/><small>영문·숫자·밑줄 4~32자</small></label><label>현재 비밀번호<input type="password" autoComplete="current-password" value={current} onChange={e=>setCurrent(e.target.value)} required maxLength={128} disabled={busy}/></label><p className="field-hint">변경하면 모든 기기에서 로그아웃됩니다. 예약과 구성원은 유지됩니다.</p><ErrorNotice error={error}/><div className="actions"><button className="primary" disabled={busy||!current||!next||next.trim().toLowerCase()===loginId}>{busy?'변경 중…':'아이디 변경 저장'}</button><button type="button" disabled={busy} onClick={()=>{setOpen(false);setCurrent('');setNext('');setError('');}}>취소</button></div></form>}</>;
}
