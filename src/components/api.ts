export class APIError extends Error{constructor(message:string,public code:string,public status:number){super(message);}}
export async function api<T>(url:string,body?:unknown,key?:string):Promise<T>{
 const response=await fetch('/api/'+url,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 const result=await response.json();if(!response.ok)throw new APIError(result.error?.message??'요청을 처리하지 못했습니다.',result.error?.code??'ERROR',response.status);return result.data;
}
