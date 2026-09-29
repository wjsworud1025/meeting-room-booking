"""Embed existing mockups into an offline, shareable HTML planning document."""
from pathlib import Path
import base64

source = Path(__file__).resolve().parent
project = source.parent.parent
images = {
    "STUDENT": "01-학생-전체시간표.png",
    "MOBILE": "02-모바일-예약신청.png",
    "CLOSURE": "03-관리자-휴관설정-v1.1.png",
    "INVITE": "04-관리자-계정목록-초대.png",
    "REVOKE": "05-관리자-권한회수-재인증.png",
}
html = (source / "template.html").read_text(encoding="utf-8")
for key, filename in images.items():
    encoded = base64.b64encode((project / "목업-UI" / filename).read_bytes()).decode("ascii")
    html = html.replace(f"@@IMG_{key}@@", "data:image/png;base64," + encoded)
assert "@@IMG_" not in html
output = source.parent / "회의실-예약시스템-시각기획안.html"
output.write_text(html, encoding="utf-8")
print(f"Created: {output} ({output.stat().st_size:,} bytes)")
