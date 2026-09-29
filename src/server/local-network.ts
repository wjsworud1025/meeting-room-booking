import {isIP} from 'node:net';
export function privateIPv4(host:string){
 if(isIP(host)!==4)return false;
 const [a,b]=host.split('.').map(Number);
 return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
}
export function allowedLocalHost(host:string){
 return ['localhost','127.0.0.1'].includes(host)||(host===process.env.LAN_TEST_HOST&&privateIPv4(host));
}
