from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
PNG_PATH = ROOT / "QMS_Folder_Structure_Diagram.png"
PDF_PATH = ROOT / "QMS_Folder_Structure_Diagram.pdf"

WIDTH = 1800
HEIGHT = 1260
BG = "#F4F7FA"
NAVY = "#0F172A"
SLATE = "#475569"
LINE = "#94A3B8"
WHITE = "#FFFFFF"
BLUE = "#DCEEFF"
GREEN = "#DCFCE7"
AMBER = "#FEF3C7"


def font(size: int, bold: bool = False):
    preferred = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
        "/System/Library/Fonts/SFNS.ttf",
    ]
    for path in preferred:
        try:
            return ImageFont.truetype(path, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


TITLE_FONT = font(34, bold=True)
SECTION_FONT = font(20, bold=True)
LABEL_FONT = font(17, bold=True)
TEXT_FONT = font(15)
SMALL_FONT = font(13)


def center_box(draw, xy, fill, outline, title, subtitle=None):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=20, fill=fill, outline=outline, width=2)
    tw = draw.textbbox((0, 0), title, font=LABEL_FONT)
    title_w = tw[2] - tw[0]
    draw.text((x1 + (x2 - x1 - title_w) / 2, y1 + 16), title, fill=NAVY, font=LABEL_FONT)
    if subtitle:
      lines = subtitle.split("\n")
      current_y = y1 + 48
      for line in lines:
        bbox = draw.textbbox((0, 0), line, font=SMALL_FONT)
        line_w = bbox[2] - bbox[0]
        draw.text((x1 + (x2 - x1 - line_w) / 2, current_y), line, fill=SLATE, font=SMALL_FONT)
        current_y += 18


def left_box(draw, xy, fill, outline, title, lines=None):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=16, fill=fill, outline=outline, width=2)
    draw.text((x1 + 16, y1 + 14), title, fill=NAVY, font=LABEL_FONT)
    if lines:
        current_y = y1 + 44
        for line in lines:
            draw.text((x1 + 16, current_y), line, fill=SLATE, font=TEXT_FONT)
            current_y += 22


def connect(draw, start, end):
    sx, sy = start
    ex, ey = end
    mid_y = (sy + ey) / 2
    draw.line((sx, sy, sx, mid_y), fill=LINE, width=3)
    draw.line((sx, mid_y, ex, mid_y), fill=LINE, width=3)
    draw.line((ex, mid_y, ex, ey), fill=LINE, width=3)
    arrow = 8
    draw.polygon([(ex, ey), (ex - arrow, ey - arrow), (ex + arrow, ey - arrow)], fill=LINE)


def build_png():
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)

    draw.text((60, 40), "QMS Precast Folder Structure", fill=NAVY, font=TITLE_FONT)
    draw.text(
        (60, 88),
        "Standard template for onboarding and maintaining each company inside the Google Drive root folder",
        fill=SLATE,
        font=TEXT_FONT,
    )

    root = (690, 120, 1110, 215)
    center_box(draw, root, NAVY, NAVY, "QMS Precast Root", "Google Drive root folder")

    master = (80, 290, 520, 470)
    live = (680, 290, 1120, 470)
    archive = (1280, 290, 1720, 470)
    left_box(
        draw,
        master,
        BLUE,
        "#93C5FD",
        "00 Master Control",
        [
            "QMS Company Onboarding Form",
            "QMS Company Onboarding Responses",
            "Company Template - COPY ME",
            "Naming Standards",
        ],
    )
    left_box(
        draw,
        live,
        GREEN,
        "#86EFAC",
        "01 Live Companies",
        [
            "QMS - Company Name A",
            "QMS - Company Name B",
            "QMS - Company Name C",
        ],
    )
    left_box(
        draw,
        archive,
        AMBER,
        "#FCD34D",
        "99 Archive",
        [
            "Inactive companies",
            "Historic exports",
            "Superseded folders",
        ],
    )

    connect(draw, (900, 215), (300, 290))
    connect(draw, (900, 215), (900, 290))
    connect(draw, (900, 215), (1500, 290))

    template_title = "Company Template - COPY ME"
    draw.text((60, 560), template_title, fill=NAVY, font=SECTION_FONT)
    draw.text((60, 592), "Duplicate this folder for each new company, then rename it.", fill=SLATE, font=TEXT_FONT)

    company_title = "Live Company Folder Example"
    draw.text((930, 560), company_title, fill=NAVY, font=SECTION_FONT)
    draw.text((930, 592), "Each onboarded company keeps its own forms, sheet, evidence, and notes.", fill=SLATE, font=TEXT_FONT)

    left_column_x = 60
    right_column_x = 930
    box_w = 760
    box_h = 78
    gap = 18
    y = 650

    template_boxes = [
        ("01 Onboarding", ["Company Onboarding Record", "Company Contacts"]),
        ("02 Audit Forms", ["HS Audit - General", "HS Audit - PPE", "HS Audit - Housekeeping", "HS Audit - Equipment"]),
        ("03 Response Sheets", ["Audit Responses"]),
        ("04 Evidence", ["Photos, attachments, supporting evidence"]),
        ("05 Exports", ["Reports, client exports, snapshots"]),
        ("06 Admin Notes", ["Setup notes, exceptions, account changes"]),
    ]

    live_boxes = [
        ("01 Onboarding", ["Acme Precast - Onboarding Record", "Acme Precast - Contacts"]),
        ("02 Audit Forms", ["HS Audit - General", "HS Audit - PPE", "HS Audit - Housekeeping", "HS Audit - Equipment"]),
        ("03 Response Sheets", ["Acme Precast - Audit Responses"]),
        ("04 Evidence", ["Site photos and uploaded evidence"]),
        ("05 Exports", ["Exports for client and internal reporting"]),
        ("06 Admin Notes", ["Audit schedule notes and admin changes"]),
    ]

    for index, (title, lines) in enumerate(template_boxes):
        top = y + index * (box_h + gap)
        left_box(draw, (left_column_x, top, left_column_x + box_w, top + box_h), WHITE, "#CBD5E1", title, lines[:2])

    for index, (title, lines) in enumerate(live_boxes):
        top = y + index * (box_h + gap)
        left_box(draw, (right_column_x, top, right_column_x + box_w, top + box_h), WHITE, "#CBD5E1", title, lines[:2])

    image.save(PNG_PATH)


def build_pdf():
    page_w, page_h = landscape(A4)
    c = canvas.Canvas(str(PDF_PATH), pagesize=landscape(A4))
    image = ImageReader(str(PNG_PATH))
    img_w, img_h = Image.open(PNG_PATH).size
    scale = min(page_w / img_w, page_h / img_h)
    draw_w = img_w * scale
    draw_h = img_h * scale
    x = (page_w - draw_w) / 2
    y = (page_h - draw_h) / 2
    c.drawImage(image, x, y, width=draw_w, height=draw_h)
    c.showPage()
    c.save()


if __name__ == "__main__":
    build_png()
    build_pdf()
