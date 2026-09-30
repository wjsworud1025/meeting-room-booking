import {zipSync,strToU8} from 'fflate';
import {basePool,schedulerPool,controlPool} from '../db';
import {accountSession,reauthenticateAccount} from '../login-accounts';
import {requireThat,AppError} from '../errors';
export async function spaceInfo(token:string|undefined){const a=await accountSession(token);return {...(await controlPool().query('SELECT saas_control.space_info($1) info',[a.id])).rows[0].info,pilot:process.env.SAAS_RELEASE_MODE==='pilot'};}
export async function spaceAction(token:string|undefined,password:string,action:string,input:Record<string,string>){
 requireThat(!(process.env.SAAS_RELEASE_MODE==='pilot'&&action==='delete.request'),'DELETION_UNAVAILABLE','데이터 삭제 기능은 준비 중입니다.',503);
 const a=await reauthenticateAccount(token,password);
 try{return (await controlPool().query('SELECT saas_control.space_action($1,$2,$3) result',[a.id,action,JSON.stringify({...input,accountVersion:String(a.version)})])).rows[0].result;}
 catch(e){const code=(e as {code?:string}).code;const m=e instanceof Error?e.message:'';
  if(['P0001','P0002','23505'].includes(code??''))throw new AppError('SPACE_ACTION_REJECTED',m==='SPACE_ALREADY_OWNED'?'대상 계정에 이미 운영 공간이 있습니다.':m==='SPACE_NAME_MISMATCH'?'운영 공간 이름을 정확히 입력해 주세요.':'대상 계정 또는 요청 상태를 확인해 주세요.',409);throw e;
 }
}
export async function downloadExport(token:string|undefined,password:string,id:string){
 const a=await reauthenticateAccount(token,password);const bytes=(await controlPool().query('SELECT saas_control.download_export($1,$2,$3) data',[a.id,id,a.version])).rows[0].data;
 requireThat(bytes,'NOT_FOUND','파일이 만료되었거나 다운로드 권한이 없습니다.',404);return bytes as Buffer;
}
export async function tickExports(){
 const claim=(await schedulerPool().query('SELECT * FROM saas_control.claim_export()')).rows[0];if(!claim)return false;
 try{
  const snapshot=(await basePool().query('SELECT saas_control.export_snapshot($1,$2) data',[claim.id,claim.lease])).rows[0].data;
  if(Buffer.byteLength(JSON.stringify(snapshot))>50*1024*1024)throw Error('EXPORT_TOO_LARGE');
  const files:Record<string,Uint8Array>={'manifest.json':strToU8(JSON.stringify(snapshot.manifest,null,2))};
  for(const [table,rows] of Object.entries(snapshot.tables))files[table+'.json']=strToU8(JSON.stringify(rows,null,2));
  const archive=zipSync(files,{level:6});
  const finished=await schedulerPool().query('SELECT saas_control.finish_export($1,$2,$3) ok',[claim.id,claim.lease,Buffer.from(archive)]);return finished.rows[0].ok===true;
 }catch{await schedulerPool().query('SELECT saas_control.finish_export($1,$2,NULL)',[claim.id,claim.lease]);return false;}
}
