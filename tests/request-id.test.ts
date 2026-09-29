import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {requestId} from '../src/shared/request-id';
afterEach(()=>vi.unstubAllGlobals());
it('uses native UUID when available',()=>{const uuid='12345678-1234-4123-8123-123456789012';const native=vi.fn(()=>uuid);vi.stubGlobal('crypto',{randomUUID:native});expect(requestId()).toBe(uuid);expect(native).toHaveBeenCalledOnce();});
it('generates valid unique UUIDs on HTTP without randomUUID',()=>{
 vi.stubGlobal('crypto',{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)});
 const ids=Array.from({length:1000},()=>requestId());
 for(const id of ids)expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 expect(new Set(ids).size).toBe(ids.length);
});
