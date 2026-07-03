import os
import re
import logging
from datetime import datetime, timezone
from pathlib import Path
from pydantic import BaseModel 
from bson import ObjectId
from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks, status as http_status
from fastapi.responses import StreamingResponse, JSONResponse
from utils.json_safe import safe_json
from database.database import (
    get_pre_cadastro_collection,
    get_tomadas_collection,
    get_taskstomadas_collection,
    get_certificados_collection,
)
from login.auth import get_current_user
from automacao.runner import reprocessar_tomadas_mensal
from automacao.config import STORAGE_INDIVIDUAL_TOMADAS
from api.automacao_routes.schemas import XmlTaskCreate, TomadasValorLotePayload
from services.tomadas_planilha_service import gerar_planilha_tomadas_xml_s3
from utils.utils import limpar_cnpj
from utils.excel_utils import (
    formatar_cnpj_excel,
    formatar_data_excel,
    numero_excel,
    inteiro_excel,
    criar_excel,
    responder_excel,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["automacao-tomadas"])

colecao = get_pre_cadastro_collection()
tomadas_tasks = get_taskstomadas_collection()
coll_tomadas = get_tomadas_collection()


# --- NOVO SCHEMA PARA A ROTA DE CONFERÊNCIA ---
class ConferenciaTogglePayload(BaseModel):
    cod_cliente: int
    mesano: str
# ----------------------------------------------


def _buscar_clientes_valor_tomadas(payload: TomadasValorLotePayload):
    query_base = {"ativo": True}

    if payload.todos:
        return list(
            colecao.find({**query_base, "rotina": True}).sort("_id", 1)
        )

    filtros = []

    if payload.codigos:
        filtros.append({"_id": {"$in": [int(c) for c in payload.codigos]}})

    if payload.cnpjs:
        cnpjs_limpos = [limpar_cnpj(c) for c in payload.cnpjs]
        cnpjs_limpos = [c for c in cnpjs_limpos if c]

        if cnpjs_limpos:
            filtros.append({"cnpj": {"$in": cnpjs_limpos}})

    if not filtros:
        raise HTTPException(
            status_code=400,
            detail="Informe codigos, cnpjs ou todos=true."
        )

    clientes_map = {}

    for filtro in filtros:
        for cli in colecao.find({**query_base, **filtro}).sort("_id", 1):
            clientes_map[cli["_id"]] = cli

    return list(clientes_map.values())


def _criar_task_valor_tomadas(cliente: dict, mesano: str, user: dict):
    cod = cliente["_id"]

    existente = tomadas_tasks.find_one({
        "cliente_cod": cod,
        "mesano": mesano,
        "tipo": "valor_tomadas",
        "status": {"$in": ["pendente", "em_andamento"]}
    })

    if existente:
        return {
            "criada": False,
            "job_id": str(existente["_id"]),
            "cliente_cod": cod,
            "empresa": existente.get("empresa") or cliente.get("empresa", ""),
            "cnpj": existente.get("cnpj") or cliente.get("cnpj", ""),
            "status": existente.get("status"),
            "tipo": "valor_tomadas",
            "mensagem": "Já existe atualização de valores pendente/em andamento."
        }

    now = datetime.now(timezone.utc)

    task = {
        "user_id": ObjectId(user["_id"]),
        "username": user.get("username", ""),
        "cliente_cod": cod,
        "empresa": cliente.get("empresa", ""),
        "cnpj": cliente.get("cnpj", ""),
        "mesano": mesano,
        "status": "pendente",
        "tipo": "valor_tomadas",
        "created_at": now,
        "updated_at": now,
        "error_msg": None,
    }

    result = tomadas_tasks.insert_one(task)

    return {
        "criada": True,
        "job_id": str(result.inserted_id),
        "cliente_cod": cod,
        "empresa": cliente.get("empresa", ""),
        "cnpj": cliente.get("cnpj", ""),
        "status": "pendente",
        "tipo": "valor_tomadas",
        "mensagem": "Task criada."
    }


def bg_buscar_xml_tomadas(
    task_id: str,
    cod_cliente: int,
    mesano: str,
    salvar_arquivos: bool = True
):
    try:
        tomadas_tasks.update_one(
            {"_id": ObjectId(task_id)},
            {"$set": {
                "status": "em_andamento",
                "updated_at": datetime.now(timezone.utc)
            }}
        )

        resultado = reprocessar_tomadas_mensal(
            cod_cliente,
            mesano,
            salvar_arquivos=salvar_arquivos
        )

        tomadas_tasks.update_one(
            {"_id": ObjectId(task_id)},
            {"$set": {
                "status": "concluído",
                "resultado": {
                    "quantidade_xmls_s3": resultado.get("quantidade_xmls_s3", 0),
                    "quantidade_notas_validas": resultado.get("quantidade_notas_validas", 0),
                    "quantidade_canceladas": resultado.get("quantidade_canceladas", 0),
                    "quantidade_retencao": resultado.get("quantidade_retencao", 0),
                    "total_tomadas": resultado.get("total_tomadas", 0.0),
                    "total_retencao": resultado.get("total_retencao", 0.0),
                    "salvou_arquivos": salvar_arquivos,
                },
                "updated_at": datetime.now(timezone.utc),
                "finished_at": datetime.now(timezone.utc)
            }}
        )

    except Exception as e:
        logger.exception(f"[TOMADAS] Erro ao processar task {task_id}")

        tomadas_tasks.update_one(
            {"_id": ObjectId(task_id)},
            {"$set": {
                "status": "erro",
                "error_msg": str(e),
                "updated_at": datetime.now(timezone.utc)
            }}
        )

@router.post("/tomadas/agenda/{cod}", status_code=http_status.HTTP_201_CREATED)
def agendar_tomadas_individual(
        cod: int,
        payload: XmlTaskCreate,
        user=Depends(get_current_user)
):
    """
    Busca individual de XMLs TOMADAS.

    Apenas baixa os XMLs para a pasta individual de tomadas.
    Não atualiza nfse_tomadas.
    """
    cliente = colecao.find_one({"_id": cod, "ativo": True})
    if not cliente:
        raise HTTPException(404, f"Cliente {cod} não encontrado.")

    existente = tomadas_tasks.find_one({
        "cliente_cod": cod,
        "mesano": payload.mesano,
        "tipo": "manual_tomadas",
        "status": {"$in": ["pendente", "em_andamento"]}
    })

    if existente:
        return {
            "job_id": str(existente["_id"]),
            "status": existente.get("status"),
            "mensagem": "Busca individual de tomadas já está na fila.",
            "save_path": existente.get("final_path")
        }

    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y%m%d%H%M%S%f")
    nome_limpo = cliente.get("empresa", "SEM_NOME").replace(" ", "_")

    pasta_path: Path = STORAGE_INDIVIDUAL_TOMADAS / f"{cod}-{nome_limpo}-{ts}"

    task = {
        "user_id": ObjectId(user["_id"]),
        "username": user.get("username", ""),
        "cliente_cod": cod,
        "empresa": cliente.get("empresa", ""),
        "cnpj": cliente.get("cnpj", ""),
        "mesano": payload.mesano,
        "final_path": str(pasta_path),
        "status": "pendente",
        "tipo": "manual_tomadas",
        "created_at": now,
        "updated_at": now,
        "error_msg": None,
    }

    result = tomadas_tasks.insert_one(task)

    return {
        "job_id": str(result.inserted_id),
        "status": "pendente",
        "save_path": str(pasta_path),
        "mensagem": "Busca individual de tomadas adicionada à fila."
    }

@router.post("/tomadas/agenda-xml/{cod}", status_code=http_status.HTTP_201_CREATED)
def agendar_tomadas_xml(
        cod: int,
        payload: XmlTaskCreate,
        user=Depends(get_current_user)
):
    cliente = colecao.find_one({"_id": cod, "ativo": True})
    if not cliente:
        raise HTTPException(404, f"Cliente {cod} não encontrado.")

    existente = tomadas_tasks.find_one({
        "cliente_cod": cod,
        "mesano": payload.mesano,
        "tipo": "xml_tomadas",
        "status": {"$in": ["pendente", "em_andamento"]}
    })

    if existente:
        return {
            "job_id": str(existente["_id"]),
            "status": existente.get("status"),
            "mensagem": "Tarefa de tomadas já está na fila."
        }

    now = datetime.now(timezone.utc)

    task = {
        "user_id": ObjectId(user["_id"]),
        "username": user.get("username", ""),
        "cliente_cod": cod,
        "empresa": cliente.get("empresa", ""),
        "cnpj": cliente.get("cnpj", ""),
        "mesano": payload.mesano,
        "status": "pendente",
        "tipo": "xml_tomadas",
        "created_at": now,
        "updated_at": now,
        "error_msg": None,
    }

    result = tomadas_tasks.insert_one(task)
    task_id = str(result.inserted_id)

    return {
        "job_id": task_id,
        "status": "pendente",
        "mensagem": "Tarefa de tomadas adicionada à fila. O processamento será feito pelo scheduler."
    }


@router.post("/tomadas/agenda-valor", status_code=http_status.HTTP_201_CREATED)
def agendar_tomadas_valor_lote(
        payload: TomadasValorLotePayload,
        user=Depends(get_current_user)
):
    """
    Enfileira atualização somente de valores de TOMADAS.

    Recebe uma lista de empresas, CNPJs ou todos=true.
    Não salva XML físico.
    Cria tasks tipo valor_tomadas.
    """
    clientes = _buscar_clientes_valor_tomadas(payload)

    if not clientes:
        raise HTTPException(
            status_code=404,
            detail="Nenhuma empresa encontrada para a seleção informada."
        )

    tasks = []

    for cliente in clientes:
        tasks.append(
            _criar_task_valor_tomadas(
                cliente=cliente,
                mesano=payload.mesano,
                user=user
            )
        )

    criadas = [t for t in tasks if t["criada"]]
    ignoradas = [t for t in tasks if not t["criada"]]

    return {
        "mesano": payload.mesano,
        "tipo": "valor_tomadas",
        "total_empresas": len(clientes),
        "total_criadas": len(criadas),
        "total_ignoradas": len(ignoradas),
        "tasks": tasks
    }


@router.get("/tomadas/status")
def status_tomadas(
        mesano: str = Query(..., pattern=r"^\d{6}$"),
        user=Depends(get_current_user)
):
    cursor = tomadas_tasks.find({"mesano": mesano}).sort("created_at", -1)

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

        created = t.get("created_at")
        updated = t.get("updated_at")
        finished = t.get("finished_at")

        resp.append({
            "job_id": str(t["_id"]),
            "cliente_cod": cod,
            "empresa": t.get("empresa") or cliente_info.get("empresa", "Empresa não encontrada"),
            "cnpj": t.get("cnpj") or cliente_info.get("cnpj", "CNPJ não encontrado"),
            "username": t.get("username", "Sistema"),
            "mesano": t.get("mesano"),
            "status": t.get("status"),
            "tipo": t.get("tipo"),
            "error_msg": t.get("error_msg"),
            "resultado": safe_json(t.get("resultado") or t.get("resultados", {})),
            "created_at": created.isoformat() if isinstance(created, datetime) else created,
            "updated_at": updated.isoformat() if isinstance(updated, datetime) else updated,
            "finished_at": finished.isoformat() if isinstance(finished, datetime) else finished,
        })

    return JSONResponse(content=safe_json({"tasks": resp}))


# --- ROTA NOVA DE TOGGLE DE CONFERÊNCIA ---
@router.post("/tomadas/conferencia/toggle")
def toggle_conferencia_tomadas(
        payload: ConferenciaTogglePayload,
        user=Depends(get_current_user)
):
    """
    Marca ou desmarca o status de conferência manual de uma empresa/competência
    """
    doc = coll_tomadas.find_one({
        "cod_cliente": payload.cod_cliente,
        "mesano": payload.mesano
    })

    if not doc:
        raise HTTPException(
            status_code=404, 
            detail="Faturamento de tomadas não encontrado para esta empresa e competência."
        )

    # Verifica o status atual da conferência
    atual = doc.get("conferencia", {}).get("status", False)
    novo_status = not atual

    if novo_status:
        # Pega a hora exata e formata (ex: 25/06 14:30)
        date_str = datetime.now().strftime("%d/%m %H:%M")
        username = user.get("username", "Sistema")
        
        novo_obj = {
            "status": True,
            "user": username,
            "date": date_str
        }
    else:
        # Limpa o objeto de conferência
        novo_obj = {
            "status": False,
            "user": "",
            "date": ""
        }

    # Atualiza direto no banco
    coll_tomadas.update_one(
        {"_id": doc["_id"]},
        {"$set": {"conferencia": novo_obj}}
    )

    return novo_obj
# ------------------------------------------


@router.get("/tomadas/xml")
def listar_tomadas_xml(
        mesano: str = Query(..., pattern=r"^\d{6}$"),
        user=Depends(get_current_user)
):
    # 1. Puxa todos os certificados de uma vez e cria um mapa usando o CNPJ como chave
    col_certificados = get_certificados_collection()
    mapa_certificados = {doc["_id"]: doc for doc in col_certificados.find({})}

    resultado = []

    # 2. Itera sobre os clientes
    for cli in colecao.find({"ativo": True}).sort("_id", 1):
        cod = cli["_id"]
        cnpj_raw = cli.get("cnpj", "")
        
        # --- LÓGICA DO CERTIFICADO ---
        cnpj_limpo = re.sub(r'\D', '', cnpj_raw) if cnpj_raw else ""
        cert = mapa_certificados.get(cnpj_limpo)

        if cert:
            validade = cert.get("Validade", "")
            if validade and "-" in validade:
                try:
                    ano, mes, dia = validade.split("-")
                    validade = f"{dia}/{mes}/{ano}"
                except:
                    pass
            status_texto = cert.get("Status", "Indefinido")
        else:
            validade = "-"
            status_texto = "Não Vinculado"
        # -----------------------------

        doc = coll_tomadas.find_one({
            "cod_cliente": cod,
            "mesano": mesano
        })

        ultima_data = None
        if doc:
            raw_date = doc.get("updated_at", doc.get("created_at"))
            if isinstance(raw_date, datetime):
                ultima_data = raw_date.isoformat()
            elif isinstance(raw_date, str):
                ultima_data = raw_date

        resultado.append({
            "cod_cliente": cod,
            "cnpj": cnpj_raw,
            "empresa": cli.get("empresa", ""),
            "grupo": cli.get("grupo", "Sem grupo"),
            "rotina": cli.get("rotina", False),
            "mesano": mesano,
            "cert_status": status_texto,
            "cert_validade": validade,

            "quantidade_notas_validas": doc.get("quantidade_notas_validas", 0) if doc else 0,
            "quantidade_canceladas": doc.get("quantidade_canceladas", 0) if doc else 0,
            "total_tomadas": doc.get("total_tomadas", 0.0) if doc else 0.0,
            "total_retencao": doc.get("total_retencao", 0.0) if doc else 0.0,

            "quantidade_xmls_s3": doc.get("quantidade_xmls_s3", 0) if doc else 0,
            "quantidade_retencao": doc.get("quantidade_retencao", 0) if doc else 0,
            "notas_retencao": doc.get("notas_retencao", []) if doc else [],

            "status_leitura": doc.get("status_leitura") if doc else None,
            "conferencia": doc.get("conferencia") if doc else None, 
            "updated_at": ultima_data,
        })

    return {"tomadas": resultado}

@router.get("/tomadas/xml/{cod}")
def obter_tomadas_cliente(
        cod: int,
        mesano: str = Query(..., pattern=r"^\d{6}$"),
        user=Depends(get_current_user)
):
    cliente = colecao.find_one({"_id": cod, "ativo": True})
    if not cliente:
        raise HTTPException(404, f"Cliente {cod} não encontrado.")

    doc = coll_tomadas.find_one({
        "cod_cliente": cod,
        "mesano": mesano
    })

    if not doc:
        return {
            "cod_cliente": cod,
            "cnpj": cliente.get("cnpj", ""),
            "empresa": cliente.get("empresa", ""),
            "mesano": mesano,
            "quantidade_xmls_s3": 0,
            "quantidade_notas_validas": 0,
            "quantidade_canceladas": 0,
            "quantidade_retencao": 0,
            "total_tomadas": 0.0,
            "total_retencao": 0.0,
            "notas_retencao": [],
            "status_leitura": None,
            "conferencia": None, 
        }

    doc["_id"] = str(doc["_id"])

    for campo in ["created_at", "updated_at"]:
        if isinstance(doc.get(campo), datetime):
            doc[campo] = doc[campo].isoformat()

    return doc

@router.get("/tomadas/exportar/totais-empresas")
def exportar_tomadas_totais_empresas(
        mesano: str = Query(..., pattern=r"^\d{6}$"),
        user=Depends(get_current_user)
):
    """
    Exporta a visão principal de Tomadas.
    Uma linha por empresa/tomador.
    """
    colunas = [
        "Código",
        "Nome cliente (tomador)",
        "CNPJ cliente (tomador)",
        "Total serviço bruto",
        "Total retenção",
        "Total notas válidas",
        "Total notas canceladas",
        "Total notas com retenção",
        "Última atualização",
    ]

    linhas = []

    for cli in colecao.find({"ativo": True}).sort("_id", 1):
        cod = cli["_id"]

        doc = coll_tomadas.find_one({
            "cod_cliente": cod,
            "mesano": mesano
        }) or {}

        ultima = doc.get("updated_at") or doc.get("created_at")

        linhas.append([
            cod,
            doc.get("empresa") or cli.get("empresa", ""),
            formatar_cnpj_excel(doc.get("cnpj") or cli.get("cnpj", "")),
            numero_excel(doc.get("total_tomadas", 0.0)),
            numero_excel(doc.get("total_retencao", 0.0)),
            inteiro_excel(doc.get("quantidade_notas_validas", 0)),
            inteiro_excel(doc.get("quantidade_canceladas", 0)),
            inteiro_excel(doc.get("quantidade_retencao", 0)),
            formatar_data_excel(ultima),
        ])

    wb = criar_excel(
        nome_aba="Totais empresas",
        colunas=colunas,
        linhas=linhas,
        colunas_moeda=[4, 5]
    )

    return responder_excel(
        wb,
        f"tomadas_totais_empresas_{mesano}.xlsx"
    )

@router.get("/tomadas/exportar/retencoes")
def exportar_tomadas_retencoes(
        mesano: str = Query(..., pattern=r"^\d{6}$"),
        user=Depends(get_current_user)
):
    """
    Exporta as notas detalhadas com retenção.
    Uma linha por nota com retenção.
    """
    colunas = [
        "Código",
        "Nome cliente (tomador)",
        "CNPJ cliente (tomador)",
        "Número nota fiscal",
        "Nome emitente",
        "CNPJ emitente",
        "Competência",
        "Código de serviço",
        "Tributação ISSQN",
        "Tipo retenção ISSQN",
        "Valor serviço",
        "Valor retenção",
    ]

    linhas = []

    docs = coll_tomadas.find({"mesano": mesano}).sort("cod_cliente", 1)

    for doc in docs:
        cod = doc.get("cod_cliente")
        notas_retencao = doc.get("notas_retencao", []) or []

        for nota in notas_retencao:
            valor_retencao = numero_excel(nota.get("valor_retencao"), 0.0)

            if valor_retencao <= 0:
                continue

            linhas.append([
                cod,
                doc.get("empresa", ""),
                formatar_cnpj_excel(doc.get("cnpj", "")),
                nota.get("numero_nfse", ""),
                nota.get("emit_nome", ""),
                formatar_cnpj_excel(nota.get("emit_cnpj", "")),
                nota.get("data_competencia", ""),
                nota.get("codigo_servico", ""),
                nota.get("trib_issqn", ""),
                nota.get("tp_ret_issqn", ""),
                numero_excel(nota.get("valor_servico"), 0.0),
                valor_retencao,
            ])

    wb = criar_excel(
        nome_aba="Retencoes",
        colunas=colunas,
        linhas=linhas,
        colunas_moeda=[11, 12]
    )

    return responder_excel(
        wb,
        f"tomadas_retencoes_{mesano}.xlsx"
    )

#Planilha detalhada conversão xmls serviço
def bg_gerar_e_salvar_planilha_xml(mesano: str, clientes: list, caminho_pasta_rede: str):
    try:
        # Gera o buffer na memória (leva de 15 a 40 min)
        buffer = gerar_planilha_tomadas_xml_s3(mesano=mesano, clientes=clientes)
        
        # Garante que a pasta na rede existe
        os.makedirs(caminho_pasta_rede, exist_ok=True)
        
        caminho_arquivo = os.path.join(caminho_pasta_rede, f"tomadas_xml_convertido_{mesano}.xlsx")
        
        # Salva o arquivo fisicamente no caminho da rede
        with open(caminho_arquivo, "wb") as f:
            f.write(buffer.getvalue())
            
        logger.info(f"Planilha XML gerada com sucesso e salva em: {caminho_arquivo}")
    except Exception as e:
        logger.error(f"Erro ao gerar planilha XML em background: {str(e)}")


@router.get("/tomadas/exportar/xml-convertido")
def exportar_tomadas_xml_convertido(
        background_tasks: BackgroundTasks,
        mesano: str = Query(..., pattern=r"^\d{6}$"),
        user=Depends(get_current_user)
):
    """
    Inicia a conversão dos XMLs TOMADAS direto do S3 em background
    e salva na rede.
    """
    clientes = list(
        colecao.find({"ativo": True}).sort("_id", 1)
    )
    caminho_rede = r"Z:\SETOR FISCAL\AUTOMACAO\0.1 - XMLS ROTINA\RELATORIO XML TOMADOS" 

    # Coloca a função pesada na fila do background e libera o usuário na hora
    background_tasks.add_task(
        bg_gerar_e_salvar_planilha_xml,
        mesano=mesano,
        clientes=clientes,
        caminho_pasta_rede=caminho_rede
    )

    return {
        "status": "sucesso", 
        "mensagem": "Geração da planilha iniciada com sucesso em segundo plano.\n\nEste processo não trava a sua tela e pode levar de 15 a 40 minutos. Quando finalizado, o arquivo aparecerá automaticamente na pasta(RELATORIO XML TOMADOS) da rede."
    }
