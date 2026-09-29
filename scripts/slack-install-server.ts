import {createServer} from 'node:http';
import {NextRequest} from 'next/server';
import {startInstall,finishInstall} from '../src/slack/oauth';
// A future HTTPS tunnel may expose this dedicated OAuth listener only.
// Never forward the local development app or its mailbox through a public tunnel.
const server=createServer(async(req,res)=>{
 const address=new URL(req.url??'/','http://127.0.0.1');
 if(req.method!=='GET'||!['/api/slack/install','/api/slack/install/callback'].includes(address.pathname)){res.writeHead(404);res.end('Not found');return;}
 try{
  const url=new URL(address.pathname+address.search,process.env.APP_BASE_URL);
  const request=new NextRequest(url,{headers:{cookie:req.headers.cookie??''}});
  const response=address.pathname.endsWith('/callback')?await finishInstall(request):startInstall(request);
  res.writeHead(response.status,Object.fromEntries(response.headers.entries()));res.end(await response.text());
 }catch{res.writeHead(500,{'Cache-Control':'no-store'});res.end('Installation unavailable');}
});
server.listen(3003,'127.0.0.1',()=>console.log('Slack OAuth-only listener: 127.0.0.1:3003'));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(()=>process.exit(0)));
