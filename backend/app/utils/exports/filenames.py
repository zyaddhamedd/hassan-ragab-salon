import re
from datetime import date
from typing import Iterable, Optional

from app.utils.date_utils import get_cairo_date


_INVALID_FILENAME_CHARS = re.compile(r"[^\w]+", re.UNICODE)


def slugify_filename_part(value: Optional[str], fallback: str = "") -> str:
    """Convert a human label into a filesystem-friendly filename part."""
    cleaned = (value or "").strip()
    if not cleaned:
        return fallback

    slug = _INVALID_FILENAME_CHARS.sub("_", cleaned).strip("_")
    return slug or fallback


def build_export_filename(
    base_name: str,
    *,
    extension: str,
    qualifiers: Optional[Iterable[str]] = None,
    exported_on: Optional[date] = None,
) -> str:
    parts = [slugify_filename_part(base_name, "Export")]

    for qualifier in qualifiers or ():
        normalized = slugify_filename_part(qualifier)
        if normalized:
            parts.append(normalized)

    parts.append((exported_on or get_cairo_date()).isoformat())
    return f"{'_'.join(parts)}.{extension.lstrip('.')}"
