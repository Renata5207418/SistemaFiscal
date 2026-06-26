from datetime import datetime

from fastapi import APIRouter, Depends, Query, Body

from database.database import get_pre_cadastro_collection
from database.db_dominio import DatabaseConnection
from login.auth import get_current_user
from repositories.dominio_repository import DominioRepository
from services.tabelas_service import TabelasService
from api.automacao_routes.schemas import EnquadramentoPayload


router = APIRouter(tags=["automacao-tabelas"])

colecao = get_pre_cadastro_collection()


@router.get("/faturamento_valor_imposto_sql")
def faturamento_valor_imposto_sql(mesano: str = Query(..., regex=r"^\d{6}$")):
    ano = mesano[:4]
    mes = mesano[4:]
    data_sim = f"{ano}-{mes}-01"

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

    return [
        {
            "cod_cliente": row[0],
            "valor_imposto": float(str(row[1]).replace(",", "."))
        }
        for row in resultados or []
    ]


@router.post("/enquadramentosn", summary="Verifica enquadramento Simples Nacional")
def enquadramento_simples(
    payload: EnquadramentoPayload = Body(...),
    user=Depends(get_current_user)
):
    pre_cad = get_pre_cadastro_collection()

    if not payload.codi_emps:
        docs = pre_cad.find(
            {"ativo": True, "regime_tributario": "Simples Nacional"},
            {"_id": 1}
        )
        codi_list = [d["_id"] for d in docs]
    else:
        codi_list = payload.codi_emps

    ano, mes, _ = map(int, payload.date.split("-"))

    db = DatabaseConnection()
    db.connect()
    resultados = db.get_faturamento_acumulado(codi_list, ano, mes)
    db.close()

    resposta = []

    for codi, total in resultados:
        projetado = total / mes * 12

        if projetado <= 4_800_000:
            status = "Enquadra"
        elif projetado <= 5_760_000:
            status = "Excluída a partir do próximo ano"
        else:
            status = "Excluída retroativamente"

        doc = pre_cad.find_one({"_id": codi}, {"empresa": 1})
        nome = doc["empresa"] if doc else None

        resposta.append({
            "codi_emp": codi,
            "nome_emp": nome,
            "total_acumulado": round(total, 2),
            "projetado_anual": round(projetado, 2),
            "status": status
        })

    return {"results": resposta}


@router.get("/v2/dominio/apuracao")
def apuracao_dominio_v2(
    mesano: str = Query(..., regex=r"^\d{6}$"),
    user=Depends(get_current_user)
):
    ano, mes = int(mesano[:4]), int(mesano[4:])
    data_sim = datetime(ano, mes, 1).strftime("%Y-%m-%d")

    repo = DominioRepository()
    resultados = repo.get_todas_apuracoes_mensal(data_sim)
    mapa_apurados = {row[0]: row[1] for row in (resultados or [])}

    lista_apuracao = []

    for cli in colecao.find({"ativo": True, "rotina": True}).sort("_id", 1):
        cod = cli["_id"]
        qtd = mapa_apurados.get(cod, 0)
        apurado = "Sim" if qtd > 0 else "Não"

        lista_apuracao.append({
            "cod_cliente": cod,
            "empresa": cli.get("empresa", "Sem Nome"),
            "apurado": apurado,
            "valor_dominio": 0
        })

    return {"data": lista_apuracao, "success": True}


@router.get("/v2/tabelas/faturamento")
def tabela_faturamento_v2(
    mesano: str = Query(..., regex=r"^\d{6}$"),
    user=Depends(get_current_user)
):
    service = TabelasService()
    return {"dados": service.obter_dados_faturamento(mesano)}


@router.get("/v2/tabelas/declaracao")
def tabela_declaracao_v2(
    mesano: str = Query(..., regex=r"^\d{6}$"),
    user=Depends(get_current_user)
):
    service = TabelasService()
    return {"dados": service.obter_dados_declaracao(mesano)}


@router.get("/fator-r")
def consultar_fator_r(
    mesano: str = Query(..., regex=r"^\d{6}$"),
    user=Depends(get_current_user)
):
    ano, mes = int(mesano[:4]), int(mesano[4:])

    db = DatabaseConnection()
    db.connect()
    resultados = db.get_fator_r_dados(ano, mes)
    db.close()

    lista = []

    if resultados:
        for row in resultados:
            lista.append({
                "cod": row[0],
                "empresa": row[1],
                "cnpj": row[2],
                "fator_r_percentual": round(float(row[3]) if row[3] else 0.0, 2),
                "anexo": row[4],
                "descricao_tabela": row[5]
            })

    return {"data": lista}