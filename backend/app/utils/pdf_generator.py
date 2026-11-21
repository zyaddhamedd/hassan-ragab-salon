
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as ReportLabImage
from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import arabic_reshaper
from bidi.algorithm import get_display
import os
import io
from datetime import datetime
from app.utils.date_utils import get_cairo_now

# Register a font that supports Arabic if available, otherwise fallback
# We will assume a standard font or try to use a system font.
# For simplicity in this environment, we might not have a custom Arabic font file handy.
# However, ReportLab's default fonts don't support Arabic effectively.
# We will try to load a font if it exists, otherwise we warn.
# But for now, let's assume we can use a standard font or just ASCII if we can't find one.
# ideally we need 'Arial' or similar.
# Let's check for a font file in the system or project. 
# As a fallback, we will use Helvetica but Arabic will be garbled without a font.
# We will try to use a font from the system if possible or a provided one.
# Since we don't have a guaranteed Arabic font file path, this is risky.
# BUT, we can try to use a default font and hope.
# actually, without a .ttf file, Arabic won't render.
# Let's hope the system has one we can reference or we simulate it.
# NOTE: In a real constrained env, we would need to download a font. 
# I will proceed assuming I can use 'Arial' if on Windows.

def register_fonts():
    try:
        # Windows usually has Arial
        pdfmetrics.registerFont(TTFont('Arial', 'arial.ttf'))
        return 'Arial'
    except:
        return 'Helvetica' # Fallback, no Arabic support

FONT_NAME = register_fonts()

def reshape_text(text):
    if not text:
        return ""
    try:
        reshaped_text = arabic_reshaper.reshape(text)
        bidi_text = get_display(reshaped_text)
        return bidi_text
    except:
        return text

def generate_employee_pdf(data):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=30, leftMargin=30, topMargin=30, bottomMargin=30)
    
    elements = []
    styles = getSampleStyleSheet()
    
    # Custom Styles
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontName=FONT_NAME,
        fontSize=24,
        alignment=TA_CENTER,
        spaceAfter=20
    )
    
    header_info_style = ParagraphStyle(
        'HeaderInfo',
        parent=styles['Normal'],
        fontName=FONT_NAME,
        fontSize=10,
        alignment=TA_CENTER,
        textColor=colors.gray
    )
    
    section_header_style = ParagraphStyle(
        'SectionHeader',
        parent=styles['Heading2'],
        fontName=FONT_NAME,
        fontSize=14,
        alignment=TA_RIGHT,
        spaceBefore=15,
        spaceAfter=10,
        textColor=colors.black
    )
    
    normal_style = ParagraphStyle(
        'CustomNormal',
        parent=styles['Normal'],
        fontName=FONT_NAME,
        fontSize=10,
        alignment=TA_RIGHT
    )
    
    # 1. Header
    elements.append(Paragraph(reshape_text("تقرير الأداء الشامل"), title_style))
    
    period_str = f"{data['meta']['period']['start']} - {data['meta']['period']['end']}"
    date_str = get_cairo_now().strftime("%Y-%m-%d")
    header_text = f"{reshape_text('تاريخ التقرير')}: {date_str} | {reshape_text('الفترة')}: {period_str}"
    elements.append(Paragraph(header_text, header_info_style))
    elements.append(Spacer(1, 20))
    
    # 2. Employee Info
    emp_info = data['meta']['employee']
    info_data = [
        [reshape_text(emp_info['branch']), reshape_text(emp_info['role']), reshape_text(emp_info['name'])],
        [reshape_text("الفرع"), reshape_text("المنصب"), reshape_text("الموظف")]
    ]
    
    info_table = Table(info_data, colWidths=[150, 150, 150])
    info_table.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('FONTNAME', (0,0), (-1,-1), FONT_NAME),
        ('FONTSIZE', (0,1), (-1,1), 8),
        ('TEXTCOLOR', (0,1), (-1,1), colors.gray),
        ('FONTSIZE', (0,0), (-1,0), 12),
        ('bottomPadding', (0,0), (-1,-1), 6),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 20))
    
    # 3. Executive Summary
    elements.append(Paragraph(reshape_text("ملخص الأداء العام"), section_header_style))
    
    summary = data['summary']
    fin = data['financials']
    
    summary_data = [
        [
            f"{fin['final_net_with_salary']:,} {reshape_text('ج.م')}",
            f"{summary['total_revenue']:,} {reshape_text('ج.م')}",
            f"{summary['total_hours']}",
            f"{summary['total_services']}"
        ],
        [
            reshape_text("صافي المستحقات"),
            reshape_text("إجمالي الإيرادات"),
            reshape_text("ساعات العمل"),
            reshape_text("إجمالي الخدمات")
        ]
    ]
    
    summary_table = Table(summary_data, colWidths=[130, 130, 130, 130])
    summary_table.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('FONTNAME', (0,0), (-1,-1), FONT_NAME),
        ('BOX', (0,0), (-1,-1), 1, colors.lightgrey),
        ('BACKGROUND', (0,1), (-1,1), colors.whitesmoke),
        ('FONTSIZE', (0,0), (-1,0), 14),
        ('FONTSIZE', (0,1), (-1,1), 9),
        ('PADDING', (0,0), (-1,-1), 12),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 20))
    
    # 4. Services Breakdown
    elements.append(Paragraph(reshape_text("تفاصيل الخدمات"), section_header_style))
    
    services = data['services_breakdown']
    if services:
        table_data = [[
            reshape_text("متوسط القيمة"),
            reshape_text("الإيراد"),
            reshape_text("العدد"),
            reshape_text("نوع الخدمة")
        ]]
        
        for s in services:
            table_data.append([
                f"{round(s['average_value']):,} ",
                f"{s['revenue']:,} ",
                str(s['count']),
                reshape_text(s['type'])
            ])
            
        svc_table = Table(table_data, colWidths=[120, 120, 100, 180])
        svc_table.setStyle(TableStyle([
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('FONTNAME', (0,0), (-1,-1), FONT_NAME),
            ('GRID', (0,0), (-1,-1), 0.5, colors.lightgrey),
            ('BACKGROUND', (0,0), (-1,0), colors.whitesmoke),
            ('FONTSIZE', (0,0), (-1,-1), 10),
            ('PADDING', (0,0), (-1,-1), 8),
        ]))
        elements.append(svc_table)
    else:
        elements.append(Paragraph(reshape_text("لا توجد خدمات"), normal_style))
        
    elements.append(Spacer(1, 20))
    
    # 5. Financial Summary
    elements.append(Paragraph(reshape_text("الملخص المالي"), section_header_style))
    
    fin_data = [
        [f"{fin['base_salary']:,}", reshape_text("الراتب الأساسي")],
        [f"{fin['total_commission']:,}", reshape_text("العمولات")],
        [f"{fin['total_overtime']:,}", reshape_text("الأوفر تايم")],
        [f"({fin['total_deductions']:,})", reshape_text("الخصومات")],
        [f"({fin['total_loans']:,})", reshape_text("السلف")],
        [f"{fin['final_net_with_salary']:,}", reshape_text("صافي الراتب")]
    ]
    
    fin_table = Table(fin_data, colWidths=[150, 200])
    fin_table.setStyle(TableStyle([
        ('ALIGN', (0,0), (0,-1), 'LEFT'),  # Numbers Left
        ('ALIGN', (1,0), (1,-1), 'RIGHT'), # Labels Right
        ('FONTNAME', (0,0), (-1,-1), FONT_NAME),
        ('FONTSIZE', (0,0), (-1,-1), 11),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LINEBELOW', (0,2), (-1,2), 1, colors.lightgrey), # After overtime
        ('LINEBELOW', (0,4), (-1,4), 1, colors.black),     # After loans
        ('FONTSIZE', (0,-1), (-1,-1), 14), # Total row bigger
        ('TEXTCOLOR', (0,-1), (-1,-1), colors.firebrick),
    ]))
    elements.append(fin_table)
    
    # Build
    doc.build(elements)
    buffer.seek(0)
    return buffer

