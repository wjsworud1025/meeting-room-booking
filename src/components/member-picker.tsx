'use client';
import {useEffect,useState} from 'react';
import {api} from './api';
export type SearchPerson={id:string;display_name:string;class_name:string;slackId?:string};
export function MemberPicker({exclude,onSelect,disabled=false}:{exclude:string[];onSelect:(person:SearchPerson)=>void;disabled?:boolean}){
 const [query,setQuery]=useState(''),[results,setResults]=useState<SearchPerson[]>([]),[loading,setLoading]=useState(false),[selecting,setSelecting]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;setResults([]);setError('');setLoading(!!query.trim());if(!query.trim())return;
  const timer=setTimeout(()=>{api<SearchPerson[]>('members/search?q='+encodeURIComponent(query.trim())).then(rows=>{if(active)setResults(rows);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});},250);
  return()=>{active=false;clearTimeout(timer);};
 },[query]);
 async function select(person:SearchPerson){setSelecting(true);setError('');try{const resolved=person.slackId?await api<SearchPerson>('members/resolve',{slackId:person.slackId}):person;if(!exclude.includes(resolved.id))onSelect(resolved);setQuery('');}catch(e){setError((e as Error).message);}finally{setSelecting(false);}}
 const options=results.filter(p=>!exclude.includes(p.id));
 return <div className="member-picker"><label>이름으로 구성원 찾기<input type="search" autoComplete="off" placeholder="이름 입력" value={query} maxLength={100} disabled={disabled||selecting} onChange={e=>setQuery(e.target.value)}/></label><div aria-live="polite">{loading?'검색 중…':selecting?'구성원 확인 중…':error?<p role="alert">{error}</p>:query.trim()&&!options.length?<p className="field-hint">검색 결과가 없습니다. 이름을 다시 확인해 주세요.</p>:null}</div><div className="student-options">{options.map(p=><button type="button" key={p.id} disabled={disabled||selecting||loading} onClick={()=>select(p)}>+ {p.display_name}<small>{p.class_name}</small></button>)}</div></div>;
}
