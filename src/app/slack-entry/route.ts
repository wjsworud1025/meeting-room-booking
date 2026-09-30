import {randomBytes} from 'node:crypto';
export const dynamic='force-dynamic';
export function GET(){
 const nonce=randomBytes(18).toString('base64');
 return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>예약 연결</title><body><main><h1>회의실 예약</h1><p id="status" role="status">시간표를 여는 중입니다…</p></main><script nonce="${nonce}">
 const token=location.hash.slice(1);history.replaceState(null,'','/slack-entry');
 async function connect(){for(let attempt=0;attempt<20;attempt++){
 const response=await fetch('/api/auth/slack-web',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({token})});const data=await response.json();
 if(data.pending){await new Promise(resolve=>setTimeout(resolve,500));continue;}
 if(!response.ok)throw Error(data.error||'연결하지 못했습니다.');location.replace(data.destination);return;
 }throw Error('Slack 클릭 확인이 지연되고 있습니다.');}
 connect().catch(e=>{document.getElementById('status').textContent=e.message+' Slack 앱을 새로고침하고 다시 눌러 주세요.';});
 </script></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`}});
}
