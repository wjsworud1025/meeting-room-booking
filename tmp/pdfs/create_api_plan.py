from pathlib import Path
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT
from pypdf import PdfReader
import pypdfium2 as pdfium
pdfmetrics.registerFont(TTFont('Malgun','C:/Windows/Fonts/malgun.ttf'))
pdfmetrics.registerFont(TTFont('MalgunBold','C:/Windows/Fonts/malgunbd.ttf'))
pdfmetrics.registerFontFamily('Malgun',normal='Malgun',bold='MalgunBold')
out=Path('output/pdf/공공데이터_API_활용계획서_회의실예약.pdf').resolve()
body=ParagraphStyle('body',fontName='Malgun',fontSize=10,leading=16,wordWrap='CJK',textColor=HexColor('#253746'),spaceAfter=7)
head=ParagraphStyle('head',parent=body,fontName='MalgunBold',fontSize=11,leading=18,spaceBefore=9,spaceAfter=5,textColor=HexColor('#087c76'))
title=ParagraphStyle('title',parent=body,fontName='MalgunBold',fontSize=22,leading=30,spaceAfter=8)
small=ParagraphStyle('small',parent=body,fontSize=8,leading=12,textColor=HexColor('#64727b'))
story=[]
def p(t,style=body):story.append(Paragraph(t,style))
p('공공데이터 API 활용계획서',title)
p('회의실 예약시스템 개발을 위한 공휴일 데이터 파이프라인 구축',head)
p('개발계정 활용신청 첨부자료 | 작성일: 2026년 9월 29일',small)
p('1. 활용 목적 및 대상',head)
p('학생과 운영 관리자가 사용하는 회의실 예약시스템의 달력에 국내 공휴일을 표시하고, 대체공휴일·임시공휴일 등 변경 정보를 확인하기 위해 활용합니다. 이용자는 예약 날짜를 선택할 때 휴일을 확인하고, 관리자는 해당 날짜의 시설 개방·휴관 여부를 검토할 수 있습니다.')
p('2. 신청 데이터 및 활용 범위',head)
p('<b>신청 서비스:</b> 한국천문연구원_특일 정보 / 공휴일 정보 조회(getRestDeInfo)<br/><b>사용 항목:</b> 날짜(locdate), 명칭(dateName), 공휴일 여부(isHoliday)<br/><b>조회 범위:</b> 현재 연도 및 다음 연도. 공개된 휴일 정보만 조회하며 학생 이름·이메일·예약 명단은 API 요청에 포함하지 않습니다.')
p('3. 수집·처리 및 갱신 계획',head)
p('서버가 API를 호출하고 응답 형식·날짜·건수 등을 검증한 후 연도별 데이터를 데이터베이스에 저장합니다. 학생·관리자 화면은 저장된 공통 데이터를 사용하여 화면 조회마다 외부 API를 호출하지 않도록 합니다.')
p('<b>처리 흐름:</b> 공공데이터 API → 서버 수집·검증 → 연도별 저장 → 달력 표시 → 관리자 운영 검토')
p('작업 실행 기능을 켠 운영 환경에서 6시간 간격으로 두 연도를 조회할 계획입니다. 정상 정기 조회 기준 약 8회/일이며, 초기 검증·수동 조회·실패 재시도는 추가될 수 있습니다. 실제 승인된 호출 한도를 준수하고, 오류 시 마지막 정상 데이터를 유지합니다. 변경된 날짜는 관리자 검토 대상으로 안내합니다.')
p('4. 공휴일 변경 및 시설 운영 처리',head)
p('대체공휴일·임시공휴일은 제공기관 데이터에 반영된 내용을 동기화합니다. 제공 데이터의 갱신 시차가 있는 경우 관리자가 공식 발표를 확인하고 출처·사유를 기록하여 보정할 수 있도록 합니다. 공휴일 표시와 실제 시설 휴관은 구분하며, API 정보 변경만으로 기존 예약을 자동 취소하지 않습니다.')
p('5. 인증키 및 데이터 관리 계획',head)
p('인증키는 서버 환경변수에 보관하고 브라우저 코드·공개 저장소·신청 첨부자료에 포함하지 않습니다. 외부 API에는 조회 조건과 인증키만 전송하며, 공개 공휴일 데이터와 내부 회원·예약 정보를 분리하여 취급합니다. 제공기관의 이용조건과 호출 제한을 확인·준수하고 데이터 출처를 안내합니다.')
p('6. 개발 현황 및 기대 효과',head)
p('현재 예약시스템과 공휴일 연동 모듈을 로컬 환경에서 개발·검증 중이며, 인증키 발급 후 실제 API 연결을 검증할 예정입니다. 휴일 입력 누락과 일정 선택 오류를 줄이고, 운영 담당자가 변경된 휴일을 확인하여 개방·휴관 일정을 일관되게 관리하는 것을 목표로 합니다.')
p('신청 데이터 출처: 공공데이터포털 한국천문연구원_특일 정보<br/>https://www.data.go.kr/data/15012690/openapi.do',small)
def footer(c,d):
 c.setStrokeColor(HexColor('#dce5e6'));c.line(42,39,553,39);c.setFont('Malgun',8);c.setFillColor(HexColor('#64727b'));c.drawString(42,26,'회의실 예약시스템 | API 활용계획');c.drawRightString(553,26,str(d.page))
SimpleDocTemplate(str(out),pagesize=(595.28,841.89),rightMargin=42,leftMargin=42,topMargin=36,bottomMargin=49,title='공공데이터 API 활용계획서 - 회의실 예약시스템',author='').build(story,onFirstPage=footer,onLaterPages=footer)
r=PdfReader(out);print('Pages:',len(r.pages),'Bytes:',out.stat().st_size);assert len(r.pages)==1;assert out.stat().st_size<10*1024*1024
text=r.pages[0].extract_text();assert '활용계획서' in text and '6.' in text
pdf=pdfium.PdfDocument(str(out));pdf[0].render(scale=1.5).to_pil().save('tmp/pdfs/api-plan-preview.png')
