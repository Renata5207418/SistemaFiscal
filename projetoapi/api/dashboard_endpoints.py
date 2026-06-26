from fastapi import APIRouter, Depends, Query, HTTPException
import logging
from typing import List, Dict, Any
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pydantic import BaseModel
from bson import ObjectId
from login.auth import get_current_user
from services.tabelas_service import TabelasService
from api.automacao_routes.emitidas import faturamento_dominio_sql
from database.database import (
    get_pre_cadastro_collection,
    get_valordeclarado_collection,
    get_guias_enviadas_collection,
    get_certificados_collection,
    get_faturamentos_collection,
    get_tarefas_mensais_collection
)
from database.db_dominio import DatabaseConnection

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
logger = logging.getLogger(__name__)



class ToggleTaskPayload(BaseModel):
    concluido: bool



# ====================================================================
# 1. ROTAS DE TABELA (Controle Mensal Frontend)
# ====================================================================
@router.get("/v2/tabelas/faturamento")
def tabela_faturamento_v2(mesano: str = Query(..., regex=r"^\d{6}$"), user=Depends(get_current_user)):
    service = TabelasService()
    return {"dados": service.obter_dados_faturamento(mesano)}

@router.get("/v2/tabelas/declaracao")
def tabela_declaracao_v2(mesano: str = Query(..., regex=r"^\d{6}$"), user=Depends(get_current_user)):
    service = TabelasService()
    return {"dados": service.obter_dados_declaracao(mesano)}


# ====================================================================
# 2. ROTAS DO DASHBOARD EXECUTIVO
# ====================================================================
@router.get("/v2/geral")
@lru_cache(maxsize=16) 
def dashboard_visao_geral(mesano: str = Query(..., regex=r"^\d{6}$")):
    pre_cad = get_pre_cadastro_collection()
    clientes_ativos = {doc["_id"]: doc for doc in pre_cad.find({"ativo": True})}
    
    # 1. CERTIFICADOS
    cert_col = get_certificados_collection()
    certificados_vencidos = 0
    certificados_atencao = 0 
    hoje = datetime.now()
    limite_atencao = hoje + timedelta(days=30)

    todos_certs = list(cert_col.find())
    cert_docs = {int(c["ClientID"]): c for c in todos_certs if str(c.get("ClientID", "")).isdigit()}

    for cod in clientes_ativos:
        c = cert_docs.get(cod, {})
        status = c.get("Status", "Não vinculado")
        validade_raw = c.get("Validade")

        if status in ["Vencido", "Não vinculado"] or not validade_raw or validade_raw == "Sem certificado":
            certificados_vencidos += 1
        else:
            data_validade = None
            if isinstance(validade_raw, datetime):
                data_validade = validade_raw
            else:
                validade_str = str(validade_raw).split(' ')[0]
                for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
                    try:
                        data_validade = datetime.strptime(validade_str, fmt)
                        break
                    except: continue
            
            if data_validade and hoje < data_validade <= limite_atencao:
                certificados_atencao += 1

    # 2. FATOR R 
    fator_r_risco = 0
    fator_r_atencao = 0
    try:
        ano_int, mes_int = int(mesano[:4]), int(mesano[4:])
        db = DatabaseConnection() 
        db.connect()
        resultados_fator_r = db.get_fator_r_dados(ano_int, mes_int)
        db.close()
        
        if resultados_fator_r:
            vistos = set() 
            for row in resultados_fator_r:
                cod_str = str(row[0])
                if cod_str not in vistos: 
                    vistos.add(cod_str)
                    fator_val = round(float(row[3]) if row[1] else 0.0, 2)
                    
                    if fator_val < 2800:
                        fator_r_risco += 1
                    elif 2800 <= fator_val <= 3000:
                        fator_r_atencao += 1
    except Exception as e:
        logger.error(f"Erro no Fator R do Dashboard: {e}")

    # 3. MOVIMENTAÇÃO
    clientes_rotina_ids = [doc["_id"] for doc in clientes_ativos.values() if doc.get("rotina", True)]
    coll_fat = get_faturamentos_collection()
    faturamentos_atual = list(coll_fat.find({"mesano": mesano, "cod_cliente": {"$in": clientes_rotina_ids}}))
    
    com_movimento = sum(1 for fat in faturamentos_atual if fat.get("total_valor_servicos", 0.0) > 0)
    sem_movimento = len(clientes_rotina_ids) - com_movimento

    # 4. SEM MOVIMENTO (3 Meses)
    meses_3 = []
    dt_cur = datetime(int(mesano[:4]), int(mesano[4:]), 1)
    for _ in range(3):
        meses_3.append(dt_cur.strftime("%Y%m"))
        dt_cur = (dt_cur - timedelta(days=1)).replace(day=1)
        
    xml_soma_3m = {cod: 0.0 for cod in clientes_rotina_ids}
    faturamentos_3m = list(coll_fat.find({"mesano": {"$in": meses_3}, "cod_cliente": {"$in": clientes_rotina_ids}}))
    
    for fat in faturamentos_3m:
        if fat["cod_cliente"] in xml_soma_3m:
            xml_soma_3m[fat["cod_cliente"]] += fat.get("total_valor_servicos", 0.0)
                
    counts_3m = {}
    for cod, total in xml_soma_3m.items():
        if total == 0.0:
            regime = clientes_ativos[cod].get("regime_tributario", "Outros")
            counts_3m[regime] = counts_3m.get(regime, 0) + 1

    return {
        "kpis": {
            "certificados_vencidos": certificados_vencidos,
            "certificados_atencao": certificados_atencao,
            "fator_r_risco": fator_r_risco,
            "fator_r_atencao": fator_r_atencao 
        },
        "movimento_mes": {"labels": ["Com Movimento", "Sem Movimento"], "series": [com_movimento, sem_movimento]},
        "sem_mov_3m": {"labels": list(counts_3m.keys()), "series": list(counts_3m.values())}
    }


@router.get("/v2/simples")
@lru_cache(maxsize=16) 
def dashboard_simples(mesano: str = Query(..., regex=r"^\d{6}$")):
    pre_cad = get_pre_cadastro_collection()
    sn_clients = {doc["_id"] for doc in pre_cad.find({"ativo": True, "rotina": True, "regime_tributario": "Simples Nacional"})}
    total_sn = len(sn_clients)
    if total_sn == 0: return {"onvio": {"postadas": 0, "total": 0}, "dif_fat": {"labels": [], "series": []}, "dif_dec": {"labels": [], "series": []}}

    # 1. KPI: GUIAS NO ONVIO
    guias_docs = list(get_guias_enviadas_collection().find({"mesano": mesano, "cod_cliente": {"$in": list(sn_clients)}}))
    clientes_onvio = set()
    for doc in guias_docs:
        pgdas_ok = doc.get("pgdas", {}).get("publicado_onvio") == True
        das_ok = doc.get("das", {}).get("publicado_onvio") == True
        if pgdas_ok or das_ok:
            clientes_onvio.add(doc["cod_cliente"])
    guias_onvio = len(clientes_onvio)

    # 2. DIFERENÇA DE FATURAMENTO 
    coll_fat = get_faturamentos_collection()
    faturamentos_mongo = list(coll_fat.find({"mesano": mesano, "cod_cliente": {"$in": list(sn_clients)}}))
    xml_soma = {fat["cod_cliente"]: fat.get("total_valor_servicos", 0.0) for fat in faturamentos_mongo}
    
    dominio_soma = {d["cod_cliente"]: d["total_faturamento"] for d in faturamento_dominio_sql(mesano) if d["cod_cliente"] in sn_clients}
    
    com_diff_fat = sum(1 for cod in sn_clients if round(abs(xml_soma.get(cod, 0.0) - dominio_soma.get(cod, 0.0)), 2) != 0.0)
    sem_diff_fat = total_sn - com_diff_fat

    # 3. DIFERENÇA DE DECLARAÇÃO
    salvos = list(get_valordeclarado_collection().find({"mesano": mesano, "cod_cliente": {"$in": list(sn_clients)}}))
    
    ano, mes = int(mesano[:4]), int(mesano[4:])
    data_sim = f"{ano}-{mes:02d}-01"
    
    db = DatabaseConnection() 
    db.connect()
    imp_map = db.get_impostos_apurados_mensal(data_sim)
    db.close()

    sem_diff_dec = com_diff_dec = verificar_dec = 0
    
    for doc in salvos:
        cod = doc["cod_cliente"]
        decl = doc.get("declarado")
        
        try:
            num = decl if isinstance(decl, (int, float)) else float(str(decl).replace(".", "").replace(",", "."))
            dif = round(num - imp_map.get(cod, 0.0), 2)
            if abs(dif) == 0.0: sem_diff_dec += 1
            else: com_diff_dec += 1
        except:
            verificar_dec += 1

    nao_declarados = total_sn - (sem_diff_dec + com_diff_dec + verificar_dec)

    return {
        "onvio": {"postadas": guias_onvio, "total": total_sn},
        "dif_fat": {"labels": ["Sem Diferença", "Com Diferença"], "series": [sem_diff_fat, com_diff_fat]},
        "dif_dec": {"labels": ["Sem Diferença", "Com Diferença", "Verificar", "Não Declarado"], "series": [sem_diff_dec, com_diff_dec, verificar_dec, nao_declarados]}
    }


@router.get("/v2/regime-normal")
@lru_cache(maxsize=16) 
def dashboard_regime_normal(mesano: str = Query(..., regex=r"^\d{6}$")):
    pre_cad = get_pre_cadastro_collection()
    rn_clients = {doc["_id"] for doc in pre_cad.find({"ativo": True, "rotina": True, "regime_tributario": {"$ne": "Simples Nacional"}})}
    if len(rn_clients) == 0: return {"dif_fat": {"labels": [], "series": []}}
    
    coll_fat = get_faturamentos_collection()
    faturamentos_mongo = list(coll_fat.find({"mesano": mesano, "cod_cliente": {"$in": list(rn_clients)}}))
    xml_soma = {fat["cod_cliente"]: fat.get("total_valor_servicos", 0.0) for fat in faturamentos_mongo}
    
    dominio_soma = {d["cod_cliente"]: d["total_faturamento"] for d in faturamento_dominio_sql(mesano) if d["cod_cliente"] in rn_clients}
    
    com_diff = sum(1 for cod in rn_clients if round(abs(xml_soma.get(cod, 0.0) - dominio_soma.get(cod, 0.0)), 2) != 0.0)
    sem_diff = len(rn_clients) - com_diff

    return {
        "dif_fat": {"labels": ["Sem Diferença", "Com Diferença"], "series": [sem_diff, com_diff]}
    }


# ====================================================================
# 3. ROTAS DE TAREFAS MENSAIS (CHECKLIST DO ESCRITÓRIO)
# ====================================================================

@router.get("/v2/tarefas-mensais")
def obter_tarefas_mensais(mesano: str = Query(..., regex=r"^\d{6}$"), user=Depends(get_current_user)):
    col = get_tarefas_mensais_collection()
    tarefas = list(col.find({"mesano": mesano}).sort([("onda", 1), ("_id", 1)]))

    # Inteligência: Se o mês virou e não tem tarefas, o backend cria a partir do modelo padrão!
    if not tarefas:
        template = [
            {"onda": 1, "prazo": "Dias 1 ao 10", "descricao": "Rotina Domínio"},
            {"onda": 1, "prazo": "Dias 1 ao 10", "descricao": "Reinf sem movimento"},
            {"onda": 1, "prazo": "Dias 1 ao 10", "descricao": "Aliquota efetiva"},            
            {"onda": 1, "prazo": "Dias 1 ao 10", "descricao": "Apuração em lote"},
            {"onda": 1, "prazo": "Dias 1 ao 10", "descricao": "Foco conferência Simples Nacional"},
            {"onda": 2, "prazo": "Dias 11 ao 20", "descricao": "Rodar atualização do faturamento"},
            {"onda": 2, "prazo": "Dias 11 ao 20", "descricao": "Conferência Lucro Presumido"},
            {"onda": 2, "prazo": "Dias 11 ao 20", "descricao": "Transmitir DCTFWeb"},
            {"onda": 3, "prazo": "Dias 21 ao 31", "descricao": "Manutenção Zenga "},
            {"onda": 3, "prazo": "Dias 21 ao 31", "descricao": "Manutenção rotina Domínio"},
            {"onda": 3, "prazo": "Dias 21 ao 31", "descricao": "Manutenção certificados/clientes"},
            {"onda": 3, "prazo": "Dias 21 ao 31", "descricao": "Manutenção planilhas de controle"},
            {"onda": 3, "prazo": "Dias 21 ao 31", "descricao": "Limpeza de pastas e arquivos temporários"},
        ]
        
        now = datetime.now(timezone.utc)
        novas_tarefas = []
        for t in template:
            novas_tarefas.append({
                "mesano": mesano,
                "onda": t["onda"],
                "prazo": t["prazo"],
                "descricao": t["descricao"],
                "concluido": False,
                "created_at": now,
                "updated_at": now,
                "updated_by": None
            })

        if novas_tarefas:
            col.insert_many(novas_tarefas)
            tarefas = list(col.find({"mesano": mesano}).sort([("onda", 1), ("_id", 1)]))

    resultado = []
    for t in tarefas:
        t["_id"] = str(t["_id"])
        # Garante que a data de atualização seja enviada como string
        if t.get("updated_at") and isinstance(t["updated_at"], datetime):
            t["updated_at"] = t["updated_at"].isoformat()
        resultado.append(t)

    return {"data": resultado}


@router.put("/v2/tarefas-mensais/{task_id}")
def toggle_tarefa_mensal(task_id: str, payload: ToggleTaskPayload, user=Depends(get_current_user)):
    col = get_tarefas_mensais_collection()
    
    res = col.update_one(
        {"_id": ObjectId(task_id)},
        {"$set": {
            "concluido": payload.concluido,
            "updated_at": datetime.now(timezone.utc),
            "updated_by": user.get("username", "Sistema")
        }}
    )
    
    if res.modified_count == 0:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada ou não sofreu alteração.")
        
    return {"success": True}