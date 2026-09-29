const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3000';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  async function login(email){const context=await browser.newContext();const page=await context.newPage();await page.goto(base+'/login');await page.getByLabel('이메일',{exact:true}).fill(email);await page.getByRole('button',{name:'인증 코드 받기'}).click();await expect(page.getByLabel('인증 코드',{exact:true})).toBeVisible();const inbox=await(await context.request.get(base+'/api/dev/mailbox')).json();await page.getByLabel('인증 코드',{exact:true}).fill(inbox.data.find(m=>m.recipient===email&&m.subject.includes('인증 코드')).body.match(/\d{6}/)[0]);await page.getByRole('button',{name:'로그인',exact:true}).click();await page.waitForURL('**/schedule');return {context,page};}
  const owner=await login('jiwon@example.com'),guest=await login('eunwoo@example.com');
  const initial=await(await owner.context.request.get(base+'/api/snapshot')).json();
  const next=new Date(initial.data.now);next.setUTCDate(next.getUTCDate()+1);while([0,6].includes(next.getUTCDay()))next.setUTCDate(next.getUTCDate()+1);
  const date=next.toISOString().slice(0,10),room=initial.data.rooms[2];
  await owner.page.goto(`${base}/book?room=${room.id}&date=${date}&time=18:00&duration=60`);
  await owner.page.getByLabel('이름으로 학생 찾기').fill('이은우');await owner.page.getByRole('button',{name:/이은우/}).click();await owner.page.getByRole('button',{name:'예약 신청',exact:true}).click();await owner.page.waitForURL('**/reservations/*');
  const detailUrl=owner.page.url();await expect(owner.page.locator('.page-heading .badge')).toHaveText('예약 확정');
  await guest.page.goto(detailUrl);await expect(guest.page.getByRole('button',{name:'초대 수락',exact:true})).toHaveCount(0);await expect(guest.page.locator('.page-heading .badge')).toHaveText('예약 확정');
  await expect(owner.page.locator('.page-heading .badge')).toHaveText('예약 확정',{timeout:10000});
  await owner.page.getByRole('button',{name:'전체 예약 취소',exact:true}).click();await owner.page.locator('.action-form').getByRole('button',{name:'전체 예약 취소',exact:true}).click();await expect(owner.page.locator('.page-heading .badge')).toHaveText('취소');
  await expect(guest.page.locator('.page-heading .badge')).toHaveText('취소',{timeout:10000});
  console.log('PASS: independent users create → automatic participation → confirm → cancel; live polling synchronized.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
