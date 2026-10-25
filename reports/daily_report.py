"""Claude's Portfolio daily report — v2 design. Usage: python3 report.py data.json out.pdf"""
import json, sys
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm

d = json.load(open(sys.argv[1]))
INK, MUT, ACC = colors.HexColor("#1f2937"), colors.HexColor("#6b7280"), colors.HexColor("#4c1d95")
SOFT, LINE, WHITE = colors.HexColor("#f5f3ff"), colors.HexColor("#e5e7eb"), colors.white
CHIP = {"Researching": ("#dbeafe", "#1e40af"), "New": ("#dcfce7", "#166534"), "No change": ("#f3f4f6", "#374151"),
        "Updated": ("#fef3c7", "#92400e"), "Done": ("#dcfce7", "#166534"), "Pending": ("#fef3c7", "#92400e"),
        "Not started": ("#f3f4f6", "#374151"), "Removed": ("#fee2e2", "#991b1b"), "Held": ("#ede9fe", "#4c1d95")}

def S(name, **k):
    base = dict(fontName="Helvetica", fontSize=8.8, leading=12, textColor=INK); base.update(k)
    return ParagraphStyle(name, **base)
TITLE = S("t", fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=WHITE)
SUB = S("s", fontSize=8.5, leading=11, textColor=colors.HexColor("#ddd6fe"))
H = S("h", fontName="Helvetica-Bold", fontSize=11.5, leading=14, textColor=ACC, spaceBefore=9, spaceAfter=4)
BODY = S("b"); SMALL = S("sm", fontSize=7.6, leading=10, textColor=MUT)
BIG = S("big", fontName="Helvetica-Bold", fontSize=18, leading=21, textColor=ACC)
LEAD = S("lead", fontSize=10.5, leading=14.5)
P = Paragraph
W = A4[0] - 28*mm

def link(url, txt="source"): return f'<link href="{url}" color="#4c1d95"><u>{txt}</u></link>'
def chip(label):
    bg, fg = CHIP.get(label, ("#f3f4f6", "#374151"))
    t = Table([[P(f'<font color="{fg}"><b>{label}</b></font>', S("c", fontSize=7.4, leading=9, alignment=1))]], colWidths=[21*mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg)), ("ROUNDEDCORNERS", [4]*4),
                           ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]))
    return t
def box(rows, widths, bg=WHITE, pad=6, grid=True):
    t = Table(rows, colWidths=widths)
    st = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, -1), bg),
          ("TOPPADDING", (0, 0), (-1, -1), pad), ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
          ("LEFTPADDING", (0, 0), (-1, -1), pad), ("RIGHTPADDING", (0, 0), (-1, -1), pad)]
    if grid: st.append(("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE))
    t.setStyle(TableStyle(st)); return t

story = []
hdr = Table([[P("Claude's Portfolio — Daily Report", TITLE)], [P(d["date_long"], S("d", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=WHITE))],
             [P(d["subtitle"], SUB)]], colWidths=[W])
hdr.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), ACC), ("ROUNDEDCORNERS", [6]*4),
                         ("LEFTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (0, 0), 9),
                         ("BOTTOMPADDING", (0, -1), (-1, -1), 9), ("TOPPADDING", (0, 1), (-1, -1), 1)]))
story += [hdr, Spacer(1, 7)]
if d.get("late_note"):
    story += [box([[P("<b>Note:</b> " + d["late_note"], S("ln", fontSize=8.2, leading=11))]], [W], bg=colors.HexColor("#fef3c7"), pad=5, grid=False), Spacer(1, 5)]
story += [box([[P("<b>Today in one line</b>", S("k", fontSize=8, textColor=ACC))], [P(d["headline"], LEAD)]], [W], bg=SOFT, pad=7, grid=False)]
tiles = [[P(k["value"], BIG) for k in d["kpis"]], [P(f'<b>{k["label"]}</b>', BODY) for k in d["kpis"]],
         [P(k["note"], SMALL) for k in d["kpis"]]]
kt = Table(tiles, colWidths=[W/4]*4)
kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, LINE), ("LINEAFTER", (0, 0), (-2, -1), 0.6, LINE),
                        ("TOPPADDING", (0, 0), (-1, 0), 7), ("BOTTOMPADDING", (0, -1), (-1, -1), 7),
                        ("TOPPADDING", (0, 1), (-1, -1), 1), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
story += [Spacer(1, 7), kt]
story.append(P("What happened today", H))
if not d["events"]:
    story.append(box([[P("Nothing was recorded today. No trades, decisions, research updates or watchlist changes.", BODY)]], [W], bg=SOFT, grid=False))
else:
    rows = []
    for i, e in enumerate(d["events"], 1):
        txt = (f'<b>{e["title"]}</b><br/>{e["what"]}<br/><font color="#6b7280"><i>Why it matters:</i></font> {e["why"]}'
               f' &nbsp;<font size="7.5">{link(e["url"])}</font>')
        rows.append([P(f'<font color="#4c1d95" size="13"><b>{i}</b></font>', BODY), P(txt, BODY), chip(e["tag"])])
    story.append(box(rows, [8*mm, W-8*mm-25*mm, 25*mm]))
story.append(P(f'Companies on the watchlist ({len(d["watchlist"])})', H))
rows = [[P("<b>Company</b>", SMALL), P("<b>In short</b>", SMALL), P("<b>Status</b>", SMALL)]]
for w in d["watchlist"]:
    rows.append([P(f'<b>{w["company"]}</b><br/><font color="#6b7280" size="7.5">{w["ticker"]} · reviewed {w["reviewed"]}</font>', BODY),
                 P(w["short"] + f' &nbsp;<font size="7.5">{link(w["url"])}</font>', BODY), chip(w["status"])])
story.append(box(rows, [42*mm, W-42*mm-25*mm, 25*mm], pad=5))
left = [[P("<b>Coming up</b>", S("cu", fontName="Helvetica-Bold", fontSize=10, textColor=ACC))]]
for c in d["catalysts"] or [{"date": "-", "text": "No dated, sourced events recorded."}]:
    left.append([P(f'<font color="#4c1d95"><b>{c["date"]}</b></font> &nbsp;{c["text"]}', BODY)])
right = [[P(f'<b>{d.get("right_title", "Portfolio vs benchmark")}</b>', S("rp", fontName="Helvetica-Bold", fontSize=10, textColor=ACC)), ""]]
for s in d["steps"]:
    right.append([P(s["text"], BODY), chip(s["state"])])
lt = box(left, [W/2-3*mm], bg=SOFT, pad=5, grid=False)
rt = box(right, [W/2-3*mm-25*mm, 25*mm], bg=SOFT, pad=5, grid=False)
two = Table([[lt, rt]], colWidths=[W/2, W/2]); two.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 3*mm), ("RIGHTPADDING", (1, 0), (1, 0), 0)]))
story += [Spacer(1, 9), two]
story += [Spacer(1, 9), P("<b>How to read this:</b> " + d["glossary"], SMALL), Spacer(1, 3), P(d["footer"], SMALL)]
SimpleDocTemplate(sys.argv[2], pagesize=A4, leftMargin=14*mm, rightMargin=14*mm, topMargin=12*mm, bottomMargin=11*mm,
                  title=f"Claude's Portfolio — Daily Report {d['date_iso']}", author="Claude").build(story)
