 'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {api} from './api';
import {ErrorNotice} from './ui';
import {requestId} from '../shared/request-id';
type Info={pilot?:boolean;notices:{id:string;message:string}[];space:{id:string;name:string;status:string;deleteAfter:string|null;futureReservations:number}|null;exports:{id:string;status:string;expiresAt:string}[];incoming:{id:string;name:string;expiresAt:string}[];outgoing:{id:string;loginId:string;expiresAt:string}[]};
export default function AccountSpace({loginId,embedded=false,onBusyChange}:{loginId:string;embedded?:boolean;onBusyChange?:(busy:boolean)=>void}){
 const router=useRouter(),[info,setInfo]=useState<Info|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[password,setPassword]=useState(''),[name,setName]=useState(''),[target,setTarget]=useState(''),[confirmName,setConfirmName]=useState('');
 useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
 const keys=useRef(new Map<string,string>());
 async function load(){setInfo(await api<Info>('auth/account/space-info'));}
 useEffect(()=>{let live=true;const refresh=()=>api<Info>('auth/account/space-info').then(v=>{if(live)setInfo(v);}).catch(e=>{if(live)setError(e.message);});refresh();const timer=setInterval(refresh,8000);return()=>{live=false;clearInterval(timer);};},[]);
 async function act(action:string,input:Record<string,string>={}){
  setBusy(true);setError('');setNotice('');const signature=action+JSON.stringify(input);const id=keys.current.get(signature)??requestId();keys.current.set(signature,id);
  try{await api('auth/account/space-action',{action,password,...(['export.create','transfer.create'].includes(action)?{id}:{}),...input});keys.current.delete(signature);setPassword('');
   if(action==='transfer.accept'){router.replace('/admin/login?transferred=1');return;}
   setNotice(action==='export.create'?'내보내기를 준비합니다. 완료되면 다운로드할 수 있습니다.':'변경했습니다.');await load();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function download(id:string){setBusy(true);setError('');try{
  const r=await fetch('/api/auth/account/export-download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,password})});
  if(!r.ok){const j=await r.json();throw Error(j.error?.message??'다운로드하지 못했습니다.');}
  const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download='booking-'+id+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setPassword('');setNotice('파일을 다운로드했습니다.');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const space=info?.space,paused=space?.status==='DELETION_PENDING';
 return <div className={embedded?"account-settings":"login-page"}><section className={embedded?undefined:"login-card"}><h2>{loginId}</h2><p className="subtle">{space?.name??'내 운영 공간'}</p><ErrorNotice error={error}/>{notice&&<p role="status">{notice}</p>}
 {!info?<p role="status">불러오는 중…</p>:<>
 {info.notices?.map(n=><p role="status" key={n.id}>{n.message}</p>)}
 {!embedded&&space&&!paused&&<p><Link href="/admin/reservations">예약 관리로 돌아가기</Link></p>}
 {!space&&!info.pilot&&<form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await api('auth/account/space',{name});router.replace('/admin/reservations');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label>운영 공간 이름<input value={name} onChange={e=>setName(e.target.value)} maxLength={80} required/></label><button className="primary full" disabled={busy}>운영 공간 만들기</button></form>}
 <p><Link href="/account/password">비밀번호 변경</Link></p><details className="account-advanced"><summary>데이터 및 소유권 관리</summary>{(space||info.incoming.length>0)&&<label>현재 비밀번호<input type="password" autoComplete="current-password" value={password} maxLength={128} onChange={e=>setPassword(e.target.value)}/><small>내보내기·이전·삭제 변경 시 다시 확인합니다.</small></label>}
 {info.incoming.map(r=><section key={r.id} className="panel"><h2>운영 공간 이전 요청</h2><p>{r.name}</p><p className="subtle">수락하면 이 공간의 관리자가 됩니다. 기존 관리자의 접근은 종료됩니다.</p><button disabled={busy||!password||!!space} className="primary" onClick={()=>act('transfer.accept',{id:r.id})}>관리자 역할 수락</button>{space&&<p>이미 운영 공간을 소유하고 있어 수락할 수 없습니다.</p>}</section>)}
 {space&&<>
 {paused&&<section className="panel"><h2>삭제 대기 중</h2><p>예약과 알림이 중지되었습니다. 삭제 예정: {new Date(space.deleteAfter!).toLocaleString('ko-KR')}</p><button className="secondary" disabled={busy||!password} onClick={()=>act('delete.cancel')}>삭제 취소</button></section>}
 <details><summary>데이터 내보내기</summary><p className="subtle">이 공간의 운영 데이터를 ZIP으로 제공합니다. 다운로드는 24시간 동안 가능합니다.</p><button className="secondary" disabled={busy||!password} onClick={()=>act('export.create')}>내보내기 준비</button>{info.exports.map(e=><div className="member-row" key={e.id}><span>{{PENDING:'준비 대기',RUNNING:'파일 생성 중',DONE:'다운로드 가능',FAILED:'실패 — 다시 준비해 주세요.'}[e.status]??e.status}</span>{e.status==='DONE'&&<button className="secondary" disabled={busy||!password} onClick={()=>download(e.id)}>다운로드</button>}</div>)}</details>
 {!paused&&<><details><summary>관리자 소유권 이전</summary><p className="subtle">대상 계정이 로그인해 수락하면 관리자 권한이 이전됩니다. 요청은 24시간 동안 유효합니다.</p><label>대상 아이디<input value={target} onChange={e=>setTarget(e.target.value)} autoCapitalize="none" maxLength={32}/></label><button className="secondary" disabled={busy||!password||!/^[a-z0-9_]{4,32}$/.test(target)} onClick={()=>act('transfer.create',{loginId:target})}>이전 요청</button>{info.outgoing.map(r=><div key={r.id} className="member-row"><span>{r.loginId} · 수락 대기</span><button disabled={busy||!password} onClick={()=>act('transfer.cancel',{id:r.id})}>요청 취소</button></div>)}</details>
 {!info.pilot&&<details><summary>운영 공간 삭제</summary><p>진행·예정 예약 {space.futureReservations}건이 있습니다. 요청하면 예약과 알림이 중지되고 7일 후 삭제 대상이 됩니다. 먼저 데이터를 내보내세요.</p><label>확인을 위해 공간 이름 입력<input value={confirmName} onChange={e=>setConfirmName(e.target.value)} placeholder={space.name} maxLength={80}/></label><button className="danger" disabled={busy||!password||confirmName!==space.name} onClick={()=>act('delete.request',{name:confirmName})}>7일 삭제 대기 시작</button></details>}</>}
 </>}
 </details></>}
 <button className="secondary" disabled={busy} onClick={async()=>{await api('auth/logout',{});router.replace('/admin/login');}}>로그아웃</button>
 </section></div>;
}
