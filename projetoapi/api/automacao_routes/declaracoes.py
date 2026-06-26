import asyncio
import base64
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks

from automacao.config import PDF_DIR
from core.schemas.task import TaskCreate as CoreTaskCreate
from database.database import (
    get_pre_cadastro_collection,
    get_tasks_collection,
    get_valordeclarado_collection,
)
from database.db_dominio import DatabaseConnection
from login.auth import get_current_user
from services.declaracao_service import DeclaracaoService
from services.task_service import TaskService
from api.automacao_routes.schemas import DeclaracaoPayload, DasPayload


router = APIRouter(tags=["automacao-declaracoes"])

colecao = get_pre_cadastro_collection()


def salvar_pdf_base64(cod_cliente: int, competencia: str, pdf_base64: str) -> str:
    ano = competencia[:4]
    mes = competencia[4:]
    nome_arquivo = f"{cod_cliente}-PGDAS-{mes}{ano}.pdf"
    caminho = PDF_DIR / nome_arquivo
    caminho.parent.mkdir(parents=True, exist_ok=True)

    with open(caminho, "wb") as f:
        f.write(base64.b64decode(pdf_base64))

    return str(caminho)


async def bg_transmitir_pgdas(
    cnpjs: list[str],
    pa: int,
    username: str,
    tipoDeclaracao: int = 1
):
    service = DeclaracaoService()
    colecao_cli = get_pre_cadastro_collection()
    tasks_collection = get_tasks_collection()
    mesano = str(pa)

    for cnpj in cnpjs:
        cliente = colecao_cli.find_one({"cnpj": cnpj})
        if not cliente:
            continue

        cod_cliente = cliente["_id"]
        empresa = cliente.get("empresa", "Empresa Desconhecida")

        task_doc = {
            "tipo": "declaracao_pgdas",
            "cliente_cod": cod_cliente,
            "empresa": empresa,
            "cnpj": cnpj,
            "mesano": mesano,
            "status": "em_andamento",
            "username": username,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        }

        result = tasks_collection.insert_one(task_doc)
        task_id = result.inserted_id

        try:
            res = await service.processar_pipeline_completo(
                cliente_cod=cod_cliente,
                mesano=mesano,
                username=username,
                tipoDeclaracao=tipoDeclaracao,
                task_id=str(task_id)
            )

            if res.get("status_pgdas") != "SUCESSO":
                tasks_collection.update_one(
                    {"_id": task_id},
                    {"$set": {
                        "status": "erro",
                        "error_msg": res.get("mensagem"),
                        "updated_at": datetime.now(timezone.utc)
                    }}
                )
            else:
                tasks_collection.update_one(
                    {"_id": task_id},
                    {"$set": {
                        "status": "concluído",
                        "updated_at": datetime.now(timezone.utc)
                    }}
                )

        except Exception as e:
            tasks_collection.update_one(
                {"_id": task_id},
                {"$set": {
                    "status": "erro",
                    "error_msg": str(e),
                    "updated_at": datetime.now(timezone.utc)
                }}
            )

        await asyncio.sleep(1)


@router.post("/declaracao")
async def solicitar_declaracao(
    payload: DeclaracaoPayload,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_user)
):
    background_tasks.add_task(
        bg_transmitir_pgdas,
        payload.cnpjs,
        payload.pa,
        user.get("username", "sistema"),
        payload.tipoDeclaracao
    )

    return {
        "mensagem": f"Processamento de {len(payload.cnpjs)} empresa(s) iniciado na fila."
    }


@router.post("/gerar-das")
async def gerar_das(payload: DasPayload, user=Depends(get_current_user)):
    service = DeclaracaoService()
    resultados = []

    for cnpj in payload.cnpjs:
        cliente = colecao.find_one({"cnpj": cnpj})
        if cliente:
            res = await service.processar_pipeline_completo(
                cliente_cod=cliente["_id"],
                mesano=str(payload.pa),
                username=user.get("username", "sistema")
            )
            resultados.append({**res, "cnpj": cnpj})

    return {"resultados": resultados}


@router.get("/declaracao/salvos")
def listar_declaracoes_salvas(
    mesano: str = Query(..., regex=r"^\d{6}$"),
    user=Depends(get_current_user)
):
    col = get_valordeclarado_collection()
    docs = list(col.find({"mesano": mesano}))

    ano, mes = int(mesano[:4]), int(mesano[4:])
    data_sim = f"{ano}-{mes:02d}-01"

    db = DatabaseConnection()
    db.connect()
    resultados = db.execute_query(
        """
        SELECT codi_emp, SUM(sdev_sim)
        FROM bethadba.efsdoimp
        WHERE data_sim = ? AND codi_imp = 44
        GROUP BY codi_emp
        """,
        (data_sim,)
    )
    db.close()

    imp_map = {
        row[0]: float(str(row[1]).replace(",", "."))
        for row in resultados or []
    }

    resp = []

    for d in docs:
        cod = d.get("cod_cliente")
        decl = d.get("declarado")

        try:
            num = (
                decl
                if isinstance(decl, (int, float))
                else float(str(decl).replace(".", "").replace(",", "."))
            )
            dif = round(num - imp_map.get(cod, 0.0), 2)

            resp.append({
                "cod_cliente": cod,
                "declarado": num,
                "erro_texto": None,
                "dif_declaracao": dif
            })

        except Exception:
            retorno = d.get("retorno") or {}
            serpro_body = retorno.get("serpro_body") or {}
            mensagens = serpro_body.get("mensagens", [])

            texto_erro = (
                mensagens[0].get("texto")
                if mensagens and isinstance(mensagens[0], dict)
                else None or str(decl)
            )

            resp.append({
                "cod_cliente": cod,
                "declarado": None,
                "erro_texto": texto_erro,
                "dif_declaracao": "verificar"
            })

    return {"salvos": resp}


@router.delete("/v2/fila/tarefas/{task_id}")
def arquivar_tarefa_fila(task_id: str, user=Depends(get_current_user)):
    col = get_tasks_collection()
    col.update_one(
        {"_id": ObjectId(task_id)},
        {"$set": {"status": "arquivada"}}
    )

    return {"success": True, "message": "Visto dado com sucesso"}


@router.post("/v2/fila/agendar")
def agendar_tarefa_v2(payload: CoreTaskCreate, user=Depends(get_current_user)):
    service = TaskService()
    resultado = service.agendar_tarefa(payload)
    return resultado


@router.get("/v2/fila/tarefas")
def listar_tarefas_v2(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=500),
    status: str = Query(None),
    user=Depends(get_current_user)
):
    col = get_tasks_collection()
    query = {"tipo": "declaracao_pgdas"}

    if status:
        query["status"] = status

    cursor = col.find(query).sort("created_at", -1).skip(skip).limit(limit)

    tarefas = []

    for t in cursor:
        tarefas.append({
            "id": str(t["_id"]),
            "cliente_cod": t.get("cliente_cod"),
            "empresa": t.get("empresa"),
            "cnpj": t.get("cnpj"),
            "mesano": t.get("mesano"),
            "status": t.get("status"),
            "step": t.get("step", "pendente"),
            "username": t.get("username"),
            "error_msg": t.get("error_msg"),
            "created_at": t.get("created_at").isoformat() if t.get("created_at") else None
        })

    return {"data": tarefas, "success": True}