import {afterEach,expect,it,vi} from 'vitest';
import {api} from '../src/components/api';
afterEach(()=>vi.unstubAllGlobals());
it.each([['/schedule','student'],['/my-reservations','student'],['/admin/reservations','admin'],['/admin/login','admin'],['/account','admin']])('selects tab identity for %s',async(pathname,context)=>{
 vi.stubGlobal('window',{location:{pathname}});const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({data:{}})});vi.stubGlobal('fetch',fetcher);
 await api('snapshot');expect(fetcher.mock.calls[0][1].headers['X-Booking-Context']).toBe(context);
});
