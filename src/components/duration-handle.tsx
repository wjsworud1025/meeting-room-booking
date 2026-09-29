'use client';
import {useRef,type PointerEvent} from 'react';

export function DurationHandle({duration,options,slotMinutes,onChange}:{duration:number;options:number[];slotMinutes:number;onChange:(duration:number)=>void}){
 const drag=useRef<{id:number;y:number;duration:number}|null>(null);
 const move=(event:PointerEvent<HTMLButtonElement>)=>{
  const start=drag.current;if(!start||start.id!==event.pointerId)return;
  const wanted=start.duration+Math.round((event.clientY-start.y)/82*slotMinutes/30)*30;
  const next=options.reduce((best,value)=>Math.abs(value-wanted)<Math.abs(best-wanted)?value:best,options[0]);
  if(next!==undefined&&next!==duration)onChange(next);
 };
 return <button type="button" className="duration-handle" role="slider" aria-label="예약 종료 시간 조절" aria-orientation="vertical" aria-valuemin={options[0]??30} aria-valuemax={options.at(-1)??120} aria-valuenow={duration} aria-valuetext={`${duration}분`} disabled={options.length<2}
 onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus();drag.current={id:event.pointerId,y:event.clientY,duration};event.currentTarget.setPointerCapture(event.pointerId);}}
 onPointerMove={move} onPointerUp={event=>{move(event);drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
 onPointerCancel={()=>{const start=drag.current;drag.current=null;if(start&&options.includes(start.duration))onChange(start.duration);}}
 onLostPointerCapture={()=>{drag.current=null;}}
 onKeyDown={event=>{const index=options.indexOf(duration);const next=event.key==='Home'?options[0]:event.key==='End'?options.at(-1):['ArrowUp','ArrowRight'].includes(event.key)?options[index+1]:['ArrowDown','ArrowLeft'].includes(event.key)?options[index-1]:undefined;if(next!==undefined){event.preventDefault();onChange(next);}}}>
 <span aria-hidden="true">↕ 드래그로 시간 조절</span>
 </button>;
}
