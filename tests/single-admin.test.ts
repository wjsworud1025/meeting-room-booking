import {describe,it,expect} from 'vitest';
import {adminCandidates,respondSlackAdmin} from '../src/server/slack-admin';
import type {Session} from '../src/shared/types';
const session:Session={memberId:'unused',accessVersion:1,verifiedAt:0,expiresAt:0,sessionId:'test'};
describe('single administrator',()=>{
 it('disables candidate discovery',async()=>{await expect(adminCandidates(session,'T','')).rejects.toMatchObject({code:'SINGLE_ADMIN_ONLY'});});
 it.each([true,false])('rejects obsolete Slack invitation buttons (%s)',async accept=>{await expect(respondSlackAdmin('T','U','invite',accept)).rejects.toMatchObject({code:'SINGLE_ADMIN_ONLY'});});
});
