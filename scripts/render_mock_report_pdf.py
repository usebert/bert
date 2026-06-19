from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "QMS_Precast_Mock_Audit_Report.pdf"


def p(text, style):
    return Paragraph(text, style)


def metric_card(label, value, note, styles):
    return Table(
        [[p(label, styles["MetricLabel"])], [p(value, styles["MetricValue"])], [p(note, styles["MetricNote"])]],
        colWidths=[38 * mm],
        style=[
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
            ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#e2e8f0")),
            ("ROUNDEDCORNERS", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ],
    )


def bar(label, value, total, colour, styles):
    width = max(8, int((value / total) * 100)) if total else 0
    return Table(
        [
            [p(label, styles["BodyBold"]), p(str(value), styles["Right"])],
            [
                Table(
                    [[""]],
                    colWidths=[width * 1.2 * mm],
                    rowHeights=[5 * mm],
                    style=[("BACKGROUND", (0, 0), (-1, -1), colour)],
                ),
                "",
            ],
        ],
        colWidths=[92 * mm, 20 * mm],
        style=[
            ("SPAN", (0, 1), (1, 1)),
            ("BACKGROUND", (0, 1), (1, 1), colors.HexColor("#f1f5f9")),
            ("BOX", (0, 1), (1, 1), 0.5, colors.HexColor("#e2e8f0")),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ],
    )


def build_story():
    base = getSampleStyleSheet()
    styles = {
        "Title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=24,
            leading=29,
            textColor=colors.HexColor("#0f172a"),
            alignment=TA_LEFT,
        ),
        "Subtitle": ParagraphStyle(
            "Subtitle",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=15,
            textColor=colors.HexColor("#64748b"),
        ),
        "Heading": ParagraphStyle(
            "Heading",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=14,
            leading=18,
            textColor=colors.HexColor("#0f172a"),
            spaceBefore=12,
            spaceAfter=8,
        ),
        "Body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            textColor=colors.HexColor("#334155"),
        ),
        "BodyBold": ParagraphStyle(
            "BodyBold",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=14,
            textColor=colors.HexColor("#334155"),
        ),
        "Right": ParagraphStyle(
            "Right",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=14,
            textColor=colors.HexColor("#334155"),
            alignment=TA_CENTER,
        ),
        "MetricLabel": ParagraphStyle(
            "MetricLabel",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            textColor=colors.HexColor("#64748b"),
        ),
        "MetricValue": ParagraphStyle(
            "MetricValue",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=20,
            leading=24,
            textColor=colors.HexColor("#0f172a"),
        ),
        "MetricNote": ParagraphStyle(
            "MetricNote",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=10,
            textColor=colors.HexColor("#64748b"),
        ),
    }

    story = [
        p("QMS Precast Audit Report", styles["Title"]),
        p("Mock executive report | Demo Test App | Generated 23 Apr 2026, 13:45", styles["Subtitle"]),
        Spacer(1, 8),
        Table(
            [
                [
                    metric_card("Live Compliance", "87%", "Up 6% vs previous run", styles),
                    metric_card("Open Actions", "4", "2 overdue, 1 in progress", styles),
                    metric_card("Overdue Audits", "1", "Requires manager review", styles),
                    metric_card("Evidence Items", "12", "Photos, notes, signatures", styles),
                ]
            ],
            colWidths=[40 * mm, 40 * mm, 40 * mm, 40 * mm],
        ),
        Spacer(1, 10),
        p("Executive Summary", styles["Heading"]),
        p(
            "The site is operating at a strong compliance level with one overdue audit and four open corrective actions. Evidence capture is active and audit sign-off is being recorded through the tablet workflow.",
            styles["Body"],
        ),
        p("Traffic Light Breakdown", styles["Heading"]),
        bar("Green - more than 2 hours remaining", 8, 12, colors.HexColor("#10b981"), styles),
        bar("Amber - less than 2 hours remaining", 3, 12, colors.HexColor("#f59e0b"), styles),
        bar("Red - overdue", 1, 12, colors.HexColor("#e11d48"), styles),
        p("Corrective Action Status", styles["Heading"]),
        bar("Open", 2, 4, colors.HexColor("#e11d48"), styles),
        bar("In progress", 1, 4, colors.HexColor("#f59e0b"), styles),
        bar("Closed", 1, 4, colors.HexColor("#10b981"), styles),
        p("Completion Trend", styles["Heading"]),
        Table(
            [
                ["Week", "Compliance", "Completed", "Missed", "Evidence"],
                ["W/C 01 Apr", "74%", "18", "5", "7"],
                ["W/C 08 Apr", "81%", "21", "3", "9"],
                ["W/C 15 Apr", "87%", "24", "1", "12"],
            ],
            colWidths=[34 * mm, 30 * mm, 30 * mm, 30 * mm, 30 * mm],
            style=[
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ],
        ),
        p("Priority Actions", styles["Heading"]),
        Table(
            [
                ["Action", "Owner", "Severity", "Due", "Evidence"],
                ["Damaged PPE found in use", "James Cole", "NC", "24h", "2 photos"],
                ["Blocked walkway near bay 4", "Amira Khan", "Fail", "Immediate", "3 photos"],
                ["Expired inspection tag", "James Cole", "NC", "24h", "1 photo"],
            ],
            colWidths=[50 * mm, 28 * mm, 24 * mm, 28 * mm, 28 * mm],
            style=[
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ],
        ),
        p("Sign-Off", styles["Heading"]),
        p("Prepared for QMS Precast show demonstration. Inspector signatures, photo evidence, and corrective action ownership are included in the live audit workflow.", styles["Body"]),
    ]

    return story


def main():
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="QMS Precast Mock Audit Report",
        author="OpenAI Codex",
    )
    doc.build(build_story())


if __name__ == "__main__":
    main()
