import re
from decimal import Decimal
from datetime import datetime
from pathlib import Path

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from database.database import (
    get_pre_cadastro_collection,
    get_faturamentos_collection,
    get_valordeclarado_collection,
    get_guias_enviadas_collection,
    get_certificados_collection,
)
from database.db_dominio import DatabaseConnection
from login.auth import get_current_user
from services.faturamento_service import FaturamentoService
from services.tabelas_service import TabelasService


router = APIRouter(tags=["automacao-paineis"])

colecao = get_pre_cadastro_collection()
coll_fat = get_faturamentos_collection()


def limpar_para_json(obj):
    """
    Converte objetos que podem quebrar o retorno JSON do FastAPI.
    Evita problema com datetime, ObjectId, Decimal, set, Path etc.
    """
    if obj is None:
        return None

    if isinstance(obj, ObjectId):
        return str(obj)

    if isinstance(obj, datetime):
        return obj.isoformat()

    if isinstance(obj, Decimal):
        return float(obj)

    if isinstance(obj, Path):
        return str(obj)

    if isinstance(obj, set):
        return [limpar_para_json(item) for item in obj]

    if isinstance(obj, tuple):
        return [limpar_para_json(item) for item in obj]

    if isinstance(obj, list):
        return [limpar_para_json(item) for item in obj]

    if isinstance(obj, dict):
        return {
            str(k): limpar_para_json(v)
            for k, v in obj.items()
        }

    return obj


def fechar_db_seguro(db):
    try:
        db.close()
    except Exception:
        pass


@router.get("/painel-geral-sn")
def painel_geral_sn(
        mesano: str = Query(..., pattern=r"^\d{6}$"),
        user=Depends(get_current_user)
):
    tab_service = TabelasService()
    dados_faturamento = tab_service.obter_dados_faturamento(mesano)

    dados_faturamento_map = {
        item.get("cod_cliente"): item
        for item in dados_faturamento
        if item.get("cod_cliente") is not None
    }

    xml_map = {
        d["cod_cliente"]: d
        for d in coll_fat.find({"mesano": mesano})
    }

    ano, mes = int(mesano[:4]), int(mesano[4:])
    data_sim = f"{ano}-{mes:02d}-01"

    db = DatabaseConnection()

    try:
        db.connect()

        lista_apurados = db.get_todas_apuracoes_mensal(data_sim)
        imposto_map = db.get_impostos_apurados_mensal(data_sim)

        fator_r_raw = db.get_fator_r_dados(ano, mes)

    finally:
        fechar_db_seguro(db)

    mapa_fator_r = {}

    if fator_r_raw:
        for row in fator_r_raw:
            cod_emp = row[0]
            percentual = round(float(row[3]) if row[3] else 0.0, 2)
            mapa_fator_r[cod_emp] = percentual

    dec_map = {
        d["cod_cliente"]: d
        for d in get_valordeclarado_collection().find({"mesano": mesano}).sort("created_at", 1)
    }

    guias_map = {
        g["cod_cliente"]: g
        for g in get_guias_enviadas_collection().find({"mesano": mesano})
    }

    clientes_sn = list(
        colecao.find({
            "ativo": True,
            "rotina": True,
            "regime_tributario": "Simples Nacional"
        }).sort("_id", 1)
    )

    col_certs = get_certificados_collection()

    mapa_certs = {
        doc["_id"]: doc
        for doc in col_certs.find({})
    }

    resultado = []

    for cli in clientes_sn:
        cod = cli["_id"]

        xml_doc = xml_map.get(cod, {})
        dec_doc = dec_map.get(cod, {})
        guia_doc = guias_map.get(cod, {})

        fat_dom_doc = dados_faturamento_map.get(cod, {})

        total_xml = xml_doc.get(
            "total_valor_servicos",
            fat_dom_doc.get("tooltip_portal", 0.0)
        )

        total_dom = fat_dom_doc.get("tooltip_dominio", 0.0)

        try:
            total_xml = float(total_xml or 0.0)
        except Exception:
            total_xml = 0.0

        try:
            total_dom = float(total_dom or 0.0)
        except Exception:
            total_dom = 0.0

        declarado = dec_doc.get("declarado")

        dif_dec = (
            round(float(declarado) - float(imposto_map.get(cod, 0.0)), 2)
            if isinstance(declarado, (int, float))
            else "verificar"
        )

        erro_txt = None

        mensagens = (
            (dec_doc.get("retorno") or {})
            .get("serpro_body", {})
            .get("mensagens")
        )

        if mensagens and isinstance(mensagens, list) and len(mensagens) > 0:
            erro_txt = mensagens[0].get("texto")

        cnpj_limpo = re.sub(r"\D", "", cli.get("cnpj", ""))
        cert = mapa_certs.get(cnpj_limpo)

        cert_status = cert.get("Status", "Não Vinculado") if cert else "Sem certificado"
        cert_validade = cert.get("Validade", "-") if cert else "-"

        if cert_validade and "-" in cert_validade:
            try:
                ano_v, mes_v, dia_v = cert_validade.split("-")
                cert_validade = f"{dia_v}/{mes_v}/{ano_v}"
            except Exception:
                pass

        resultado.append({
            "cod": cod,
            "grupo": cli.get("grupo", "Sem grupo"),
            "cnpj": cli.get("cnpj", ""),
            "empresa": cli.get("empresa", ""),

            "ultima": xml_doc.get("updated_at") or fat_dom_doc.get("updated_at"),

            "total": total_xml,
            "dominio": total_dom,
            "diferenca": round(total_xml - total_dom, 2),

            "cTribNac": xml_doc.get("cTribNac", []),

            "apuracao": "Sim" if cod in lista_apurados else "Não",

            "declarado": declarado,
            "dif_declaracao": dif_dec,
            "imposto_dominio": imposto_map.get(cod, 0.0),
            "erro_texto": erro_txt,
            "data_declaracao": dec_doc.get("created_at"),

            "guia_enviada": "Sim" if guia_doc.get("guia_enviada") else "Não",
            "pgdas_onvio": guia_doc.get("pgdas", {}).get("publicado_onvio", False),
            "das_onvio": guia_doc.get("das", {}).get("publicado_onvio", False),
            "conferencia": guia_doc.get("conferencia", {"status": False}),

            "cert_status": cert_status,
            "cert_validade": cert_validade,

            "fator_r_percentual": mapa_fator_r.get(cod)
        })

    return JSONResponse(content=limpar_para_json({"faturas": resultado}))


@router.get("/painel-geral-rn")
def painel_geral_rn(
        mesano: str = Query(..., pattern=r"^\d{6}$"),
        user=Depends(get_current_user)
):
    data_sim = f"{mesano[:4]}-{mesano[4:]}-01"

    db = DatabaseConnection()

    try:
        db.connect()

        lista_apurados = db.get_todas_apuracoes_mensal(data_sim)

        fat_service = FaturamentoService()

        mapa_dominio = {
            d["cod_cliente"]: d["total_faturamento"]
            for d in fat_service.obter_faturamento_dominio(mesano)
        }

    finally:
        fechar_db_seguro(db)

    xml_map = {
        d["cod_cliente"]: d
        for d in coll_fat.find({"mesano": mesano})
    }

    guias_map = {
        g["cod_cliente"]: g
        for g in get_guias_enviadas_collection().find({"mesano": mesano})
    }

    col_certs = get_certificados_collection()

    mapa_certs = {
        doc["_id"]: doc
        for doc in col_certs.find({})
    }

    clientes_rn = list(
        colecao.find({
            "ativo": True,
            "rotina": True,
            "regime_tributario": {"$ne": "Simples Nacional"}
        }).sort("_id", 1)
    )

    resultado = []

    for cli in clientes_rn:
        cod = cli["_id"]

        xml_doc = xml_map.get(cod, {})
        guia_doc = guias_map.get(cod, {})

        cnpj_limpo = re.sub(r"\D", "", cli.get("cnpj", ""))
        cert = mapa_certs.get(cnpj_limpo)

        cert_status = cert.get("Status", "Não Vinculado") if cert else "Sem certificado"
        cert_validade = cert.get("Validade", "-") if cert else "-"

        if cert_validade and "-" in cert_validade:
            try:
                ano_v, mes_v, dia_v = cert_validade.split("-")
                cert_validade = f"{dia_v}/{mes_v}/{ano_v}"
            except Exception:
                pass

        val_total = xml_doc.get("total_valor_servicos", 0.0)
        val_dominio = mapa_dominio.get(cod, xml_doc.get("valor_dominio", 0.0))

        total = Decimal(str(val_total or 0.0))
        dominio = Decimal(str(val_dominio or 0.0))
        diferenca = total - dominio

        resultado.append({
            "cod": cod,
            "grupo": cli.get("grupo", "Sem grupo"),
            "cnpj": cli.get("cnpj", ""),
            "empresa": cli.get("empresa", ""),
            "regime": cli.get("regime_tributario", "Não informado"),

            "ultima": xml_doc.get("updated_at"),
            "total": float(total),
            "dominio": float(dominio),
            "diferenca": float(diferenca),

            "cTribNac": xml_doc.get("cTribNac", []),

            "apuracao": "Sim" if cod in lista_apurados else "Não",
            "conferencia": guia_doc.get("conferencia", {"status": False}),

            "cert_status": cert_status,
            "cert_validade": cert_validade,
        })

    return JSONResponse(content=limpar_para_json({"faturas": resultado}))
