import type {Rules} from './types';
export const policyFields=[['windowDays','예약 가능 일수',1,30],['slotMinutes','예약 단위 (분)',5,60],['maxMinutes','최대 이용시간 (분)',30,720],['refillMinutes','인원 보충 기한 (분)',1,60],['cooldownMinutes','신규 신청 제한 (분)',1,60],['gapMinutes','같은 모임 간격 (분)',1,1440],['threshold','공통 인원 비율 (%)',0,99]] as const;
export function policyProblems(rules:Rules){
 const errors:string[]=[];
 for(const [key,label,min,max] of policyFields)if(!Number.isFinite(rules[key])||rules[key]<min||rules[key]>max||key!=='threshold'&&!Number.isInteger(rules[key]))errors.push(`${label}: ${min}–${max}${key==='threshold'?'':' 사이 정수'}로 입력해 주세요.`);
 if(!validPeriod(rules.open,rules.close))errors.push('운영 종료는 시작보다 늦어야 합니다.');
 if(rules.maxMinutes%rules.slotMinutes!==0)errors.push('최대 이용시간은 예약 단위의 배수여야 합니다.');
 if(!rules.weekdays.length)errors.push('운영 요일을 하나 이상 선택해 주세요.');
 if(Object.values(rules.rooms).some(r=>!Number.isInteger(r.capacity)||!Number.isInteger(r.minimum)||r.minimum<2||r.minimum>r.capacity||r.capacity>100))errors.push('회의실은 2명 이상, 최소 인원 ≤ 정원 ≤ 100명이어야 합니다.');
 return errors;
}
export function validPeriod(start:string,end:string){return /^([01]\d|2[0-3]):[0-5]\d$/.test(start)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(end)&&start<end;}
export function studentImport(csv:string,existing:{email:string|null;status:string}[]=[]){
 const rows:{line:number;name:string;email:string;className:string}[]=[],errors:string[]=[],seen=new Set<string>();
 const lines=csv.replace(/^\uFEFF/,'').split(/\r?\n/);let first=true;
 for(let i=0;i<lines.length;i++){
  if(!lines[i].trim())continue;const fields=lines[i].split(',').map(s=>s.trim());
  if(first&&['이름','name'].includes(fields[0])){first=false;if(fields.length>3||fields.some(v=>/^(role|역할)$/i.test(v)))errors.push(`${i+1}행: 역할 열은 사용할 수 없습니다. 이름,이메일,반 열만 입력하세요.`);continue;}first=false;
  const [name='',rawEmail='',className='']=fields,email=rawEmail.toLowerCase(),line=i+1;
  if(fields.length<2||fields.length>3||fields.some(f=>f.includes('"'))){errors.push(`${line}행: 이름,이메일,반 형식으로 입력하세요. 필드 안의 쉼표·따옴표는 지원하지 않습니다.`);continue;}
  if(!name||name.length>80)errors.push(`${line}행: 이름은 1–80자로 입력하세요.`);
  if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))errors.push(`${line}행: 이메일 형식을 확인해 주세요.`);
  if(className.length>80)errors.push(`${line}행: 반 이름은 80자 이하로 입력하세요.`);
  if(seen.has(email))errors.push(`${line}행: 중복 이메일입니다 (${email}).`);seen.add(email);
  if(existing.some(s=>s.email?.toLowerCase()===email&&s.status!=='INACTIVE'))errors.push(`${line}행: 이미 등록된 학생 이메일입니다 (${email}).`);
  rows.push({line,name,email,className});
 }
 if(rows.length>200)errors.push('한 번에 최대 200명까지 등록할 수 있습니다.');
 if(!rows.length&&!errors.length&&csv.trim())errors.push('등록할 학생 행을 추가해 주세요.');
 return {rows,errors,students:rows.map(({name,email,className})=>({name,email,className}))};
}
export const adminActionLabels:Record<string,string>={
 'booking.create':'예약 신청','booking.change':'예약 변경','booking.cancel':'예약 취소','booking.invite':'구성원 자동 참여','booking.leave':'본인 참여 취소','reservation.cancel':'예약 자동 취소',
 'admin.closure':'휴관 적용','admin.exception.open':'예외 개방 등록','admin.exception.remove':'운영 예외 해제','admin.policy':'예약 정책 저장','admin.student.register':'학생 등록','admin.student.deactivate':'학생 비활성화','admin.cohort.end':'기수 종료',
 'admin.account.invite':'관리자 초대','admin.account.resend':'초대 재발송','admin.account.reinvite':'관리자 재초대','admin.account.revoke':'초대 취소','admin.account.deactivate':'관리자 권한 회수','admin.reservation.removeMember':'참여자 제외','admin.report.resolve':'신고 처리','admin.sanction':'학생 안내·제한','admin.sanction.revoke':'학생 제한 해제','admin.holiday.save':'휴일 표시 저장','admin.holiday.reset':'휴일 원본 복원','admin.holiday.sync':'공휴일 동기화 요청','admin.holiday.acknowledge':'휴일 변경 검토 완료',
};
