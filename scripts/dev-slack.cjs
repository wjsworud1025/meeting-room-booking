const {spawn}=require('node:child_process');
process.loadEnvFile('.env.slack.local');
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3001'],{stdio:'inherit',windowsHide:true,env:process.env});
child.on('error',()=>{console.error('Slack test server could not start.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
