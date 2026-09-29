import {existsSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,unlinkSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import pg from 'pg';

mkdirSync('.local',{recursive:true});
const credentialPath=resolve('.local/db-password');
if(!existsSync(credentialPath))writeFileSync(credentialPath,randomBytes(24).toString('hex'));
const password=readFileSync(credentialPath,'utf8').trim();
// PostgreSQL Windows binaries require ASCII paths even in Korean-named projects.
let base=resolve('.');
if(process.platform==='win32'&&/[^\x00-\x7f]/.test(base)){
 const alias=join(tmpdir(),'booking-'+createHash('sha256').update(base).digest('hex').slice(0,12));
 if(!existsSync(alias))symlinkSync(base,alias,'junction');base=alias;
}
const data=join(base,'.local/postgres'),bin=join(base,'node_modules/@embedded-postgres/windows-x64/native/bin');
if(process.platform!=='win32')throw Error('This launcher supports Windows only. Start PostgreSQL 17 separately and configure DATABASE_URL on other platforms.');
function run(tool:string,args:string[]){const r=spawnSync(join(bin,tool+'.exe'),args,{windowsHide:true,stdio:'ignore',cwd:base});if(r.status!==0)throw Error(`${tool} failed (${r.status}). Check .local/postgres.log`);}
if(!existsSync(join(data,'PG_VERSION'))){const pw=join(base,'.local/init-password');writeFileSync(pw,password);try{run('initdb',['-D',data,'-U','booking','--pwfile='+pw,'--auth=scram-sha-256','--encoding=UTF8','--locale=C']);}finally{unlinkSync(pw);}}
const running=spawnSync(join(bin,'pg_ctl.exe'),['-D',data,'status'],{windowsHide:true,stdio:'ignore'}).status===0;
if(!running)run('pg_ctl',['-D',data,'-l',join(base,'.local/postgres.log'),'-o','-h 127.0.0.1 -p 55432','-w','start']);
const c=new pg.Client({host:'127.0.0.1',port:55432,user:'booking',password,database:'postgres'});await c.connect();
if(!(await c.query("SELECT 1 FROM pg_database WHERE datname='booking'")).rowCount)await c.query('CREATE DATABASE booking');
await c.end();
if(!existsSync('.env.local'))writeFileSync('.env.local',`APP_ENV=local\nAPP_BASE_URL=http://localhost:3000\nDATABASE_URL=postgres://booking:${password}@127.0.0.1:55432/booking\nMIGRATION_DATABASE_URL=postgres://booking:${password}@127.0.0.1:55432/booking\nSESSION_SECRET=${randomBytes(32).toString('hex')}\nRUN_JOBS=true\n`);
console.log('Local PostgreSQL ready at 127.0.0.1:55432. Credentials saved to ignored .env.local. Keep this process running.');
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{run('pg_ctl',['-D',data,'-m','fast','-w','stop']);process.exit(0);});
setInterval(()=>{},60000);
