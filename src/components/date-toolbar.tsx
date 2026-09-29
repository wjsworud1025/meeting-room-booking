'use client';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {addDays,localDate} from '@/shared/time';
import {DateField} from './date-field';
export function DateToolbar({date,setDate,open='18:00',close='21:30'}:{date:string;setDate:(s:string)=>void;open?:string;close?:string}){return <div className="date-toolbar"><div className="date-controls"><button aria-label="이전 날짜" onClick={()=>setDate(addDays(date,-1))}><ChevronLeft size={21}/></button><DateField label="예약 날짜" value={date} onChange={setDate} compact/><button aria-label="다음 날짜" onClick={()=>setDate(addDays(date,1))}><ChevronRight size={21}/></button></div><button onClick={()=>setDate(localDate())}>오늘</button><span className="hours">기본 운영 {open} – {close}</span></div>;}
