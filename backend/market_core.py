import re
from datetime import datetime
from typing import List, Set

SYMBOL_PATTERN = re.compile(r"^(?:sh|sz|bj)\d{6}$")
MAX_SUBSCRIBED_SYMBOLS = 200


def safe_float(value, default: float = 0.0) -> float:
    try:
        if value is None or str(value).strip() == "-":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def normalize_symbols(symbols) -> Set[str]:
    if not isinstance(symbols, list):
        return set()
    return {
        symbol
        for symbol in symbols[:MAX_SUBSCRIBED_SYMBOLS]
        if isinstance(symbol, str) and SYMBOL_PATTERN.fullmatch(symbol)
    }


def is_current_market_timestamp(timestamp: int, now: datetime | None = None) -> bool:
    if timestamp <= 0:
        return False
    reference = now or datetime.now()
    return datetime.fromtimestamp(timestamp).date() == reference.date()


def parse_tencent_quote(fields: List[str], symbol: str):
    """Normalize one Tencent quote row using the documented field layout."""
    if len(fields) <= 48:
        return None

    try:
        price = float(fields[3])
        composite = fields[35].split("/")
        volume = (
            safe_float(composite[1]) * 100
            if len(composite) > 1
            else safe_float(fields[6]) * 100
        )
        amount = safe_float(composite[2]) if len(composite) > 2 else 0.0
        if amount <= 0 and volume > 0:
            amount = price * volume

        return {
            "code": fields[2],
            "symbol": symbol,
            "name": fields[1],
            "price": price,
            "high": safe_float(fields[33]),
            "low": safe_float(fields[34]),
            "change": safe_float(fields[31]),
            "changePercent": safe_float(fields[32]),
            "volume": volume,
            "amount": amount,
            "pe": safe_float(fields[39]),
            "pb": safe_float(fields[46]),
            "marketCap": safe_float(fields[45]),
            "quoteTime": fields[30] if len(fields) > 30 else "",
        }
    except (IndexError, ValueError, TypeError):
        return None
