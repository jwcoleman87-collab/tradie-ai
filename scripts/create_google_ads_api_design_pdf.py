from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "tradie-ai-google-ads-api-design.pdf"

BLUE = colors.HexColor("#1689F5")
DARK = colors.HexColor("#14213D")
INK = colors.HexColor("#263247")
MUTED = colors.HexColor("#637083")
PALE = colors.HexColor("#EEF6FF")
LINE = colors.HexColor("#D9E3EF")
GREEN = colors.HexColor("#1B8A5A")


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="DocTitle",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=25,
    leading=30,
    textColor=DARK,
    alignment=TA_LEFT,
    spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="Subtitle",
    parent=styles["Normal"],
    fontName="Helvetica",
    fontSize=11,
    leading=16,
    textColor=MUTED,
    spaceAfter=14,
))
styles.add(ParagraphStyle(
    name="Section",
    parent=styles["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=16,
    leading=20,
    textColor=DARK,
    spaceBefore=12,
    spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="Subsection",
    parent=styles["Heading3"],
    fontName="Helvetica-Bold",
    fontSize=11.5,
    leading=15,
    textColor=DARK,
    spaceBefore=8,
    spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="Body",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=9.5,
    leading=14,
    textColor=INK,
    spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="Small",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=8,
    leading=11,
    textColor=MUTED,
))
styles.add(ParagraphStyle(
    name="Callout",
    parent=styles["BodyText"],
    fontName="Helvetica-Bold",
    fontSize=10,
    leading=14,
    textColor=GREEN,
    alignment=TA_CENTER,
))


def p(text, style="Body"):
    return Paragraph(text, styles[style])


def bullet(text):
    return Paragraph(f"<bullet>&bull;</bullet>{text}", ParagraphStyle(
        name="InlineBullet",
        parent=styles["Body"],
        leftIndent=12,
        firstLineIndent=-8,
        bulletIndent=0,
        spaceAfter=4,
    ))


def info_table(rows, widths):
    header_style = ParagraphStyle(
        name="TableHeader",
        parent=styles["Small"],
        fontName="Helvetica-Bold",
        fontSize=8.3,
        leading=10.5,
        textColor=colors.white,
    )
    cell_style = ParagraphStyle(
        name="TableCell",
        parent=styles["Small"],
        fontName="Helvetica",
        fontSize=8.3,
        leading=10.5,
        textColor=INK,
    )
    wrapped_rows = [
        [Paragraph(str(value), header_style if row_index == 0 else cell_style) for value in row]
        for row_index, row in enumerate(rows)
    ]
    table = Table(wrapped_rows, colWidths=widths, hAlign="LEFT", repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.3),
        ("LEADING", (0, 0), (-1, -1), 11),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFD")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, height - 13 * mm, width - 18 * mm, height - 13 * mm)
    canvas.setFillColor(DARK)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(18 * mm, height - 10 * mm, "TRADIE AI")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(width - 18 * mm, height - 10 * mm, "Google Ads API Tool Design")
    canvas.line(18 * mm, 13 * mm, width - 18 * mm, 13 * mm)
    canvas.drawString(18 * mm, 9 * mm, "GreenVac - confidential application documentation")
    canvas.drawRightString(width - 18 * mm, 9 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=20 * mm,
        bottomMargin=19 * mm,
        title="Tradie AI Google Ads API Tool Design",
        author="GreenVac",
        subject="Google Ads API Basic Access application documentation",
    )

    story = []
    story += [
        Spacer(1, 13 * mm),
        p("Google Ads API Tool Design", "DocTitle"),
        p("Tradie AI - GreenVac owner-operated business assistant", "Subtitle"),
        Table([[p("READ-ONLY REPORTING", "Callout")]], colWidths=[78 * mm], style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), PALE),
            ("BOX", (0, 0), (-1, -1), 1, BLUE),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ])),
        Spacer(1, 8 * mm),
        p("Purpose", "Section"),
        p("This document describes the Google Ads API feature within Tradie AI. The feature is an internal tool for GreenVac's owner. It connects an authorized Google Ads account and displays a fixed last-30-days campaign performance report. It does not create or edit advertisements, campaigns, keywords, audiences, bids, budgets, billing, conversion actions, or account access."),
        p("Application details", "Section"),
        info_table([
            ["Item", "Value"],
            ["API applicant", "GreenVac"],
            ["Primary website", "https://www.greenvac.com.au/"],
            ["API tool", "Tradie AI"],
            ["Audience", "Internal owner/operator only"],
            ["Google Ads manager account", "Tradie AI Manager - 644-561-3241"],
            ["Google Cloud project", "tradie-ai-507211 - project number 834544866435"],
            ["OAuth permission", "https://www.googleapis.com/auth/adwords"],
        ], [50 * mm, 120 * mm]),
        Spacer(1, 8 * mm),
        p("Executive summary", "Section"),
        bullet("The Google Ads API is used only after an authenticated Tradie AI workspace owner initiates OAuth and selects an account they are authorized to access."),
        bullet("The server executes one controlled GAQL query covering the previous 30 days and limits the response to 100 campaign rows."),
        bullet("Campaign data is shown inside the owner's private workspace and is not resold, shared with unrelated customers, or used to build advertising profiles."),
        bullet("No write-capable Google Ads endpoint is implemented in this release."),
        PageBreak(),
        Spacer(1, 13 * mm),
    ]

    story += [
        p("1. Business model and intended audience", "Section"),
        p("GreenVac is an Australian trade-services business. Tradie AI is a privately hosted business-assistant application built to help the owner organise day-to-day work across finance, marketing, social media, maintenance, website tasks, calendar activity, and advertising reporting."),
        p("The current Google Ads integration is not a public advertising management product, agency tool, lead-generation marketplace, or data brokerage service. Access is limited to the owner account approved in the Tradie AI workspace. GreenVac does not charge third parties for access to Google Ads API data."),
        p("2. User journey", "Section"),
        info_table([
            ["Step", "User-visible action", "System behaviour"],
            ["1", "Owner signs in to the private Tradie AI workspace.", "Supabase Auth validates the user and row-level security limits data to that workspace."],
            ["2", "Owner selects Connect Google Ads in Settings.", "Server creates a short-lived OAuth state value tied to the signed-in user and workspace."],
            ["3", "Google presents its consent screen.", "OAuth requests the Google Ads scope; the owner explicitly approves or cancels."],
            ["4", "Owner selects an authorized Google Ads customer account.", "Encrypted refresh/access tokens and the selected customer ID are stored server-side."],
            ["5", "Owner requests a 30-day performance report.", "Server executes the fixed read-only GAQL query and returns campaign metrics to the private UI."],
            ["6", "Owner disconnects when desired.", "Stored provider credentials and resource selection are removed from active use."],
        ], [12 * mm, 68 * mm, 90 * mm]),
        p("3. Functional scope", "Section"),
        p("Implemented capability", "Subsection"),
        bullet("List Google Ads customer accounts available to the authorized Google identity."),
        bullet("Persist the selected customer account for the owner's private workspace."),
        bullet("Retrieve campaign name, status, impressions, clicks, cost, conversions, and conversion value for the last 30 days."),
        bullet("Display an empty state or a privacy-safe error if the provider is unavailable or authorization expires."),
        p("Explicitly excluded capability", "Subsection"),
        bullet("Creating, updating, enabling, pausing, or deleting campaigns or ads."),
        bullet("Changing bids, daily budgets, account budgets, billing, keywords, targeting, audiences, or conversion tracking."),
        bullet("Bulk operations, automated optimisation, unattended account changes, or spend-triggering actions."),
        PageBreak(),
        Spacer(1, 13 * mm),
    ]

    story += [
        p("4. System architecture", "Section"),
        p("All provider operations occur on the server. Browser code never receives the developer token, OAuth client secret, refresh token, or service-role credentials."),
        Table([
            [p("PRIVATE USER", "Callout"), "", p("TRADIE AI SERVER", "Callout"), "", p("GOOGLE ADS API", "Callout")],
            [p("Sign in<br/>Connect account<br/>View report", "Small"), p("HTTPS", "Small"), p("Auth checks<br/>OAuth state<br/>Fixed GAQL<br/>Audit log", "Small"), p("OAuth + HTTPS", "Small"), p("Account list<br/>Campaign report", "Small")],
        ], colWidths=[38 * mm, 20 * mm, 54 * mm, 20 * mm, 38 * mm], style=TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), PALE),
            ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#F2F5FA")),
            ("BACKGROUND", (4, 0), (4, -1), PALE),
            ("BOX", (0, 0), (0, -1), 1, BLUE),
            ("BOX", (2, 0), (2, -1), 1, DARK),
            ("BOX", (4, 0), (4, -1), 1, BLUE),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ])),
        p("Server components", "Subsection"),
        info_table([
            ["Component", "Responsibility"],
            ["OAuth routes", "Start/callback processing, state verification, token exchange, and resource selection."],
            ["Provider configuration", "Rejects requests when required server-only credentials are absent or malformed."],
            ["Google Ads client", "Adds the developer token and OAuth access token, calls the configured API version, and parses controlled responses."],
            ["Connection store", "Keeps encrypted provider tokens, selected resource IDs, connection status, and provider metadata."],
            ["Audit log", "Records actor, workspace, operation, provider, status, safe error code, and timestamp without storing provider secrets."],
        ], [45 * mm, 125 * mm]),
        p("Fixed reporting query", "Subsection"),
        p("The server query selects campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, and metrics.conversions_value. It filters segments.date to DURING LAST_30_DAYS, orders by impressions descending, and applies LIMIT 100."),
        p("5. Data handling and retention", "Section"),
        bullet("OAuth tokens are encrypted at rest with a server-only encryption key before database storage."),
        bullet("Provider credentials are never included in client-side bundles, chat prompts, audit metadata, error messages, or downloadable files."),
        bullet("Google Ads results are returned to the requesting owner and may be used within that private workspace for business reporting."),
        bullet("Connections can be revoked by the owner; expired or revoked tokens move the connection into a disconnected/error state."),
        bullet("Stored workspace records are protected by Supabase row-level security and application-level owner checks."),
        PageBreak(),
        Spacer(1, 13 * mm),
    ]

    story += [
        p("6. Security and policy controls", "Section"),
        info_table([
            ["Control", "Implementation"],
            ["Authentication", "Supabase Auth session required for every connection and report request."],
            ["Authorisation", "Workspace ownership is checked before provider credentials or reports are accessed."],
            ["OAuth protection", "Short-lived signed state binds callback requests to the user, workspace, and provider."],
            ["Secret management", "Developer token and OAuth client secret are server-only hosted environment secrets."],
            ["Token storage", "Access and refresh tokens are encrypted before persistence."],
            ["Least product capability", "Only account discovery and fixed reporting operations are implemented."],
            ["Safe logging", "Audit events store operation status and privacy-safe error summaries, not OAuth tokens or raw provider responses."],
            ["Failure behaviour", "Missing configuration, revoked consent, rate limits, and provider errors fail closed and do not trigger retries that mutate data."],
        ], [46 * mm, 124 * mm]),
        p("7. Testing and operational controls", "Section"),
        bullet("Automated tests cover provider configuration, OAuth state validation, account/resource selection, report parsing, authorization failures, and the non-production publishing guard."),
        bullet("Deployment configuration is separated from source control; real credentials are stored as hosted secrets and local ignored environment values."),
        bullet("The Google Ads API version is pinned and reviewed before version sunset dates."),
        bullet("Production reporting will not be enabled until Google grants Basic Access and the target advertiser account is eligible and verified."),
        p("8. Change-management commitment", "Section"),
        p("If GreenVac later adds campaign creation, budget changes, optimisation, public customer access, or a materially different business model, it will update this documentation, review Google Ads API policy obligations, add an explicit proposed-action approval flow, and seek any required access or verification before releasing those capabilities."),
        p("9. Support contact", "Section"),
        info_table([
            ["Field", "Value"],
            ["API contact", "j.w.coleman87@gmail.com"],
            ["Business", "GreenVac"],
            ["Website", "https://www.greenvac.com.au/"],
            ["Prepared", "1 September 2026"],
        ], [45 * mm, 125 * mm]),
    ]

    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
    print(OUTPUT)


if __name__ == "__main__":
    build()
