from datetime import datetime, date, timezone
try:
    from zoneinfo import ZoneInfo
except ImportError:
    # Fallback for Python < 3.9 (though Dockerfile uses 3.9)
    # We will assume user has 3.9+. If not, we might need backports.zoneinfo
    from backports.zoneinfo import ZoneInfo

# Define Cairo Timezone
CAIRO_TZ = ZoneInfo("Africa/Cairo")

def get_cairo_now() -> datetime:
    """
    Get the current time in Cairo timezone.
    Returns a timezone-aware datetime.
    """
    return datetime.now(CAIRO_TZ)

def get_cairo_date() -> date:
    """
    Get the current 'Today' date according to Cairo time.
    Crucial for logic that runs after midnight UTC but before midnight Cairo.
    """
    return datetime.now(CAIRO_TZ).date()

def to_iso_string(dt: datetime) -> str:
    """
    Convert a datetime/date object to ISO string.
    If dt is None, returns None.
    ensure it returns a string suitable for JSON.
    """
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    return dt.isoformat()

def get_utc_now() -> datetime:
    """
    Get current UTC time (timezone aware).
    Use this instead of datetime.now() or datetime.utcnow().
    """
    return datetime.now(timezone.utc)
