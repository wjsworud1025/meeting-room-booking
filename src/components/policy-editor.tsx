'use client';
import {useEffect,useState,useId} from 'react';
import type {Rules,Room,Venue} from '@/shared/types';
import {localDate,addDays} from '@/shared/time';
import {policyFields,policyProblems} from '@/shared/admin-ux';
import {DateField} from './date-field';
import {Busy,Notice} from './ui';
import RoomAdmin from './room-admin';
import type {RunCommand} from './application';
type Policy={scoped?:boolean;id:string;effective_on:string;rules_json:Rules};
function PolicyEditorForm({venueId,venues,policies,rooms,earliest,now,busy,onSave,command}:{venueId?:string;venues:Venue[];command:RunCommand;policies:Policy[];rooms:Room[];earliest:string;now:string;busy:boolean;onSave:(input:unknown)=>Promise<boolean>}){
 const formId=useId();
 const [base,setBase]=useState<Policy|null>(null),[rules,setRules]=useState<Rules|null>(null),[effective,setEffective]=useState(''),[reason,setReason]=useState('');
 const active=policies.find(p=>p.effective_on<=localDate(now));
 useEffect(()=>{if(!rules||!base)return;const missing=rooms.filter(r=>!rules.rooms[r.id]);if(!missing.length)return;const additions=Object.fromEntries(missing.map(r=>[r.id,{capacity:r.capacity,minimum:r.minimum}]));setRules({...rules,rooms:{...rules.rooms,...additions}});setBase({...base,rules_json:{...base.rules_json,rooms:{...base.rules_json.rooms,...additions}}});},[rooms,rules,base]);
 useEffect(()=>{if(!base&&active){setBase(active);setRules(structuredClone(active.rules_json));setEffective(earliest);}},[base,active,earliest]);
 if(!rules||!base)return <section className="panel"><h2>예약 정책</h2><p role="status">정책을 불러오고 있습니다.</p></section>;
 const diffs:string[]=[];for(const [key,label] of policyFields)if(base.rules_json[key]!==rules[key])diffs.push(`${label}: ${base.rules_json[key]} → ${rules[key]}`);
 if(base.rules_json.open!==rules.open||base.rules_json.close!==rules.close)diffs.push(`운영시간: ${base.rules_json.open}–${base.rules_json.close} → ${rules.open}–${rules.close}`);
 if(JSON.stringify([...base.rules_json.weekdays].sort())!==JSON.stringify([...rules.weekdays].sort()))diffs.push('운영 요일 변경');
 for(const room of rooms){const before=base.rules_json.rooms[room.id],after=rules.rooms[room.id];if(before?.minimum!==after?.minimum||before?.capacity!==after?.capacity)diffs.push(`${room.name}: 최소 ${before?.minimum}명 / 정원 ${before?.capacity}명 → 최소 ${after?.minimum}명 / 정원 ${after?.capacity}명`);}
 const problems=policyProblems(rules);if(effective<earliest)problems.push(`${earliest} 이후부터 적용할 수 있습니다.`);if(policies.some(p=>(!venueId||p.scoped)&&p.effective_on===effective))problems.push('이 적용일에는 이미 정책이 있습니다. 다른 적용일을 선택해 주세요.');
 return <><RoomAdmin venues={venues} rooms={rooms} command={command} rules={rules} onRulesChange={setRules} formId={formId}/><form id={formId} className="panel settings-form" onSubmit={async e=>{e.preventDefault();if(problems.length||!diffs.length)return;if(await onSave({venueId,effectiveOn:effective,rules,reason})){setBase({id:'saved',effective_on:effective,rules_json:structuredClone(rules)});setReason('');}}}><h2>예약 정책</h2><Notice>오늘 적용 중인 정책을 기준으로 편집합니다. 기존 입력은 자동 갱신으로 덮어쓰지 않습니다. 적용 가능한 첫 날짜: {earliest}.</Notice>
 <label>복사할 기준 정책<select aria-label="복사할 기준 정책" value={base.id} onChange={e=>{const p=policies.find(p=>p.id===e.target.value);if(p){setBase(p);setRules(structuredClone(p.rules_json));}}}>{base.id==='saved'&&<option value="saved">방금 저장한 정책 · {base.effective_on}</option>}{policies.map(p=><option value={p.id} key={p.id}>{p.effective_on}부터{p.id===active?.id?' · 현재 적용':''}</option>)}</select></label><p className="field-hint">기준 정책을 선택하면 작성 중인 정책 값을 선택한 내용으로 바꿉니다.</p>
 <div className="form-grid">{policyFields.filter(([key])=>key!=='refillMinutes').map(([key,label,min,max])=><label key={key}>{label}<input type="number" min={min} max={max} step={key==='threshold'?'any':1} value={rules[key]} onChange={e=>setRules({...rules,[key]:Number(e.target.value)})} required/></label>)}<label>운영 시작<input type="time" value={rules.open} onChange={e=>setRules({...rules,open:e.target.value})} required/></label><label>운영 종료<input type="time" value={rules.close} onChange={e=>setRules({...rules,close:e.target.value})} required/></label></div>
 <fieldset className="weekday-options"><legend>운영 요일</legend>{['일','월','화','수','목','금','토'].map((label,day)=><label className="radio" key={day}><input type="checkbox" checked={rules.weekdays.includes(day)} onChange={e=>setRules({...rules,weekdays:e.target.checked?[...rules.weekdays,day].sort():rules.weekdays.filter(d=>d!==day)})}/>{label}</label>)}</fieldset>
 <DateField label="적용일" min={earliest} value={effective} onChange={setEffective} required/><section className="policy-diff" aria-label="정책 변경 요약"><h3>변경 요약 · {diffs.length}개</h3>{diffs.length?diffs.map(text=><p key={text}>{text}</p>):<p>변경한 내용이 없습니다.</p>}</section>{problems.length>0&&<div className="field-error" role="status">{problems.map(text=><p key={text}>{text}</p>)}</div>}
 <label>처리 사유 (선택)<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} placeholder="필요한 경우만 입력하세요"/></label><button className="primary" disabled={busy||!!problems.length||!diffs.length}><Busy busy={busy} label="정책 저장"/></button></form></>;
}

export default function PolicyEditor(props:{venues:Venue[];command:RunCommand;policies:Policy[];rooms:Room[];earliest:string;now:string;busy:boolean;onSave:(input:unknown)=>Promise<boolean>}){
 const [selected,setSelected]=useState('');
 const venueId=props.venues.some(v=>v.id===selected)?selected:props.venues[0]?.id;
 if(!venueId)return <section className="panel"><h2>예약 정책</h2><p>수업장을 먼저 추가해 주세요.</p></section>;
 const rooms=props.rooms.filter(r=>r.venue_id===venueId);
 const policies=props.policies.filter(p=>p.rules_json.venuePolicies?.[venueId]||!p.rules_json.venueOnly).map(p=>{
 const source=p.rules_json.venuePolicies?.[venueId]??p.rules_json;
 const {venueOnly,venuePolicies,...plain}=source as Rules;
 return {...p,scoped:!!p.rules_json.venuePolicies?.[venueId],rules_json:{...plain,rooms:Object.fromEntries(rooms.map(r=>[r.id,source.rooms[r.id]??p.rules_json.rooms[r.id]??{capacity:r.capacity,minimum:r.minimum}]))}};
 });
 const scoped=props.policies.find(p=>p.effective_on<=localDate(props.now)&&p.rules_json.venuePolicies?.[venueId]);
 const current=scoped?.rules_json.venuePolicies?.[venueId]??policies.find(p=>p.effective_on<=localDate(props.now))?.rules_json;
 const earliest=current?addDays(localDate(props.now),current.windowDays+1):props.earliest;
 const firstScoped=policies.filter(p=>p.scoped).map(p=>p.effective_on).sort()[0];
 const scopedPolicies=policies.filter(p=>p.scoped||!firstScoped||p.effective_on<firstScoped);
 return <><section className="panel"><label>설정할 수업장<select value={venueId} disabled={props.busy} onChange={e=>{if(window.confirm('수업장을 변경하면 저장하지 않은 정책 입력이 초기화됩니다. 변경할까요?'))setSelected(e.target.value);}}>{props.venues.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label></section><PolicyEditorForm key={venueId} {...props} venueId={venueId} rooms={rooms} policies={scopedPolicies} earliest={earliest}/></>;
}
