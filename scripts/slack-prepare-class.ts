import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {pool,transaction} from '../src/server/db';
import {localDate} from '../src/shared/time';
const schema=z.object({workspaceUrl:z.url(),teamId:z.string().regex(/^T[A-Z0-9]+$/),className:z.string().min(1).max(80),autoEnroll:z.boolean(),sharedFacility:z.literal(true)});
const config=schema.parse(JSON.parse(readFileSync(process.argv[2]??'config/slack-hri-test.json','utf8')));
if(process.env.APP_ENV!=='local')throw Error('This preparation script is for the local pilot only.');
try{
 await transaction(async(db)=>{
  const existing=(await db.query('SELECT cohort_id FROM slack_workspace_classes WHERE team_id=$1',[config.teamId])).rows[0];
  if(existing){console.log('Class mapping already exists; preserved.');return;}
  const cohort=(await db.query("INSERT INTO cohorts(name,starts_on,ends_on) VALUES($1,$2,'9999-12-31') RETURNING id",[config.className,localDate()])).rows[0];
  await db.query('INSERT INTO slack_workspace_classes(team_id,class_name,cohort_id,auto_enroll) VALUES($1,$2,$3,$4)',[config.teamId,config.className,cohort.id,config.autoEnroll]);
  console.log('Prepared class mapping:',config.teamId,config.className);
 });
}finally{await pool().end();}
