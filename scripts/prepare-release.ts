import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const target='.env.release.local';
try{const template=readFileSync('config/production.env.example','utf8');writeFileSync(target,template.replace('SESSION_SECRET=','SESSION_SECRET='+randomBytes(32).toString('hex')),{flag:'wx',mode:0o600});console.log('Created .env.release.local with a random session secret. Fill empty values locally. Local development settings were not modified.');}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')console.log('.env.release.local already exists; preserved without changes.');else{console.error('Could not prepare release environment file.');process.exitCode=1;}}
