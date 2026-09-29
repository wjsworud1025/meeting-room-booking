'use client';
import {useCallback,useEffect,useState} from 'react';
export type BookingDraft={date:string;roomId:string;time:string;duration:number;inviteeIds:string[]};
const prefix='booking-draft:';
export function clearBookingDraft(){try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith(prefix))sessionStorage.removeItem(key);}}catch{/* Memory-only drafts still work if storage is unavailable. */}}
export function useBookingDraft(memberId:string){
 const [draft,setValue]=useState<BookingDraft|null>(null),[ready,setReady]=useState(false);
 useEffect(()=>{try{const value=JSON.parse(sessionStorage.getItem(prefix+memberId)??'null');if(value&&/^\d{4}-\d{2}-\d{2}$/.test(value.date)&&typeof value.roomId==='string'&&typeof value.time==='string'&&Number.isFinite(value.duration)&&Array.isArray(value.inviteeIds)&&value.inviteeIds.every((id:unknown)=>typeof id==='string'))setValue(value);}catch{/* Ignore an invalid saved draft. */}setReady(true);},[memberId]);
 const setDraft=useCallback((value:BookingDraft|null)=>{setValue(value);try{if(value)sessionStorage.setItem(prefix+memberId,JSON.stringify(value));else sessionStorage.removeItem(prefix+memberId);}catch{/* Keep the draft in memory. */}},[memberId]);
 return {draft,setDraft,ready};
}
