const {request,expect}=require('@playwright/test');
const {randomUUID}=require('node:crypto');const fs=require('node:fs');
(async()=>{const base='http://127.0.0.1:3000',context=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base}});try{
 expect((await context.get('/api/snapshot')).status()).toBe(401);
 expect((await context.post('/api/auth/otp/request',{headers:{Origin:'https://foreign.invalid'},data:{email:'minseo@example.com'}})).status()).toBe(403);
 expect((await context.post('/api/auth/otp/request',{headers:{'Content-Type':'text/plain'},data:'{}'})).status()).toBe(415);
 expect((await context.post('/api/auth/otp/request',{headers:{'Content-Type':'application/json'},data:'{'})).status()).toBe(422);
 expect((await context.post('/api/auth/otp/request',{data:{email:'minseo@example.com',padding:'x'.repeat(100001)}})).status()).toBe(413);
 expect((await context.post('/api/auth/otp/request',{data:{email:'minseo@example.com'}})).status()).toBe(200);
 const box=await(await context.get('/api/dev/mailbox')).json(),code=box.data.find(m=>m.recipient==='minseo@example.com'&&m.subject.includes('인증 코드')).body.match(/\d{6}/)[0];
 expect((await context.post('/api/auth/otp/verify',{data:{email:'minseo@example.com',code}})).status()).toBe(200);
 expect((await context.post('/api/auth/otp/verify',{data:{email:'minseo@example.com',code}})).status()).toBe(401);
 expect((await context.get('/api/admin/data')).status()).toBe(403);expect((await context.get('/api/admin/holidays')).status()).toBe(403);
 expect((await context.get('/api/snapshot?date=invalid')).status()).toBe(422);
 expect((await context.post('/api/commands',{headers:{'Idempotency-Key':randomUUID()},data:{name:'admin.policy',input:{}}})).status()).toBe(403);
 const samples=[];for(let round=0;round<5;round++){await Promise.all(Array.from({length:10},async()=>{const start=performance.now(),r=await context.get('/api/snapshot');expect(r.status()).toBe(200);expect(r.headers()['cache-control']).toBe('no-store');samples.push(performance.now()-start);}));}
 samples.sort((a,b)=>a-b);const metrics={environment:'local development server; warm requests; not production capacity proof',requests:50,concurrency:10,p50Ms:Math.round(samples[24]),p95Ms:Math.round(samples[47]),maxMs:Math.round(samples[49])};fs.writeFileSync('test-results/release-api-metrics.json',JSON.stringify(metrics,null,2));
 await context.post('/api/auth/logout',{data:{}});expect((await context.get('/api/snapshot')).status()).toBe(401);
 console.log(JSON.stringify({passed:true,checks:'unauthenticated, CSRF, content-type, JSON, size, OTP single-use, student admin denial, invalid date, cache, concurrent reads, logout',metrics},null,2));
 }finally{await context.dispose();}})().catch(e=>{console.error(e);process.exitCode=1});
