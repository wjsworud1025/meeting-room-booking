import pg from 'pg';
import {preflight,prepareCandidate} from './preparation';
const mode=process.argv[2]??'preflight';
if(!['preflight','dry-run'].includes(mode)) throw new Error('Use preflight or dry-run. Production apply is intentionally unavailable.');
const url=new URL(process.env.DATABASE_URL??'');
if(mode==='dry-run' && (process.env.APP_ENV!=='local' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname))) {
 throw new Error('SAAS_DRY_RUN_REQUIRES_LOCAL_RESTORE');
}
const db=new pg.Client({connectionString:url.toString()});
try {
 await db.connect();
 await db.query(mode==='preflight'?'BEGIN READ ONLY':'BEGIN');
 await db.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='60s'");
 if(mode==='preflight') {
  const data=await preflight(db);
  console.log(JSON.stringify({mode,tables:Object.keys(data).length,rows:Object.values(data).reduce((n,v)=>n+v.count,0),readyForRehearsal:true}));
 } else console.log(JSON.stringify({mode,...await prepareCandidate(db),persisted:false}));
} catch(error) {
 // PostgreSQL error detail may contain personal information or token values.
 const e=error as {message?:string;code?:string};
 console.error(/^SAAS_[A-Z_]+(?:: missing=[a-z_,]*; unexpected=[a-z_,]*)?$/.test(e.message??'')?e.message:`SAAS_CHECK_FAILED (${e.code??'unknown'})`);
 process.exitCode=1;
} finally {
 await db.query('ROLLBACK').catch(()=>{});
 await db.end();
}
