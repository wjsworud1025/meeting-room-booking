const {spawn}=require('node:child_process');
const {networkInterfaces}=require('node:os');
process.loadEnvFile('.env.lan.local');
const host=process.env.LAN_TEST_HOST;
const valid=Object.values(networkInterfaces()).flat().some(a=>a&&a.family==='IPv4'&&!a.internal&&a.address===host);
if(!valid)throw Error('LAN_TEST_HOST must match this PC Wi-Fi address. Update .env.lan.local.');
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname',host,'--port','3002'],{stdio:'inherit',windowsHide:true,env:process.env});
child.on('error',()=>{console.error('LAN test server could not start.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
