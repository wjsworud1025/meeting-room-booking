import {randomBytes} from 'node:crypto';
import type {ClientBase} from 'pg';
import {tenantTables} from './preparation';
import {runtimeFunctions} from './runtime-check';
/** Caller owns the transaction. Creates fresh roles; never modifies existing accounts. */
export async function installRuntimeRoles(db:ClientBase,names:string[]){
 if(names.length!==3||new Set(names).size!==3||names.some(n=>!/^saas_(web|control|worker)_[0-9]+(?:_[0-9]+)?$/.test(n)))throw Error('SAAS_INVALID_ROLE_NAMES');
 const passwords=names.map(()=>randomBytes(32).toString('hex'));
 for(let i=0;i<3;i++){
  const sql=(await db.query("SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD %L',$1::text,$2::text) sql",[names[i],passwords[i]])).rows[0].sql;
  await db.query(sql);
  await db.query(`GRANT USAGE ON SCHEMA saas_control TO "${names[i]}"`);
  for(const signature of runtimeFunctions[i])await db.query(`GRANT EXECUTE ON FUNCTION saas_control.${signature} TO "${names[i]}"`);
 }
 await db.query(`GRANT USAGE ON SCHEMA booking TO "${names[0]}"`);
 for(const t of tenantTables)await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON booking.${t} TO "${names[0]}"`);
 await db.query(`GRANT SELECT ON booking.holiday_years TO "${names[0]}"`);
 await db.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA booking TO "${names[0]}"`);
 await db.query(`GRANT USAGE ON SCHEMA identity TO "${names[1]}"`);
 await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON identity.accounts,identity.sessions TO "${names[1]}"`);
 await db.query(`GRANT SELECT ON identity.legacy_owner TO "${names[1]}"`);
 return names.map((name,i)=>({name,password:passwords[i]}));
}
