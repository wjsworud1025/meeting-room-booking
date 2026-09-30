'use client';
import {useState} from 'react';
import type {Venue} from '@/shared/types';
import type {RunCommand} from './application';
import {Drawer,ErrorNotice} from './ui';
export default function VenueAdmin({venues,command}:{venues:Venue[];command:RunCommand}){
 const [target,setTarget]=useState<Venue|null|undefined>(),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <section className='panel'><div className='section-row'><h2>수업장·과정</h2><button onClick={()=>{setTarget(null);setName('');setError('');}}>+ 수업장 추가</button></div><p className='subtle'>같은 수업장에 연결된 클래스만 해당 회의실을 이용합니다.</p>{venues.map(v=><div className='member-row' key={v.id}><b>{v.name}</b><button onClick={()=>{setTarget(v);setName(v.name);setError('');}}>이름 변경</button></div>)}{target!==undefined&&<Drawer title={target?'수업장 이름 변경':'수업장 추가'} busy={busy} onClose={()=>setTarget(undefined)}><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await command('admin.venue.'+(target?'rename':'add'),{...(target?{id:target.id}:{}),name,reason:'수업장 관리'});setTarget(undefined);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label>수업장·과정 이름<input value={name} onChange={e=>setName(e.target.value)} required maxLength={80} placeholder='예: 강남 교육장 · AI 개발 과정'/></label><ErrorNotice error={error}/><button className='primary' disabled={busy||!name.trim()}>저장</button></form></Drawer>}</section>;
}
