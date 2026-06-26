from typing import Generic, TypeVar, Optional, Any
from pydantic import BaseModel

T = TypeVar("T")

class BaseResponse(BaseModel, Generic[T]):
    success: bool = True
    data: Optional[T] = None
    error: Optional[str] = None
    meta: Optional[dict] = None

def success_response(data: Any, meta: dict = None) -> dict:
    return {"success": True, "data": data, "error": None, "meta": meta}

def error_response(message: str, meta: dict = None) -> dict:
    return {"success": False, "data": None, "error": message, "meta": meta}
