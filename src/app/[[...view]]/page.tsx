import {Suspense} from 'react';
import Application from '@/components/application';
export default function Page(){return <Suspense fallback={<div className="loading">회의실 예약을 불러오는 중입니다…</div>}><Application/></Suspense>;}
