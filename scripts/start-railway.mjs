import {spawn} from 'node:child_process';

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
