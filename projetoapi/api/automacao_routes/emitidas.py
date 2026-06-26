import base64
import calendar
import logging
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import zipfile
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks, status as http_status
from fastapi.responses import StreamingResponse

from automacao.config import STORAGE_INDIVIDUAL
from automacao.runner import processar_empresa_mes, reprocessar_faturamento_mensal
from database.database import (
    get_pre_cadastro_collection,
    get_tasks_collection,
    get_faturamentos_collection,
    get_tasksfaturamentos_collection,
)
from login.auth import get_current_user
from repositories.dominio_repository import DominioRepository
from services.faturamento_service import FaturamentoService
from api.automacao_routes.schemas import XmlTaskCreate


logger = logging.getLogger(__name__)

router = APIRouter(tags=["automacao-emitidas"])

colecao = get_pre_cadastro_collection()
tasks_col = get_tasks_collection()
fat_tasks = get_tasksfaturamentos_collection()
coll_fat = get_faturamentos_collection()


@router.post("/cliente/{cod}")
def automacao_cliente(cod: int, mesano: str):
    doc = colecao.find_one({"_id": cod, "ativo": True})
    if not doc:
        raise HTTPException(404, f"Cliente {cod} não encontrado.")

    nome = doc["empresa"]
    cnpj = doc["cnpj"]

    try:
        mes = f"{mesano[:4]}-{mesano[4:]}"
    except Exception:
        raise HTTPException(400, "Formato inválido. Use YYYYMM.")

    try:
        resultados = processar_empresa_mes(
            codigo=str(cod),
            nome=nome,
            cnpj=cnpj,
            mes=mes
        )
        return {
            "cod": cod,
            "mesano": mesano,
            "detalhes": resultados
        }
    except Exception as e:
        raise HTTPException(500, f"Erro ao processar: {e}")


@router.post("/agenda/{cod}", status_code=http_status.HTTP_201_CREATED)
def agendar_tarefa(
        cod: int,
        payload: XmlTaskCreate,
        user=Depends(get_current_user)
):
    cliente = colecao.find_one({"_id": cod, "ativo": True})
    if not cliente:
        raise HTTPException(404, f"Cliente {cod} não encontrado.")

    existente = tasks_col.find_one({
        "cliente_cod": cod,
        "mesano": payload.mesano,
        "tipo": "manual",
        "status": {"$in": ["pendente", "em_andamento"]}
    })

    if existente:
        return {
            "job_id": str(existente["_id"]),
            "status": existente["status"],
            "mensagem": "Tarefa já está na fila."
        }

    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y%m%d%H%M%S%f")
    nome_limpo = cliente["empresa"].replace(" ", "_")
    pasta_path: Path = STORAGE_INDIVIDUAL / f"{cod}-{nome_limpo}-{ts}"

    task = {
        "user_id": ObjectId(user["_id"]),
        "username": user.get("username", ""),
        "cliente_cod": cod,
        "empresa": cliente.get("empresa", ""),
        "cnpj": cliente.get("cnpj", ""),
        "inscricao_municipal": cliente.get("inscricao_municipal", ""),
        "mesano": payload.mesano,
        "final_path": str(pasta_path),
        "status": "pendente",
        "tipo": "manual",
        "created_at": now,
        "updated_at": now,
        "error_msg": None,
    }
    result = tasks_col.insert_one(task)

    return {
        "job_id": str(result.inserted_id),
        "status": "pendente",
        "save_path": str(pasta_path),
    }


@router.get("/status")
def get_status():
    cursor = tasks_col.find({"tipo": {"$ne": "declaracao_pgdas"}}).sort("created_at", -1)
    tasks = []
    vistos = set()

    for t in cursor:
        cod = t.get("cliente_cod")
        mesano = t.get("mesano")
        chave = f"{cod}-{mesano}"

        if chave in vistos:
            continue

        vistos.add(chave)

        created = t.get("created_at") or datetime.now(timezone.utc)
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)

        tasks.append({
            "job_id": str(t.get("_id", "")),
            "cliente_cod": cod,
            "empresa": t.get("empresa", ""),
            "cnpj": t.get("cnpj", ""),
            "mesano": mesano,
            "status": t.get("status", ""),
            "username": t.get("username", ""),
            "tipo": t.get("tipo", ""),
            "created_at": created.isoformat(),
            "error_msg": t.get("error_msg", "")
        })

    return {"tasks": tasks}


def bg_buscar_xml_aws(task_id: str, cod_cliente: int, mesano: str):
    try:
        fat_tasks.update_one(
            {"_id": ObjectId(task_id)},
            {"$set": {"status": "em_andamento", "updated_at": datetime.now(timezone.utc)}}
        )

        reprocessar_faturamento_mensal(cod_cliente, mesano)

        fat_tasks.update_one(
            {"_id": ObjectId(task_id)},
            {"$set": {
                "status": "concluído",
                "updated_at": datetime.now(timezone.utc),
                "finished_at": datetime.now(timezone.utc)
            }}
        )

    except Exception as e:
        fat_tasks.update_one(
            {"_id": ObjectId(task_id)},
            {"$set": {
                "status": "erro",
                "error_msg": str(e),
                "updated_at": datetime.now(timezone.utc)
            }}
        )


@router.post("/agenda-xml/{cod}", status_code=http_status.HTTP_201_CREATED)
def agendar_faturamento_xml(
        cod: int,
        payload: XmlTaskCreate,
        background_tasks: BackgroundTasks,
        user=Depends(get_current_user)
):
    cliente = colecao.find_one({"_id": cod, "ativo": True})
    if not cliente:
        raise HTTPException(404, f"Cliente {cod} não encontrado.")

    now = datetime.now(timezone.utc)

    task = {
        "user_id": ObjectId(user["_id"]),
        "username": user.get("username", ""),
        "cliente_cod": cod,
        "empresa": cliente.get("empresa", ""),
        "cnpj": cliente.get("cnpj", ""),
        "inscricao_municipal": cliente.get("inscricao_municipal", ""),
        "mesano": payload.mesano,
        "status": "pendente",
        "tipo": "xml",
        "created_at": now,
        "updated_at": now,
        "error_msg": None,
    }

    result = fat_tasks.insert_one(task)
    task_id = str(result.inserted_id)

    background_tasks.add_task(bg_buscar_xml_aws, task_id, cod, payload.mesano)

    return {"job_id": task_id, "status": "pendente"}


@router.get("/status-faturamento")
def status_faturamento(
        mesano: str = Query(..., pattern=r"^\d{6}$"),
        user=Depends(get_current_user)
):
    cursor = fat_tasks.find({"mesano": mesano}).sort("created_at", -1)

    pre_cad = get_pre_cadastro_collection()
    clientes_map = {c["_id"]: c for c in pre_cad.find({"ativo": True})}

    resp = []
    vistos = set()

    for t in cursor:
        cod = t.get("cliente_cod")

        if cod in vistos:
            continue

        vistos.add(cod)

        cliente_info = clientes_map.get(cod, {})

        cnpj_real = t.get("cnpj") or cliente_info.get("cnpj", "CNPJ não encontrado")
        empresa_real = t.get("empresa") or cliente_info.get("empresa", "Empresa não encontrada")

        created = t.get("created_at")
        updated = t.get("updated_at")
        finished = t.get("finished_at")

        resp.append({
            "job_id": str(t["_id"]),
            "cliente_cod": cod,
            "empresa": empresa_real,
            "cnpj": cnpj_real,
            "username": t.get("username", "Sistema"),
            "mesano": t["mesano"],
            "status": t["status"],
            "tipo": t["tipo"],
            "error_msg": t.get("error_msg", None),
            "created_at": created.isoformat() if created else None,
            "updated_at": updated.isoformat() if updated else None,
            "finished_at": finished.isoformat() if finished else None,
        })

    return {"tasks": resp}


@router.get("/faturamento/xml")
def listar_faturamentos_xml(
        mesano: str = Query(..., pattern=r"^\d{6}$"),
        user=Depends(get_current_user)
):
    fat_service = FaturamentoService()
    dados_dominio = fat_service.obter_faturamento_dominio(mesano)

    mapa_dominio = {d["cod_cliente"]: d["total_faturamento"] for d in dados_dominio}

    resultado = []

    for cli in colecao.find({"ativo": True, "rotina": True}).sort("_id", 1):
        cod = cli["_id"]
        doc = coll_fat.find_one({"cod_cliente": cod, "mesano": mesano})
        valor_dom = mapa_dominio.get(cod, doc.get("valor_dominio", 0.0) if doc else 0.0)

        ultima_data = None
        if doc:
            raw_date = doc.get("updated_at", doc.get("created_at"))
            if isinstance(raw_date, datetime):
                ultima_data = raw_date.strftime("%Y-%m-%dT%H:%M:%S.000Z")
            elif isinstance(raw_date, str):
                ultima_data = raw_date

        resultado.append({
            "cod_cliente": cod,
            "cnpj": cli.get("cnpj", ""),
            "empresa": cli.get("empresa", ""),
            "regime_tributario": cli.get("regime_tributario", ""),
            "rotina": cli.get("rotina", False),
            "grupo": cli.get("grupo", "Sem grupo"),
            "total_valor_servicos": doc.get("total_valor_servicos", 0.0) if doc else 0.0,
            "valor_dominio": valor_dom,
            "cTribNac": doc.get("cTribNac", []) if doc else [],
            "updated_at": ultima_data
        })
        
    return {"faturamentos": resultado}


@router.get("/faturamento_dominio_sql")
def faturamento_dominio_sql(mesano: str = Query(..., regex=r"^\d{6}$")):
    service = FaturamentoService()
    return service.obter_faturamento_dominio(mesano)


@router.get("/faturamento_apuracao_sql")
def faturamento_apuracao_sql(
        mesano: str = Query(..., regex=r"^\d{6}$"),
        user=Depends(get_current_user)
):
    ano, mes = int(mesano[:4]), int(mesano[4:])
    data_sim = datetime(ano, mes, 1).strftime("%Y-%m-%d")

    repo = DominioRepository()
    resultados = repo.get_todas_apuracoes_mensal(data_sim)
    mapa_apurados = {row[0]: row[1] for row in (resultados or [])}

    apuracoes = []

    for cli in colecao.find({"ativo": True, "rotina": True}).sort("_id", 1):
        cod = cli["_id"]
        qtd = mapa_apurados.get(cod, 0)

        apuracoes.append({
            "cod_cliente": cod,
            "apurado": "Sim" if qtd > 0 else "Não"
        })

    return apuracoes


@router.get("/exportar-notas-excel")
def exportar_notas_excel(
        cnpj: str = Query(...),
        mesano: str = Query(...),
        user=Depends(get_current_user)
):
    from automacao.export_nfse_excel import gerar_excel_notas_buffer

    try:
        buffer = gerar_excel_notas_buffer(cnpj, f"{mesano[:4]}-{mesano[4:]}")
        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="Relatorio_Notas_{cnpj}_{mesano}.xlsx"'
            }
        )
    except Exception as e:
        raise HTTPException(500, str(e))
    