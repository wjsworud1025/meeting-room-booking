import {afterEach,expect,it,vi} from 'vitest';
import {privateIPv4,allowedLocalHost} from '../src/server/local-network';
afterEach(()=>vi.unstubAllEnvs());
it('accepts only private IPv4 addresses',()=>{
 for(const h of ['10.0.0.1','172.16.1.1','172.31.255.1','192.168.10.64'])expect(privateIPv4(h)).toBe(true);
 for(const h of ['8.8.8.8','172.32.1.1','127.0.0.1','192.168.1.999','example.com','0.0.0.0'])expect(privateIPv4(h)).toBe(false);
});
it('permits only the explicitly configured LAN host',()=>{vi.stubEnv('LAN_TEST_HOST','192.168.10.64');expect(allowedLocalHost('192.168.10.64')).toBe(true);expect(allowedLocalHost('192.168.10.65')).toBe(false);vi.stubEnv('LAN_TEST_HOST','8.8.8.8');expect(allowedLocalHost('8.8.8.8')).toBe(false);});
