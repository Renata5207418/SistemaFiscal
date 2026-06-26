from datetime import datetime
from pydantic import BaseModel, Field


class XmlTaskCreate(BaseModel):
    mesano: str = Field(..., pattern=r"^\d{6}$")


class EnquadramentoPayload(BaseModel):
    codi_emps: list[int] = Field(
        default_factory=list,
        description="Lista de códigos de empresa; vazio = todas"
    )
    date: str = Field(
        ...,
        pattern=r"^\d{4}-\d{2}-01$",
        description="Data de corte no formato YYYY-MM-01"
    )


class GuiaInfo(BaseModel):
    hash: str = Field(..., description="Hash do arquivo publicado")
    published_at: datetime = Field(..., description="Data e hora da publicação")


class GuiaEnviadaSchema(BaseModel):
    cod_cliente: int
    mesano: str = Field(..., description="Competência no formato YYYYMM")
    pgdas: GuiaInfo
    das: GuiaInfo | None = None
    guia_enviada: bool
    updated_at: datetime


class ConferenciaPayload(BaseModel):
    cod_cliente: int
    mesano: str


class DeclaracaoPayload(BaseModel):
    pa: int
    cnpjs: list[str]
    tipoDeclaracao: int = 1


class DasPayload(BaseModel):
    pa: int
    cnpjs: list[str]


class LoteDownloadPayload(BaseModel):
    codigos: list[int]
    mesano: str
    tipo_download: str  # 'ambos', 'pgdas', 'das'

class TomadasValorLotePayload(BaseModel):
    mesano: str = Field(..., pattern=r"^\d{6}$")
    codigos: list[int] = Field(default_factory=list)
    cnpjs: list[str] = Field(default_factory=list)
    todos: bool = False