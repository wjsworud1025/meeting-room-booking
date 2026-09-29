import {z} from 'zod';
import {transaction,pool} from '../src/server/db';
import {issueAdmin} from '../src/server/admin';
import {audit} from '../src/server/store';
import {requireThat} from '../src/server/errors';
// Arguments: mode email name operator evidence reason unique-execution-id
const [mode,email,name,operator,evidence,reason,executionId]=process.argv.slice(2);
const v=z.object({mode:z.enum(['bootstrap','recovery']),email:z.string().trim().toLowerCase().email(),name:z.string().min(1),operator:z.string().min(2),evidence:z.string().min(2),reason:z.string().min(2),executionId:z.string().min(8)}).parse({mode,email,name,operator,evidence,reason,executionId});
await transaction(async(db,now)=>{
 const previous=(await db.query('SELECT after_summary FROM audit_events WHERE action=$1 AND request_id=$2',['system.'+v.mode,v.executionId])).rows[0];
 if(previous){requireThat(previous.after_summary.email===v.email,'EXECUTION_CONFLICT','Execution ID already used for another email');console.log('Existing request found. No duplicate invite issued.');return;}
 const s=(await db.query('SELECT * FROM settings WHERE id=1')).rows[0];if(v.mode==='bootstrap')requireThat(!s.admin_bootstrap_started_at,'BOOTSTRAP_STARTED','Bootstrap already started. Use recovery for access loss.');
 const result=await issueAdmin(db,{email:v.email,name:v.name,reason:v.reason,issuer:v.mode==='bootstrap'?'BOOTSTRAP':'RECOVERY',by:null},now);
 if(v.mode==='bootstrap')await db.query('UPDATE settings SET admin_bootstrap_started_at=$1,bootstrap_admin_id=$2 WHERE id=1',[now,result.id]);
 await audit(db,null,'system.'+v.mode,result.id,v.reason,now,v.executionId,{email:v.email,operator:v.operator,evidence:v.evidence,...result});console.log('Invitation recorded. Activation requires email verification and explicit acceptance.');
});await pool().end();
