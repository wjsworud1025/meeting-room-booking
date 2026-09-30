import type {DB} from './db';
import {requireThat} from './errors';
export async function cohortVenue(db:DB,cohortId:string|null){
 return (await db.query('SELECT v.id,v.name FROM cohorts c JOIN venues v ON v.id=c.venue_id WHERE c.id=$1',[cohortId])).rows[0] as {id:string;name:string}|undefined;
}
export async function assertRoomVenue(db:DB,cohortId:string|null,roomId:string){
 requireThat((await db.query('SELECT 1 FROM rooms r JOIN cohorts c ON c.venue_id=r.venue_id WHERE r.id=$1 AND c.id=$2 AND r.active',[roomId,cohortId])).rowCount,'ROOM_NOT_ALLOWED','소속 수업장의 회의실만 예약할 수 있습니다.',403);
}
export async function assertMembersVenue(db:DB,ids:string[],roomId:string){
 const rows=await db.query("SELECT m.id FROM members m JOIN cohorts c ON c.id=m.cohort_id JOIN rooms r ON r.venue_id=c.venue_id WHERE m.id=ANY($1::uuid[]) AND r.id=$2 AND m.role='STUDENT'",[ids,roomId]);
 requireThat(rows.rowCount===new Set(ids).size,'MEMBER_VENUE_MISMATCH','같은 수업장에 속한 학생만 참여할 수 있습니다.',403);
}
export async function requireVenue(db:DB,id:string){requireThat((await db.query('SELECT 1 FROM venues WHERE id=$1',[id])).rowCount,'INVALID_INPUT','수업장을 선택해 주세요.',422);}
