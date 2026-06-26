from enum import Enum
from typing import Optional, Any
from pydantic import BaseModel, Field
from datetime import datetime, timezone

class TaskStatus(str, Enum):
    PENDING = "PENDENTE"
    PROCESSING = "EM_ANDAMENTO"
    SUCCESS = "CONCLUIDO"
    FAILED = "ERRO"

class TaskType(str, Enum):
    BUSCA_XML = "BUSCA_XML"
    ATUALIZAR_FATURAMENTO = "ATUALIZAR_FATURAMENTO"
    GERAR_PGDAS_DAS = "GERAR_PGDAS_DAS" 

class TaskCreate(BaseModel):
    tipo: TaskType
    cliente_cod: int
    mesano: str = Field(..., pattern=r"^\d{6}$")
    payload: Optional[dict] = Field(default_factory=dict)
    username: str

class TaskResponse(TaskCreate):
    id: str
    status: TaskStatus
    error_msg: Optional[str] = None
    resultado: Optional[dict] = None
    created_at: datetime
    updated_at: datetime
    