'use client';
import {useRef,useState} from 'react';
type Person={id:string;display_name:string;class_name:string};
export default function LocalMemberSelect({people,value,onChange,disabled}:{people:Person[];value:string;onChange:(id:string)=>void;disabled:boolean}){
 const [query,setQuery]=useState('');const root=useRef<HTMLDetailsElement>(null),search=useRef<HTMLInputElement>(null),trigger=useRef<HTMLElement>(null);
 const selected=people.find(p=>p.id===value),term=query.trim().toLocaleLowerCase();
 const options=people.filter(p=>`${p.display_name} ${p.class_name??''}`.toLocaleLowerCase().includes(term));
 function close(){if(root.current)root.current.open=false;trigger.current?.focus();}
 return <div className="local-member-select"><span>구성원</span><details ref={root} onToggle={e=>{if(e.currentTarget.open){setQuery('');search.current?.focus();}}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)&&root.current)root.current.open=false;}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}}}>
 <summary ref={trigger} onClick={e=>{if(disabled)e.preventDefault();}} aria-disabled={disabled}>{selected?`${selected.display_name}${selected.class_name?' · '+selected.class_name:''}`:'구성원 선택'}<span aria-hidden="true">⌄</span></summary>
 <div className="local-member-options"><input ref={search} type="search" aria-label="구성원 이름 또는 클래스 검색" placeholder="이름 또는 클래스 검색" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(options.length===1){onChange(options[0].id);close();}}}} autoComplete="off" disabled={disabled}/>
 <div className="local-member-results">{options.map(p=><button type="button" key={p.id} disabled={disabled} aria-pressed={p.id===value} onClick={()=>{onChange(p.id);close();}}><span>{p.display_name}</span><small>{p.class_name}</small></button>)}{!options.length&&<p role="status">검색 결과가 없습니다.</p>}</div></div></details></div>;
}
