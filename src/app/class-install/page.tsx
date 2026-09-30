import {readInstallRequest} from '@/server/class-install';
export const dynamic='force-dynamic';
export const metadata={title:'클래스 연결',referrer:'no-referrer',robots:{index:false,follow:false}};
export default async function ClassInstall({searchParams}:{searchParams:Promise<{token?:string}>}){
 const {token=''}=await searchParams;
 try{const r=await readInstallRequest(token);return <main className="content-page"><section className="panel"><h1>클래스 연결</h1><h2>{r.name}</h2><p>{r.venue_name}</p><p>이 클래스에서 사용할 Slack 워크스페이스를 선택해 주세요. 설치하면 활성 구성원이 이 수업장의 회의실을 이용할 수 있습니다.</p><a className="primary" href={'/api/slack/install?invite='+encodeURIComponent(token)}>Slack에 설치</a><p className="subtle">워크스페이스 정책에 따라 Slack 관리자의 승인이 필요할 수 있습니다. 예약 시스템 관리자 계정은 필요하지 않습니다.</p></section></main>;}catch{return <main className="content-page"><h1>설치 링크를 확인해 주세요</h1><p>만료·취소되었거나 이미 사용된 링크입니다. 관리자에게 새 링크를 요청하세요.</p></main>;}
}
