import math
import types
from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from bson import ObjectId

try:
    from bson.code import Code
except Exception:
    Code = None


def safe_json(obj, _depth: int = 0):
    """
    Converte objetos que podem quebrar o JSONResponse em valores seguros.

    Trata:
    - ObjectId
    - datetime/date
    - Decimal
    - Path
    - bytes
    - set/tuple/list
    - dict
    - bson Code
    - code object do Python
    - callables
    """

    if _depth > 30:
        return str(obj)

    if obj is None:
        return None

    if isinstance(obj, bool):
        return obj

    if isinstance(obj, str):
        return obj

    if isinstance(obj, int):
        return obj

    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None

    if isinstance(obj, Decimal):
        try:
            return float(obj)
        except Exception:
            return str(obj)

    if isinstance(obj, (datetime, date)):
        return obj.isoformat()

    if isinstance(obj, ObjectId):
        return str(obj)

    if isinstance(obj, Path):
        return str(obj)

    if isinstance(obj, bytes):
        try:
            return obj.decode("utf-8", errors="replace")
        except Exception:
            return str(obj)

    if Code is not None and isinstance(obj, Code):
        return str(obj)

    if isinstance(obj, types.CodeType):
        return f"<code:{obj.co_name}>"

    if isinstance(obj, Mapping):
        seguro = {}

        for chave, valor in obj.items():
            chave_segura = safe_json(chave, _depth + 1)

            if not isinstance(chave_segura, str):
                chave_segura = str(chave_segura)

            seguro[chave_segura] = safe_json(valor, _depth + 1)

        return seguro

    if isinstance(obj, (list, tuple, set)):
        return [safe_json(item, _depth + 1) for item in obj]

    if callable(obj):
        return str(obj)

    return str(obj)
