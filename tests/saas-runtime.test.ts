import {describe,it,expect} from 'vitest';
import {runtimeConfiguration} from '../scripts/saas/runtime-check';
const valid=()=>({APP_ENV:'production',SAAS_ENABLED:'true',APP_BASE_URL:'https://booking.example.test',SESSION_SECRET:'x'.repeat(40),RUN_JOBS:'false',DATABASE_URL:'postgres://web:secret@db:5432/booking',CONTROL_DATABASE_URL:'postgres://control:secret@db:5432/booking',WORKER_DATABASE_URL:'postgres://worker:secret@db:5432/booking'});
describe('SaaS runtime configuration',()=>{
 it('accepts explicitly enabled workers',()=>expect(runtimeConfiguration({...valid(),RUN_JOBS:'true'})).toHaveLength(3));
 it('accepts distinct runtime roles',()=>expect(runtimeConfiguration(valid())).toHaveLength(3));
 it.each([
  [{MIGRATION_DATABASE_URL:'postgres://owner:secret@db/booking'},'MIGRATION_CREDENTIALS_FORBIDDEN'],
  [{INITIAL_ADMIN_PASSWORD:'secret'},'MIGRATION_CREDENTIALS_FORBIDDEN'],
  [{APP_BASE_URL:'http://booking.example.test'},'HTTPS_ORIGIN_REQUIRED'],
  [{CONTROL_DATABASE_URL:'postgres://web:secret@db:5432/booking'},'DISTINCT_ROLES_SAME_DATABASE_REQUIRED'],
  [{WORKER_DATABASE_URL:'postgres://worker:secret@other/booking'},'DISTINCT_ROLES_SAME_DATABASE_REQUIRED'],
  [{RUN_JOBS:undefined},'EXPLICIT_JOB_MODE_REQUIRED'],
  [{SAAS_DELETION_ENABLED:'true'},'DELETION_RETENTION_NOT_READY'],
  [{SLACK_WEB_BASE_URL:'https://other.example.test'},'SLACK_ORIGIN_MISMATCH'],
  [{DATABASE_URL:'not-a-connection-secret'},'INVALID_DATABASE_URL'],
  [{SLACK_APP_ENABLED:'true'},'MISSING_SLACK_APP_ID'],
 ])('rejects unsafe configuration without echoing credentials: %j',(override,code)=>{
  expect(()=>runtimeConfiguration({...valid(),...override})).toThrow('SAAS_'+code);
 });
});
