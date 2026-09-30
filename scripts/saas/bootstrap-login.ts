import {bindLegacyOwner} from '../../src/server/login-accounts';
import {pool} from '../../src/server/db';
const loginId=process.argv[2];
const password=process.env.INITIAL_ADMIN_PASSWORD;
if(!loginId||!password)throw new Error('Provide login ID argument and INITIAL_ADMIN_PASSWORD environment variable.');
try {const result=await bindLegacyOwner(loginId,password);console.log(JSON.stringify({loginId,...result,passwordChangeRequired:true}));}
catch(e){console.error('ACCOUNT_BOOTSTRAP_FAILED',(e as {code?:string}).code??'validation');process.exitCode=1;}
finally {await pool().end();}
