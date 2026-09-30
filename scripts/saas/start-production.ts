import {spawn} from 'node:child_process';
import {checkRuntimeDatabases,runtimeConfiguration} from './runtime-check';

// Only an existing-customer pilot is released; unrestricted signup/deletion remain gated.
function releaseReady(){return process.env.SAAS_RELEASE_MODE==='pilot'&&process.env.SAAS_DELETION_ENABLED==='false';}
try{
 const checkOnly=process.argv.length===3&&process.argv[2]==='--check';
 if(process.argv.length>2&&!checkOnly)throw Error('SAAS_UNKNOWN_ARGUMENT');
 if(!checkOnly&&!releaseReady())throw Error('SAAS_RELEASE_NOT_READY');
 const result=await checkRuntimeDatabases(runtimeConfiguration(process.env));
 console.log(JSON.stringify({check:'saas-runtime',...result,releaseReady:releaseReady(),processesStarted:false}));
 if(!checkOnly){
  if(process.env.SAAS_STAGING==='true')throw Error('SAAS_STAGING_CONFIGURATION_FORBIDDEN');
  const children:ReturnType<typeof spawn>[]=[];let stopping=false;
  function stop(code:number){
   if(stopping)return;stopping=true;process.exitCode=code;
   for(const child of children)child.kill('SIGTERM');
   setTimeout(()=>{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');process.exit(code);},8000).unref();
  }
  function start(args:string[],jobs=false){
   const child=spawn(process.execPath,args,{stdio:'inherit',windowsHide:true,env:{...process.env,NODE_ENV:'production',RUN_JOBS:jobs?'true':'false'}});
   children.push(child);child.on('error',()=>{console.error('SAAS_PROCESS_START_FAILED');stop(1);});
   child.on('exit',()=>{if(!stopping)stop(1);});
  }
  // No migration/import commands. Credentials were rejected before any child starts.
  start(['node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port',process.env.PORT||'3000']);
  if(process.env.SLACK_APP_ENABLED==='true')start(['--import','tsx','src/slack/app.ts']);
  if(process.env.RUN_JOBS==='true')start(['--import','tsx','scripts/saas/run-worker.ts'],true);
  process.on('SIGINT',()=>stop(0));process.on('SIGTERM',()=>stop(0));
 }
}catch(e){
 const message=e instanceof Error?e.message:'';
 console.error(/^SAAS_[A-Z_]+$/.test(message)?message:'SAAS_RUNTIME_CHECK_FAILED');process.exitCode=1;
}
