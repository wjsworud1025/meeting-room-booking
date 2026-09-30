import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {cookieName,isLocal,rateLimit,seal} from '@/server/auth';
import {redeemWebLink,slackWebBase} from '@/server/slack-web';
import {AppError,requireThat} from '@/server/errors';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 try{
  requireThat(req.headers.get('origin')===slackWebBase(),'CSRF','요청 출처를 확인해 주세요.',403);
  const {token}=z.object({token:z.string().max(100)}).strict().parse(await req.json());
  rateLimit('slack-web:'+token,30);
  const {session,destination}=await redeemWebLink(token);
  const response=NextResponse.json({destination},{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  response.cookies.set(cookieName,seal(session),{httpOnly:true,sameSite:'lax',secure:!isLocal(),path:'/',maxAge:8*3600});return response;
 }catch(error){if(error instanceof AppError&&error.code==='LINK_PENDING')return NextResponse.json({pending:true},{status:202,headers:{'Cache-Control':'no-store'}});return NextResponse.json({error:error instanceof AppError?error.message:'Slack에서 다시 열어 주세요.'},{status:error instanceof AppError?error.status:400,headers:{'Cache-Control':'no-store'}});}
}
