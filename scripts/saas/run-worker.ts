import {checkRuntimeDatabases,runtimeConfiguration} from './runtime-check';
import {tick} from '../../src/server/jobs';
import {basePool,controlPool,schedulerPool} from '../../src/server/db';
if(process.env.RUN_JOBS!=='true')throw Error('SAAS_WORKER_DISABLED');
await checkRuntimeDatabases(runtimeConfiguration(process.env));
let stopping=false;
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
try{
 while(!stopping){
  try{await tick();}catch{console.error('SAAS_WORKER_TICK_FAILED');}
  if(!stopping)await new Promise(resolve=>setTimeout(resolve,2000));
 }
}finally{await Promise.allSettled([basePool().end(),controlPool().end(),schedulerPool().end()]);}
