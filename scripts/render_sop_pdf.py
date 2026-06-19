from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "QMS_Precast_Onboarding_SOP.md"
OUTPUT = ROOT / "QMS_Precast_Onboarding_SOP.pdf"


def inline_markup(text: str) -> str:
    escaped = (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    return re.sub(r"`([^`]+)`", r"<font name='Courier'>\1</font>", escaped)


def build_story(lines: list[str]):
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "Title",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=26,
        textColor=colors.HexColor("#0f172a"),
        alignment=TA_LEFT,
        spaceAfter=6,
    )
    subtitle = ParagraphStyle(
        "Subtitle",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        textColor=colors.HexColor("#334155"),
        spaceAfter=10,
    )
    heading = ParagraphStyle(
        "Heading",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=17,
        textColor=colors.HexColor("#0f172a"),
        spaceBefore=8,
        spaceAfter=6,
    )
    body = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10.5,
        leading=15,
        textColor=colors.HexColor("#334155"),
        spaceAfter=6,
    )
    meta = ParagraphStyle(
        "Meta",
        parent=body,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#475569"),
        spaceAfter=3,
    )

    story = []
    bullets: list[str] = []
    numbers: list[str] = []

    def flush_bullets():
        nonlocal bullets
        if not bullets:
            return
        story.append(
            ListFlowable(
                [
                    ListItem(Paragraph(inline_markup(item), body), leftIndent=0)
                    for item in bullets
                ],
                bulletType="bullet",
                start="circle",
                leftIndent=14,
                bulletFontName="Helvetica",
                bulletFontSize=8,
            )
        )
        story.append(Spacer(1, 4))
        bullets = []

    def flush_numbers():
        nonlocal numbers
        if not numbers:
            return
        story.append(
            ListFlowable(
                [
                    ListItem(Paragraph(inline_markup(item), body), value=index + 1)
                    for index, item in enumerate(numbers)
                ],
                bulletType="1",
                leftIndent=16,
            )
        )
        story.append(Spacer(1, 4))
        numbers = []

    for raw_line in lines:
        line = raw_line.rstrip()
        stripped = line.strip()

        if stripped == "---":
            flush_bullets()
            flush_numbers()
            story.append(Spacer(1, 8))
            continue

        if not stripped:
            flush_bullets()
            flush_numbers()
            story.append(Spacer(1, 4))
            continue

        if stripped.startswith("# "):
            flush_bullets()
            flush_numbers()
            story.append(Paragraph(inline_markup(stripped[2:]), title))
            continue

        if stripped.startswith("## "):
            flush_bullets()
            flush_numbers()
            text = stripped[3:]
            if text == "New Company Onboarding Checklist":
                story.append(Paragraph(inline_markup(text), subtitle))
            else:
                story.append(Paragraph(inline_markup(text), heading))
            continue

        if stripped.startswith("- "):
            bullets.append(stripped[2:])
            continue

        number_match = re.match(r"^\d+\.\s+(.*)$", stripped)
        if number_match:
            numbers.append(number_match.group(1))
            continue

        flush_bullets()
        flush_numbers()

        if stripped.startswith("**") and stripped.endswith("**"):
            story.append(Paragraph(inline_markup(stripped.strip("*")), heading))
        elif stripped.startswith("**"):
            story.append(Paragraph(inline_markup(stripped), meta))
        else:
            story.append(Paragraph(inline_markup(stripped), body))

    flush_bullets()
    flush_numbers()
    return story


def main():
    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="QMS Precast New Company Onboarding Checklist",
        author="OpenAI Codex",
    )
    doc.build(build_story(lines))


if __name__ == "__main__":
    main()
