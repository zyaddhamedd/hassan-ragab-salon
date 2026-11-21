from __future__ import annotations

import re
from datetime import date, datetime, time, timezone
from dataclasses import dataclass
from tempfile import SpooledTemporaryFile
from typing import Iterable, List, Optional, Sequence, Union
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


_INVALID_XML_CHARS = re.compile(
    r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]"
)
_INVALID_SHEET_NAME_CHARS = re.compile(r"[\[\]\*\?/\\:]")


@dataclass(frozen=True)
class ExcelColumn:
    title: str
    width: int = 18
    cell_type: str = "text"


@dataclass(frozen=True)
class ExcelCell:
    value: object
    cell_type: str = "text"
    style_id: Optional[int] = None


@dataclass(frozen=True)
class ExcelRow:
    values: Sequence[object]
    style_id: int = 2


@dataclass(frozen=True)
class ExcelSheet:
    name: str
    columns: Sequence[ExcelColumn]
    rows: Iterable[Union[Sequence[object], ExcelRow]]


def build_xlsx_file(
    *,
    sheet_name: str,
    columns: Sequence[ExcelColumn],
    rows: Iterable[Union[Sequence[object], ExcelRow]],
):
    """
    Build a lightweight XLSX workbook without third-party dependencies.

    The workbook is written to a spooled temporary file so larger exports can
    transparently spill to disk instead of living entirely in memory.
    """
    if not columns:
        raise ValueError("At least one Excel column is required.")

    workbook_file = SpooledTemporaryFile(max_size=5 * 1024 * 1024, mode="w+b")

    with ZipFile(workbook_file, mode="w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("[Content_Types].xml", _content_types_xml())
        archive.writestr("_rels/.rels", _root_relationships_xml())
        archive.writestr("docProps/app.xml", _app_properties_xml())
        archive.writestr("docProps/core.xml", _core_properties_xml())
        archive.writestr("xl/_rels/workbook.xml.rels", _workbook_relationships_xml())
        archive.writestr("xl/workbook.xml", _workbook_xml(sheet_name))
        archive.writestr("xl/styles.xml", _styles_xml())

        with archive.open("xl/worksheets/sheet1.xml", "w") as sheet_xml:
            _write_worksheet(sheet_xml, sheet_name, columns, rows)

    workbook_file.seek(0)
    return workbook_file


def build_xlsx_workbook_file(*, sheets: Sequence[ExcelSheet]):
    """Build a multi-sheet XLSX workbook using the same streaming worksheet writer."""
    if not sheets:
        raise ValueError("At least one Excel sheet is required.")
    normalized = []
    used_names = set()
    for index, sheet in enumerate(sheets, start=1):
        if not sheet.columns:
            raise ValueError(f"Sheet {index} must define at least one column.")
        base = _sanitize_sheet_name(sheet.name)
        name = base
        suffix = 2
        while name in used_names:
            tail = f" {suffix}"
            name = f"{base[:31 - len(tail)]}{tail}"
            suffix += 1
        used_names.add(name)
        normalized.append(ExcelSheet(name=name, columns=sheet.columns, rows=sheet.rows))

    workbook_file = SpooledTemporaryFile(max_size=5 * 1024 * 1024, mode="w+b")
    with ZipFile(workbook_file, mode="w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("[Content_Types].xml", _multi_content_types_xml(len(normalized)))
        archive.writestr("_rels/.rels", _root_relationships_xml())
        archive.writestr("docProps/app.xml", _app_properties_xml())
        archive.writestr("docProps/core.xml", _core_properties_xml())
        archive.writestr("xl/_rels/workbook.xml.rels", _multi_workbook_relationships_xml(len(normalized)))
        archive.writestr("xl/workbook.xml", _multi_workbook_xml([sheet.name for sheet in normalized]))
        archive.writestr("xl/styles.xml", _styles_xml())
        for index, sheet in enumerate(normalized, start=1):
            with archive.open(f"xl/worksheets/sheet{index}.xml", "w") as sheet_xml:
                _write_worksheet(sheet_xml, sheet.name, sheet.columns, sheet.rows)
    workbook_file.seek(0)
    return workbook_file


def _write_worksheet(sheet_xml, _sheet_name: str, columns: Sequence[ExcelColumn], rows: Iterable[Union[Sequence[object], ExcelRow]]):
    header_row = [column.title for column in columns]
    last_column_letter = _excel_column_letter(len(columns))
    data_row_count = 1

    sheet_xml.write(
        (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetViews><sheetView workbookViewId="0">'
            '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            '</sheetView></sheetViews>'
        ).encode("utf-8")
    )
    sheet_xml.write(_columns_xml(columns).encode("utf-8"))
    sheet_xml.write("<sheetData>".encode("utf-8"))
    sheet_xml.write(_row_xml(1, header_row, columns=columns, style_id=1).encode("utf-8"))

    for row_index, row in enumerate(rows, start=2):
        row_values = row.values if isinstance(row, ExcelRow) else row
        row_style_id = row.style_id if isinstance(row, ExcelRow) else 2

        normalized_row = list(row_values[: len(columns)])
        if len(normalized_row) < len(columns):
            normalized_row.extend([None] * (len(columns) - len(normalized_row)))
        sheet_xml.write(_row_xml(row_index, normalized_row, columns=columns, style_id=row_style_id).encode("utf-8"))
        data_row_count = row_index

    auto_filter_ref = f"A1:{last_column_letter}{max(data_row_count, 1)}"
    sheet_xml.write("</sheetData>".encode("utf-8"))
    sheet_xml.write(f'<autoFilter ref="{auto_filter_ref}"/>'.encode("utf-8"))
    sheet_xml.write(
        (
            '<pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
            "</worksheet>"
        ).encode("utf-8")
    )


def _row_xml(row_number: int, values: Sequence[object], *, columns: Sequence[ExcelColumn], style_id: int) -> str:
    cells = []
    for column_index, value in enumerate(values, start=1):
        cell_ref = f"{_excel_column_letter(column_index)}{row_number}"
        column = columns[column_index - 1]
        cells.append(_cell_xml(cell_ref, value, default_cell_type=column.cell_type, row_style_id=style_id))
    return f'<row r="{row_number}">{"".join(cells)}</row>'


def _cell_xml(cell_ref: str, value: object, *, default_cell_type: str, row_style_id: int) -> str:
    if isinstance(value, ExcelCell):
        cell_type = value.cell_type or default_cell_type
        style_id = value.style_id if value.style_id is not None else _default_style_id_for_cell_type(cell_type)
        raw_value = value.value
    else:
        cell_type = default_cell_type if row_style_id == 2 else "text"
        style_id = row_style_id if row_style_id != 2 else _default_style_id_for_cell_type(cell_type)
        raw_value = value

    if raw_value in (None, ""):
        if cell_type == "text":
            return f'<c r="{cell_ref}" t="inlineStr" s="{style_id}"><is><t xml:space="preserve"></t></is></c>'
        return f'<c r="{cell_ref}" s="{style_id}"/>'

    if cell_type == "text":
        escaped_value = escape(_sanitize_text(str(raw_value)))
        return f'<c r="{cell_ref}" t="inlineStr" s="{style_id}"><is><t xml:space="preserve">{escaped_value}</t></is></c>'

    if cell_type == "integer":
        numeric_value = int(raw_value)
        return f'<c r="{cell_ref}" s="{style_id}"><v>{numeric_value}</v></c>'

    if cell_type in {"number", "amount"}:
        numeric_value = float(raw_value)
        return f'<c r="{cell_ref}" s="{style_id}"><v>{numeric_value}</v></c>'

    if cell_type == "date":
        return f'<c r="{cell_ref}" s="{style_id}"><v>{_excel_serial_for_date(raw_value)}</v></c>'

    if cell_type == "datetime":
        return f'<c r="{cell_ref}" s="{style_id}"><v>{_excel_serial_for_datetime(raw_value)}</v></c>'

    if cell_type == "time":
        return f'<c r="{cell_ref}" s="{style_id}"><v>{_excel_serial_for_time(raw_value)}</v></c>'

    escaped_value = escape(_sanitize_text(str(raw_value)))
    return f'<c r="{cell_ref}" t="inlineStr" s="{style_id}"><is><t xml:space="preserve">{escaped_value}</t></is></c>'


def _default_style_id_for_cell_type(cell_type: str) -> int:
    return {
        "text": 2,
        "integer": 4,
        "amount": 6,
        "date": 8,
        "datetime": 10,
        "time": 12,
        "number": 14,
    }.get(cell_type, 2)


def _excel_serial_for_date(value: object) -> float:
    if isinstance(value, datetime):
        value = value.date()
    if not isinstance(value, date):
        raise TypeError(f"Expected date-compatible value, got {type(value)!r}")
    epoch = date(1899, 12, 30)
    return float((value - epoch).days)


def _excel_serial_for_datetime(value: object) -> float:
    if not isinstance(value, datetime):
        raise TypeError(f"Expected datetime value, got {type(value)!r}")
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    excel_epoch = datetime(1899, 12, 30)
    delta = value - excel_epoch
    return (delta.days * 86400 + delta.seconds + (delta.microseconds / 1_000_000)) / 86400


def _excel_serial_for_time(value: object) -> float:
    if isinstance(value, datetime):
        value = value.timetz() if value.tzinfo is not None else value.time()
    if not isinstance(value, time):
        raise TypeError(f"Expected time-compatible value, got {type(value)!r}")
    if value.tzinfo is not None:
        anchored = datetime.combine(date(1970, 1, 1), value)
        value = anchored.astimezone(timezone.utc).time().replace(tzinfo=None)
    seconds = (value.hour * 3600) + (value.minute * 60) + value.second + (value.microsecond / 1_000_000)
    return seconds / 86400


def _columns_xml(columns: Sequence[ExcelColumn]) -> str:
    widths = []
    for index, column in enumerate(columns, start=1):
        width = max(10, min(int(column.width), 60))
        widths.append(
            f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>'
        )
    return f"<cols>{''.join(widths)}</cols>"


def _excel_column_letter(index: int) -> str:
    letters: List[str] = []
    while index:
        index, remainder = divmod(index - 1, 26)
        letters.append(chr(65 + remainder))
    return "".join(reversed(letters))


def _sanitize_text(value: str) -> str:
    return _INVALID_XML_CHARS.sub("", value)


def _sanitize_sheet_name(sheet_name: str) -> str:
    cleaned = _INVALID_SHEET_NAME_CHARS.sub("", (sheet_name or "").strip())
    return (cleaned or "Sheet1")[:31]


def _content_types_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        "</Types>"
    )


def _multi_content_types_xml(sheet_count: int) -> str:
    worksheets = "".join(
        f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for index in range(1, sheet_count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        f'{worksheets}</Types>'
    )


def _root_relationships_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        "</Relationships>"
    )


def _app_properties_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        "<Application>OpenAI Codex Export</Application>"
        "</Properties>"
    )


def _core_properties_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        "<dc:creator>OpenAI Codex</dc:creator>"
        "<cp:lastModifiedBy>OpenAI Codex</cp:lastModifiedBy>"
        "</cp:coreProperties>"
    )


def _workbook_relationships_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        "</Relationships>"
    )


def _multi_workbook_relationships_xml(sheet_count: int) -> str:
    relationships = "".join(
        f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>'
        for index in range(1, sheet_count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'{relationships}'
        f'<Relationship Id="rId{sheet_count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '</Relationships>'
    )


def _workbook_xml(sheet_name: str) -> str:
    safe_sheet_name = escape(_sanitize_sheet_name(sheet_name))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        "<sheets>"
        f'<sheet name="{safe_sheet_name}" sheetId="1" r:id="rId1"/>'
        "</sheets>"
        "</workbook>"
    )


def _multi_workbook_xml(sheet_names: Sequence[str]) -> str:
    sheets = "".join(
        f'<sheet name="{escape(_sanitize_sheet_name(name))}" sheetId="{index}" r:id="rId{index}"/>'
        for index, name in enumerate(sheet_names, start=1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets>{sheets}</sheets></workbook>'
    )


def _styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<numFmts count="4">'
        '<numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>'
        '<numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/>'
        '<numFmt numFmtId="166" formatCode="hh:mm"/>'
        '<numFmt numFmtId="167" formatCode="#,##0.00"/>'
        '</numFmts>'
        '<fonts count="7">'
        '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
        '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'
        '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'
        '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'
        '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'
        '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'
        '</fonts>'
        '<fills count="3">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFE53935"/><bgColor indexed="64"/></patternFill></fill>'
        '</fills>'
        '<borders count="2">'
        '<border><left/><right/><top/><bottom/><diagonal/></border>'
        '<border><left style="thin"><color rgb="22FFFFFF"/></left><right style="thin"><color rgb="22FFFFFF"/></right><top style="thin"><color rgb="22FFFFFF"/></top><bottom style="thin"><color rgb="22FFFFFF"/></bottom><diagonal/></border>'
        '</borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="15">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        '<xf numFmtId="3" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        '<xf numFmtId="3" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        '<xf numFmtId="167" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        '<xf numFmtId="167" fontId="6" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        '<xf numFmtId="164" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        '<xf numFmtId="164" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        '<xf numFmtId="165" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        '<xf numFmtId="165" fontId="6" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        '<xf numFmtId="166" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        '<xf numFmtId="166" fontId="6" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        '<xf numFmtId="167" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        '</cellXfs>'
        "</styleSheet>"
    )
