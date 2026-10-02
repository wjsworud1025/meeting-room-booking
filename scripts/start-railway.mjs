import {spawn} from 'node:child_process';
import {createServer} from 'node:http';

// Maintenance replaces every web/socket/worker process before the final backup.
if(process.env.BOOKING_MAINTENANCE==='true'){
 createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url==='/api/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"data":{"ok":true,"maintenance":true}}');return;}res.writeHead(503,{'Content-Type':'text/html; charset=utf-8','Retry-After':'300'});res.end('<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width"><title>회의실 예약 · 점검 중</title><main style="max-width:520px;margin:15vh auto;padding:24px;font-family:sans-serif"><h1>서비스를 업데이트하고 있습니다</h1><p>예약 데이터는 안전하게 보관됩니다. 잠시 후 다시 접속해 주세요.</p></main></html>');}).listen(Number(process.env.PORT||3000),'0.0.0.0');
}else if(process.env.SAAS_ENABLED==='true'){
 const child=spawn(process.execPath,['--import','tsx','scripts/saas/start-production.ts'],{stdio:'inherit',env:process.env});
 child.on('error',()=>process.exit(1));child.on('exit',code=>process.exit(code??1));
 process.on('SIGTERM',()=>child.kill('SIGTERM'));process.on('SIGINT',()=>child.kill('SIGINT'));
}else{

if(process.env.APP_ENV!=='production')throw Error('Railway requires APP_ENV=production.');
for(const key of ['DATABASE_URL','SESSION_SECRET','APP_BASE_URL'])if(!process.env[key])throw Error(`Missing ${key}`);
if(new URL(process.env.APP_BASE_URL).protocol!=='https:')throw Error('HTTPS APP_BASE_URL required.');
if(process.env.LAN_TEST_HOST||process.env.SLACK_TEST_ENV==='true')throw Error('Remove local test configuration.');
if(process.env.SLACK_APP_ENABLED==='true'&&(!process.env.SLACK_APP_TOKEN||!process.env.SLACK_TOKEN_ENCRYPTION_KEY))throw Error('Slack runtime configuration missing.');

const children=[];let stopping=false;
process.env.MIGRATION_DATABASE_URL=process.env.DATABASE_URL;
await new Promise((resolve,reject)=>{const migration=spawn(process.execPath,['--import','tsx','scripts/migrate.ts'],{stdio:'inherit',env:process.env});migration.on('error',reject);migration.on('exit',code=>code===0?resolve():reject(Error('Database migration failed')));});
await import('./import-railway.mjs');
function stop(code){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>{for(const child of children)child.kill('SIGKILL');process.exit(code);},8000).unref();process.exitCode=code;}
function start(args){const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env});children.push(child);child.on('error',()=>{console.error('Service could not start.');stop(1);});child.on('exit',code=>{if(!stopping)stop(code||1);});return child;}
start(['node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port',process.env.PORT||'3000']);
if(process.env.SLACK_APP_ENABLED==='true')start(['--import','tsx','src/slack/app.ts']);
process.on('SIGTERM',()=>stop(0));process.on('SIGINT',()=>stop(0));
}
