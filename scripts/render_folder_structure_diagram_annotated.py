from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PNG_PATH = ROOT / "QMS_Folder_Structure_Diagram_Annotated.png"

WIDTH = 1900
HEIGHT = 1460
BG = "#F4F7FA"
NAVY = "#0F172A"
SLATE = "#475569"
MUTED = "#64748B"
LINE = "#94A3B8"
WHITE = "#FFFFFF"
BLUE = "#DBEAFE"
GREEN = "#DCFCE7"
AMBER = "#FEF3C7"
LILAC = "#F3E8FF"
TEAL = "#CCFBF1"
DOC = "#E2E8F0"


def font(size: int, bold: bool = False):
    preferred = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    ]
    for path in preferred:
        try:
            return ImageFont.truetype(path, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


TITLE_FONT = font(34, True)
SECTION_FONT = font(22, True)
LABEL_FONT = font(18, True)
TEXT_FONT = font(15, False)
SMALL_FONT = font(13, False)
TAG_FONT = font(12, True)


def draw_text(draw, pos, text, fill, use_font):
    draw.text(pos, text, fill=fill, font=use_font)


def tag(draw, x, y, label, fill):
    bbox = draw.textbbox((0, 0), label, font=TAG_FONT)
    w = bbox[2] - bbox[0] + 20
    h = 24
    draw.rounded_rectangle((x, y, x + w, y + h), radius=12, fill=fill, outline=None)
    draw.text((x + 10, y + 5), label, fill=NAVY, font=TAG_FONT)


def item_box(draw, x1, y1, x2, y2, title, item_type, fill, lines=None):
    draw.rounded_rectangle((x1, y1, x2, y2), radius=16, fill=fill, outline=LINE, width=2)
    draw.text((x1 + 16, y1 + 14), title, fill=NAVY, font=LABEL_FONT)
    type_color = {
        "Folder": GREEN,
        "Google Form": BLUE,
        "Google Sheet": AMBER,
        "Google Doc / PDF": DOC,
    }.get(item_type, DOC)
    tag(draw, x2 - 160, y1 + 12, item_type, type_color)
    if lines:
        cy = y1 + 48
        for line in lines:
            draw.text((x1 + 16, cy), line, fill=SLATE, font=TEXT_FONT)
            cy += 20


def connect(draw, start, end):
    sx, sy = start
    ex, ey = end
    mid_y = (sy + ey) / 2
    draw.line((sx, sy, sx, mid_y), fill=LINE, width=3)
    draw.line((sx, mid_y, ex, mid_y), fill=LINE, width=3)
    draw.line((ex, mid_y, ex, ey), fill=LINE, width=3)
    draw.polygon([(ex, ey), (ex - 8, ey - 8), (ex + 8, ey - 8)], fill=LINE)


def main():
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)

    draw.text((60, 40), "QMS Precast Folder Structure", fill=NAVY, font=TITLE_FONT)
    draw.text(
        (60, 88),
        "Annotated view showing what is a folder, Google Form, Google Sheet, and supporting document",
        fill=SLATE,
        font=TEXT_FONT,
    )

    tag(draw, 60, 125, "Folder", GREEN)
    tag(draw, 160, 125, "Google Form", BLUE)
    tag(draw, 300, 125, "Google Sheet", AMBER)
    tag(draw, 440, 125, "Google Doc / PDF", DOC)

    item_box(draw, 720, 170, 1180, 255, "QMS Precast Root", "Folder", NAVY, ["Main Google Drive root folder"])

    item_box(draw, 100, 330, 560, 490, "00 Master Control", "Folder", WHITE, [
        "Central setup area",
        "Holds template and master onboarding files",
    ])
    item_box(draw, 720, 330, 1180, 490, "01 Live Companies", "Folder", WHITE, [
        "Contains one folder per live company",
        "Main onboarding destination",
    ])
    item_box(draw, 1340, 330, 1800, 490, "99 Archive", "Folder", WHITE, [
        "Inactive or historic companies",
        "Old exports and superseded items",
    ])

    connect(draw, (950, 255), (330, 330))
    connect(draw, (950, 255), (950, 330))
    connect(draw, (950, 255), (1570, 330))

    draw.text((60, 560), "Master Control Contents", fill=NAVY, font=SECTION_FONT)
    draw.text((980, 560), "Live Company Folder Example", fill=NAVY, font=SECTION_FONT)

    left_x = 60
    right_x = 980
    box_w = 820
    row_h = 92
    gap = 18

    left_items = [
        ("QMS Company Onboarding Form", "Google Form", BLUE, ["Master form for new company setup"]),
        ("QMS Company Onboarding Responses", "Google Sheet", AMBER, ["Master response sheet for onboarding submissions"]),
        ("Company Template - COPY ME", "Folder", GREEN, ["Blank folder copied for each new company"]),
        ("Naming Standards", "Google Doc / PDF", DOC, ["Reference guide for naming files and folders"]),
    ]

    y = 610
    for i, (title, kind, fill, lines) in enumerate(left_items):
        top = y + i * (row_h + gap)
        item_box(draw, left_x, top, left_x + box_w, top + row_h, title, kind, fill, lines)

    right_items = [
        ("QMS - Company Name", "Folder", GREEN, ["One folder per live company"]),
        ("01 Onboarding", "Folder", GREEN, ["Company onboarding records and contacts"]),
        ("02 Audit Forms", "Folder", GREEN, ["All audit Google Forms for that company"]),
        ("03 Response Sheets", "Folder", GREEN, ["Response sheets used for company data capture"]),
        ("04 Evidence", "Folder", GREEN, ["Photos, attachments, supporting evidence"]),
        ("05 Exports", "Folder", GREEN, ["PDF exports, reports, client packs"]),
        ("06 Admin Notes", "Folder", GREEN, ["Setup notes, change log, admin records"]),
    ]

    y = 610
    for i, (title, kind, fill, lines) in enumerate(right_items):
        top = y + i * (row_h + gap)
        item_box(draw, right_x, top, right_x + box_w, top + row_h, title, kind, fill, lines)

    draw.text((60, 1060), "Inside The Company Folder", fill=NAVY, font=SECTION_FONT)

    bottom_items = [
        ("Company Onboarding Record", "Google Doc / PDF", DOC, "Stored in 01 Onboarding"),
        ("Company Contacts", "Google Doc / PDF", DOC, "Stored in 01 Onboarding"),
        ("HS Audit - General", "Google Form", BLUE, "Stored in 02 Audit Forms"),
        ("HS Audit - PPE", "Google Form", BLUE, "Stored in 02 Audit Forms"),
        ("HS Audit - Housekeeping", "Google Form", BLUE, "Stored in 02 Audit Forms"),
        ("HS Audit - Equipment", "Google Form", BLUE, "Stored in 02 Audit Forms"),
        ("Audit Responses", "Google Sheet", AMBER, "Stored in 03 Response Sheets"),
    ]

    col1_x = 60
    col2_x = 980
    row_y = 1110
    mini_h = 74
    mini_w = 820
    for idx, (title, kind, fill, sub) in enumerate(bottom_items):
        x = col1_x if idx < 4 else col2_x
        y_pos = row_y + (idx % 4) * (mini_h + 16)
        item_box(draw, x, y_pos, x + mini_w, y_pos + mini_h, title, kind, fill, [sub])

    image.save(PNG_PATH)


if __name__ == "__main__":
    main()
