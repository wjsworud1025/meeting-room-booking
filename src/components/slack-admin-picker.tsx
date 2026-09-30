'use client';
import {useEffect,useState} from 'react';
import {api} from './api';
import {ErrorNotice} from './ui';
type Workspace={team_id:string;team_name:string;allowed:boolean;revoked_at:string|null};
export default function SlackAdminPicker({workspaces,onSelect}:{workspaces:Workspace[];onSelect:(team:string,user:string)=>void}){
 const [team,setTeam]=useState(''),[search,setSearch]=useState(''),[selected,setSelected]=useState(''),[people,setPeople]=useState<{id:string;name:string}[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!team){setPeople([]);return;}let active=true;setBusy(true);setError('');const timer=setTimeout(()=>{api<typeof people>('admin/slack-candidates?'+new URLSearchParams({team,q:search})).then(rows=>{if(active)setPeople(rows);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});},250);return()=>{active=false;clearTimeout(timer);};},[team,search]);
 return <><label>워크스페이스<select required value={team} onChange={e=>{setTeam(e.target.value);setSelected('');setSearch('');onSelect(e.target.value,'');}}><option value="">워크스페이스 선택</option>{workspaces.filter(w=>w.allowed&&!w.revoked_at).map(w=><option key={w.team_id} value={w.team_id}>{w.team_name}</option>)}</select></label>{team&&<><label>운영진·강사 찾기<input placeholder="Slack 이름 검색" value={search} onChange={e=>{setSearch(e.target.value);setSelected('');onSelect(team,'');}}/></label><ErrorNotice error={error}/>{busy?<p role="status">구성원 확인 중…</p>:<div className="panel" style={{maxHeight:260,overflowY:'auto'}}>{people.map(p=><label className="radio" key={p.id}><input type="radio" name="slack-admin-person" value={p.id} checked={selected===p.id} required onChange={()=>{setSelected(p.id);onSelect(team,p.id);}}/>{p.name}</label>)}{!people.length&&<p>초대할 수 있는 구성원이 없습니다.</p>}</div>}</>}</>;
}
