import {expect,it,vi} from 'vitest';
import {adminCommand} from '../src/server/admin';
import type {DB} from '../src/server/db';
import type {Member,Session} from '../src/shared/types';
vi.mock('../src/server/venues',()=>({requireVenue:vi.fn()}));
const id='11111111-1111-4111-8111-111111111111',venueId='22222222-2222-4222-8222-222222222222';
const now=new Date('2026-10-01T00:00:00Z');
function fixture(date='2026-10-06',used=false,other=false){const query=vi.fn(async(sql:string)=>{if(sql.startsWith('SELECT * FROM policy_versions'))return {rows:[{id,effective_on:date,rules_json:{venueOnly:true,venuePolicies:{[venueId]:{},...(other?{other:{}}:{})}}}],rowCount:1};if(sql.startsWith('SELECT 1 FROM reservations'))return {rows:[],rowCount:used?1:0};return {rows:[],rowCount:1};});return {query};}
async function remove(db:ReturnType<typeof fixture>,role='ADMIN'){return adminCommand(db as unknown as DB,{role,status:'ACTIVE'} as Member,{} as Session,'policy.remove',{id,venueId},now);}
it('deletes an unused future policy',async()=>{const db=fixture();await remove(db);expect(db.query).toHaveBeenCalledWith('DELETE FROM policy_versions WHERE id=$1',[id]);});
it('preserves other venues sharing the same policy row',async()=>{const db=fixture('2026-10-06',false,true);await remove(db);expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE policy_versions'),[id,JSON.stringify({other:{}})]);expect(db.query.mock.calls.some(([sql])=>sql.startsWith('DELETE'))).toBe(false);});
it.each(['2026-10-01','2026-09-01'])('protects active and historical policy %s',async date=>{await expect(remove(fixture(date))).rejects.toMatchObject({code:'POLICY_IN_USE'});});
it('protects reservation references',async()=>{await expect(remove(fixture('2026-10-06',true))).rejects.toMatchObject({code:'POLICY_IN_USE'});});
it('denies learner deletion',async()=>{await expect(remove(fixture(),'STUDENT')).rejects.toMatchObject({status:403});});
