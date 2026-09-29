const {spawn}=require('node:child_process');const assert=require('node:assert/strict');
(async()=>{const base='http://127.0.0.1:3101';let child;
 try{try{await fetch(base+'/api/health',{signal:AbortSignal.timeout(700)});throw Error('Port 3101 already in use; refusing to test an unrelated server');}catch(e){if(e.message.includes('already in use'))throw e;}
 child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3101'],{env:{...process.env,NODE_ENV:'production',APP_ENV:'local',RUN_JOBS:'false',APP_BASE_URL:base,SUPABASE_URL:'',SUPABASE_ANON_KEY:'',SUPABASE_SERVICE_ROLE_KEY:''},stdio:'ignore',windowsHide:true});
 let ready=false;for(let i=0;i<40;i++){try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error('Production smoke server exited');await new Promise(r=>setTimeout(r,500));}assert.ok(ready,'production server readiness');
 assert.equal((await(await fetch(base+'/api/config')).json()).data.local,false);assert.equal((await fetch(base+'/api/dev/mailbox')).status,404);assert.equal((await fetch(base+'/api/snapshot')).status,401);
 const otp=await fetch(base+'/api/auth/otp/request',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com'})});assert.equal(otp.status,503);assert.equal((await otp.json()).error.code,'CONFIGURATION');
 console.log('PASS: production build starts; local=true cannot enable local auth in production; mailbox blocked; anonymous access blocked; missing external auth fails closed. No email sent.');
 }finally{if(child)child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
