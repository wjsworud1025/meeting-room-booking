import {mkdirSync,writeFileSync} from 'node:fs';
import pg from 'pg';
import nodemailer from 'nodemailer';
import {createClient} from '@supabase/supabase-js';
type Result={name:string;status:'PASS'|'BLOCKED';detail:string};
const results:Result[]=[];
const present=(...keys:string[])=>keys.every(k=>!!process.env[k]?.trim());
async function probe(name:string,ready:boolean,run:()=>Promise<void>){if(!ready){results.push({name,status:'BLOCKED',detail:'필수 설정을 입력하세요.'});return;}try{await run();results.push({name,status:'PASS',detail:'연결 검사 성공. 실제 업무 인수 완료를 뜻하지 않습니다.'});}catch{results.push({name,status:'BLOCKED',detail:'연결 실패. 주소·자격 증명·TLS·네트워크 허용을 확인하세요. 비밀값과 공급자 응답은 출력하지 않습니다.'});}}
if(process.env.APP_ENV!=='production')throw Error('Use the dedicated production environment file.');
await probe('HTTPS 웹',present('APP_BASE_URL'),async()=>{const url=new URL(process.env.APP_BASE_URL!);if(url.protocol!=='https:')throw Error();const r=await fetch(new URL('/api/config',url),{redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok||(await r.json()).data?.local!==false)throw Error();});
await probe('PostgreSQL',present('DATABASE_URL'),async()=>{const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,statement_timeout:10000});try{await db.connect();await db.query('BEGIN READ ONLY');await db.query('SELECT 1');await db.query('COMMIT');}finally{await db.end();}});
const boundedFetch:typeof fetch=(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000),redirect:'error'});
function authClient(key:string){const url=new URL(process.env.SUPABASE_URL!);if(url.protocol!=='https:')throw Error();return createClient(url.href,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:boundedFetch}});}
await probe('Supabase 공개 키',present('SUPABASE_URL','SUPABASE_ANON_KEY'),async()=>{const url=new URL(process.env.SUPABASE_URL!);if(url.protocol!=='https:')throw Error();const r=await boundedFetch(new URL('/auth/v1/settings',url),{headers:{apikey:process.env.SUPABASE_ANON_KEY!}});if(!r.ok)throw Error();});
await probe('Supabase 관리자 키',present('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'),async()=>{const {error}=await authClient(process.env.SUPABASE_SERVICE_ROLE_KEY!).auth.admin.listUsers({page:1,perPage:1});if(error)throw Error();});
await probe('SMTP',present('SMTP_HOST','SMTP_FROM'),async()=>{const port=Number(process.env.SMTP_PORT??587);if(![465,587].includes(port))throw Error();const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:port!==465,auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:10000,disableFileAccess:true,disableUrlAccess:true});try{await transport.verify();}finally{transport.close();}});
const report={checkedAt:new Date().toISOString(),verdict:results.every(r=>r.status==='PASS')?'CONNECTIONS-ONLY-PASS':'BLOCKED',note:'No email sent, no account created, no DB mutation. SMTP sender acceptance and mailbox delivery require a separate real-message test. Supabase users are never written to the report.',results};mkdirSync('test-results',{recursive:true});writeFileSync('test-results/release-connections.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.verdict==='BLOCKED')process.exitCode=1;
