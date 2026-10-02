import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'회의실 예약',description:'구성원과 운영 담당자를 위한 회의실 예약 시스템'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>;}
