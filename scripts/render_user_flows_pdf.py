from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
PAGE1_PNG = ROOT / "QMS_User_Flow_Swimlane.png"
PAGE2_PNG = ROOT / "QMS_User_Flow_Onboarding.png"
OUTPUT_PDF = ROOT / "QMS_User_Flows.pdf"

WIDTH = 1920
HEIGHT = 1200
BG = "#F8FAFC"
NAVY = "#0F172A"
SLATE = "#475569"
LINE = "#94A3B8"
WHITE = "#FFFFFF"
MASTER = "#DBEAFE"
ADMIN = "#E0F2FE"
MANAGER = "#DCFCE7"
AUDITOR = "#FEF3C7"
MAIN = "#E2E8F0"


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


TITLE_FONT = font(44, bold=True)
SUBTITLE_FONT = font(22)
LANE_FONT = font(24, bold=True)
BOX_FONT = font(18, bold=True)
TEXT_FONT = font(16)


def draw_wrapped_text(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, fill: str, title: bool = False):
    x1, y1, x2, y2 = box
    target_font = BOX_FONT if title else TEXT_FONT
    words = text.split()
    lines: list[str] = []
    current = ""
    max_width = x2 - x1 - 24
    for word in words:
        trial = f"{current} {word}".strip()
        w = draw.textbbox((0, 0), trial, font=target_font)[2]
        if w <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)

    line_height = 24 if title else 20
    total_h = len(lines) * line_height
    start_y = y1 + (y2 - y1 - total_h) // 2
    for idx, line in enumerate(lines):
        tw = draw.textbbox((0, 0), line, font=target_font)[2]
        tx = x1 + (x2 - x1 - tw) // 2
        ty = start_y + idx * line_height
        draw.text((tx, ty), line, fill=fill, font=target_font)


def rounded_box(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str, outline: str, text: str):
    draw.rounded_rectangle(box, radius=18, fill=fill, outline=outline, width=2)
    draw_wrapped_text(draw, box, text, NAVY, title=True)


def arrow(draw: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int]):
    sx, sy = start
    ex, ey = end
    draw.line((sx, sy, ex, ey), fill=LINE, width=4)
    head = 10
    if abs(ex - sx) >= abs(ey - sy):
        if ex >= sx:
            pts = [(ex, ey), (ex - head, ey - head), (ex - head, ey + head)]
        else:
            pts = [(ex, ey), (ex + head, ey - head), (ex + head, ey + head)]
    else:
        if ey >= sy:
            pts = [(ex, ey), (ex - head, ey - head), (ex + head, ey - head)]
        else:
            pts = [(ex, ey), (ex - head, ey + head), (ex + head, ey + head)]
    draw.polygon(pts, fill=LINE)


def build_swimlane_png():
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)

    draw.text((60, 40), "QMS Precast - Role-Based User Flow", fill=NAVY, font=TITLE_FONT)
    draw.text((60, 98), "Swimlane journey from sign-in to operational outcomes", fill=SLATE, font=SUBTITLE_FONT)

    lane_top = 180
    lane_h = 220
    lane_gap = 20
    lane_x1 = 60
    lane_x2 = WIDTH - 60
    lane_defs = [
        ("Master", MASTER),
        ("Admin", ADMIN),
        ("Manager", MANAGER),
        ("Auditor", AUDITOR),
    ]

    for idx, (label, color) in enumerate(lane_defs):
        y1 = lane_top + idx * (lane_h + lane_gap)
        y2 = y1 + lane_h
        draw.rounded_rectangle((lane_x1, y1, lane_x2, y2), radius=24, fill=color, outline="#CBD5E1", width=2)
        draw.text((80, y1 + 14), label, fill=NAVY, font=LANE_FONT)

    start = (80, 120, 280, 165)
    rounded_box(draw, start, WHITE, "#94A3B8", "Sign in")
    role_gate = (320, 120, 540, 165)
    rounded_box(draw, role_gate, WHITE, "#94A3B8", "Role check")
    arrow(draw, (280, 142), (320, 142))

    # Master row
    m_y = lane_top + 80
    m1 = (300, m_y, 520, m_y + 82)
    m2 = (580, m_y, 800, m_y + 82)
    m3 = (860, m_y, 1080, m_y + 82)
    m4 = (1140, m_y, 1360, m_y + 82)
    for b, t in [
        (m1, "Dashboard"),
        (m2, "Admin / Onboarding"),
        (m3, "Setup workspace"),
        (m4, "Manage users/templates/schedules"),
    ]:
        rounded_box(draw, b, WHITE, "#94A3B8", t)
    arrow(draw, (540, 142), (300, m_y + 40))
    arrow(draw, (520, m_y + 41), (580, m_y + 41))
    arrow(draw, (800, m_y + 41), (860, m_y + 41))
    arrow(draw, (1080, m_y + 41), (1140, m_y + 41))

    # Admin row
    a_y = lane_top + (lane_h + lane_gap) + 80
    a1 = (300, a_y, 520, a_y + 82)
    a2 = (580, a_y, 800, a_y + 82)
    a3 = (860, a_y, 1080, a_y + 82)
    rounded_box(draw, a1, WHITE, "#94A3B8", "Dashboard")
    rounded_box(draw, a2, WHITE, "#94A3B8", "Admin workspace")
    rounded_box(draw, a3, WHITE, "#94A3B8", "Reports / Sync / Actions")
    arrow(draw, (540, 142), (300, a_y + 40))
    arrow(draw, (520, a_y + 41), (580, a_y + 41))
    arrow(draw, (800, a_y + 41), (860, a_y + 41))

    # Manager row
    g_y = lane_top + 2 * (lane_h + lane_gap) + 80
    g1 = (300, g_y, 520, g_y + 82)
    g2 = (580, g_y, 800, g_y + 82)
    g3 = (860, g_y, 1080, g_y + 82)
    g4 = (1140, g_y, 1360, g_y + 82)
    rounded_box(draw, g1, WHITE, "#94A3B8", "Dashboard")
    rounded_box(draw, g2, WHITE, "#94A3B8", "Manager alerts")
    rounded_box(draw, g3, WHITE, "#94A3B8", "Assign / verify actions")
    rounded_box(draw, g4, WHITE, "#94A3B8", "Closeout + reporting")
    arrow(draw, (540, 142), (300, g_y + 40))
    arrow(draw, (520, g_y + 41), (580, g_y + 41))
    arrow(draw, (800, g_y + 41), (860, g_y + 41))
    arrow(draw, (1080, g_y + 41), (1140, g_y + 41))

    # Auditor row
    u_y = lane_top + 3 * (lane_h + lane_gap) + 70
    u1 = (260, u_y, 440, u_y + 74)
    u2 = (480, u_y, 660, u_y + 74)
    u3 = (700, u_y, 880, u_y + 74)
    u4 = (920, u_y, 1100, u_y + 74)
    u5 = (1140, u_y, 1320, u_y + 74)
    u6 = (1360, u_y, 1540, u_y + 74)
    for b, t in [
        (u1, "Open audit"),
        (u2, "Answer + evidence"),
        (u3, "Submit"),
        (u4, "Offline queue?"),
        (u5, "Sync"),
        (u6, "Completion summary"),
    ]:
        rounded_box(draw, b, WHITE, "#94A3B8", t)
    arrow(draw, (540, 142), (260, u_y + 36))
    arrow(draw, (440, u_y + 37), (480, u_y + 37))
    arrow(draw, (660, u_y + 37), (700, u_y + 37))
    arrow(draw, (880, u_y + 37), (920, u_y + 37))
    arrow(draw, (1100, u_y + 37), (1140, u_y + 37))
    arrow(draw, (1320, u_y + 37), (1360, u_y + 37))

    note = (1580, u_y, 1840, u_y + 170)
    draw.rounded_rectangle(note, radius=16, fill=WHITE, outline="#CBD5E1", width=2)
    draw_wrapped_text(
        draw,
        note,
        "If more audits exist: start next audit. Otherwise return to dashboard.",
        SLATE,
        title=False,
    )

    image.save(PAGE1_PNG)


def build_onboarding_png():
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)

    draw.text((60, 40), "QMS Precast - Onboarding-First Operational Flow", fill=NAVY, font=TITLE_FONT)
    draw.text((60, 98), "From workspace setup to steady-state audits, actions, sync, and reporting", fill=SLATE, font=SUBTITLE_FONT)

    col1_x = 120
    col2_x = 620
    col3_x = 1120
    box_w = 360
    box_h = 88
    ys = [190, 320, 450, 580, 710, 840, 970]

    steps = [
        (col1_x, ys[0], "Master sign in"),
        (col1_x, ys[1], "Open Onboarding / Admin"),
        (col1_x, ys[2], "Connect Google Workspace"),
        (col1_x, ys[3], "Configure onboarding source"),
        (col2_x, ys[1], "Create/link company folders"),
        (col2_x, ys[2], "Verify forms + response sheet"),
        (col2_x, ys[3], "Workspace validation"),
        (col2_x, ys[4], "Create templates + schedules"),
        (col2_x, ys[5], "Invite users by role"),
        (col3_x, ys[2], "Auditors complete audits"),
        (col3_x, ys[3], "Auto-create actions for NC"),
        (col3_x, ys[4], "Manager/Admin close actions"),
        (col3_x, ys[5], "Sync Centre status"),
        (col3_x, ys[6], "Reports + exports"),
    ]

    rects: dict[str, tuple[int, int, int, int]] = {}
    for x, y, label in steps:
        box = (x, y, x + box_w, y + box_h)
        rects[label] = box
        rounded_box(draw, box, WHITE, "#94A3B8", label)

    def mid_right(name: str):
        x1, y1, x2, y2 = rects[name]
        return (x2, (y1 + y2) // 2)

    def mid_left(name: str):
        x1, y1, x2, y2 = rects[name]
        return (x1, (y1 + y2) // 2)

    def mid_bottom(name: str):
        x1, y1, x2, y2 = rects[name]
        return ((x1 + x2) // 2, y2)

    def mid_top(name: str):
        x1, y1, x2, y2 = rects[name]
        return ((x1 + x2) // 2, y1)

    arrow(draw, mid_bottom("Master sign in"), mid_top("Open Onboarding / Admin"))
    arrow(draw, mid_bottom("Open Onboarding / Admin"), mid_top("Connect Google Workspace"))
    arrow(draw, mid_bottom("Connect Google Workspace"), mid_top("Configure onboarding source"))
    arrow(draw, mid_right("Open Onboarding / Admin"), mid_left("Create/link company folders"))
    arrow(draw, mid_bottom("Create/link company folders"), mid_top("Verify forms + response sheet"))
    arrow(draw, mid_bottom("Verify forms + response sheet"), mid_top("Workspace validation"))
    arrow(draw, mid_bottom("Workspace validation"), mid_top("Create templates + schedules"))
    arrow(draw, mid_bottom("Create templates + schedules"), mid_top("Invite users by role"))
    arrow(draw, mid_right("Verify forms + response sheet"), mid_left("Auditors complete audits"))
    arrow(draw, mid_bottom("Auditors complete audits"), mid_top("Auto-create actions for NC"))
    arrow(draw, mid_bottom("Auto-create actions for NC"), mid_top("Manager/Admin close actions"))
    arrow(draw, mid_bottom("Manager/Admin close actions"), mid_top("Sync Centre status"))
    arrow(draw, mid_bottom("Sync Centre status"), mid_top("Reports + exports"))

    steady = (620, 980, 1300, 1120)
    draw.rounded_rectangle(steady, radius=20, fill=MAIN, outline="#94A3B8", width=2)
    draw_wrapped_text(draw, steady, "Steady-state operations: monitor KPIs, run recurring audits, close actions, export reports", NAVY, title=False)
    arrow(draw, mid_left("Reports + exports"), (1300, 1050))

    image.save(PAGE2_PNG)


def build_pdf():
    page_w, page_h = landscape(A4)
    c = canvas.Canvas(str(OUTPUT_PDF), pagesize=landscape(A4))
    for png_path in [PAGE1_PNG, PAGE2_PNG]:
        image = ImageReader(str(png_path))
        img_w, img_h = Image.open(png_path).size
        scale = min(page_w / img_w, page_h / img_h)
        draw_w = img_w * scale
        draw_h = img_h * scale
        x = (page_w - draw_w) / 2
        y = (page_h - draw_h) / 2
        c.drawImage(image, x, y, width=draw_w, height=draw_h)
        c.showPage()
    c.save()


if __name__ == "__main__":
    build_swimlane_png()
    build_onboarding_png()
    build_pdf()
