'use client';
import {useEffect,useRef,useId} from 'react';
import {X,Info,AlertCircle,LoaderCircle} from 'lucide-react';
import {stateLabels,type Reservation} from '@/shared/types';
export function Badge({state,children}:{state?:string;children?:React.ReactNode}){return <span className={'badge '+(state??'')}>{children??stateLabels[state as keyof typeof stateLabels]??state}</span>;}
export function Notice({children,warning=false}:{children:React.ReactNode;warning?:boolean}){return <div className={'notice '+(warning?'warning':'')} role={warning?'status':undefined}>{warning?<AlertCircle size={21} aria-hidden/>:<Info size={21} aria-hidden/>}<div>{children}</div></div>;}
export function ErrorNotice({error}:{error:string}){const ref=useRef<HTMLDivElement>(null);useEffect(()=>{if(error)ref.current?.focus();},[error]);return error?<div ref={ref} tabIndex={-1} className="error" role="alert"><AlertCircle size={20} aria-hidden/>{error}</div>:null;}
export function Busy({busy,label}:{busy:boolean;label:string}){return <>{busy&&<LoaderCircle className="spin" size={17} aria-hidden/>}{busy?'처리 중…':label}</>;}
export function Drawer({title,onClose,children,busy=false}:{title:string;onClose:()=>void;children:React.ReactNode;busy?:boolean}){
 const ref=useRef<HTMLDialogElement>(null),latest=useRef({onClose,busy}),titleId=useId();
 useEffect(()=>{latest.current={onClose,busy};},[onClose,busy]);
 useEffect(()=>{const el=ref.current;el?.showModal();const cancel=(e:Event)=>{e.preventDefault();if(!latest.current.busy)latest.current.onClose();};el?.addEventListener('cancel',cancel);return()=>{el?.removeEventListener('cancel',cancel);el?.close();};},[]);
 return <dialog ref={ref} className="drawer" aria-labelledby={titleId} aria-busy={busy}><header><h2 id={titleId}>{title}</h2><button className="icon-button" disabled={busy} onClick={onClose} aria-label="닫기"><X/></button></header><div className="drawer-body">{children}</div></dialog>;
}
export function Countdown({reservation:r,now}:{reservation:Reservation;now:number}){const deadline=r.status==='HOLDING'?r.initial_deadline:r.status==='REPLENISHING'?r.replenish_deadline:null;if(!deadline)return null;const seconds=Math.max(0,Math.floor((new Date(deadline).getTime()-now)/1000));return <span className="countdown">◷ {String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')} 남음</span>;}
