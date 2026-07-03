import sys
import logging
import time
import os
import re
import concurrent.futures
from datetime import datetime, timedelta, timezone
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from logging.handlers import RotatingFileHandler
from database.database import (
    get_pre_cadastro_collection, 
    get_tasks_collection, 
    get_tasksfaturamentos_collection,
    get_taskstomadas_collection,
    get_certificados_collection, 
    get_faturamentos_collection,
    get_guias_enviadas_collection,
    get_valordeclarado_collection
)
from automacao.runner import (
    processar_empresa_mes,
    processar_task_manual,
    processar_task_manual_tomadas,
    reprocessar_faturamento_mensal,
    reprocessar_tomadas_mensal,
)
from database.db_dominio import DatabaseConnection
from automacao.aws_s3 import listar_xmls_mes
from automacao.envioonvio import listar_nomes_com_data

# starta o scheduler: python -m automacao.scheduler // python -m automacao.scheduler --run-now
# ==============================================================================
# --- CONFIGURAÇÃO DE LOGS DO SCHEDULER ---
# ==============================================================================
os.makedirs("local_storage/logs", exist_ok=True)
log_file = "local_storage/logs/automacao_scheduler.log"

file_handler = RotatingFileHandler(
    log_file,
    mode='a',
    maxBytes=5 * 1024 * 1024, # Limite de 5MB
    backupCount=5,
    encoding="utf-8"
)
console_handler = logging.StreamHandler()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[file_handler, console_handler],
    force=True
)
# ---------------------------------------------------------
# 1. JOBS DE ENFILEIRAMENTO (GERENTES)
# ---------------------------------------------------------

def job_busca_mensal():
    """
    Em vez de processar, apenas enfileira as tarefas de busca de XML.
    """
    print(">>> ENTROU NO JOB <<<")
    agora = datetime.now(timezone.utc)
    # Pega o mês passado
    mesano = (agora.replace(day=1) - timedelta(days=1)).strftime("%Y%m")

    logging.info(f"[Scheduler] Iniciando ENFILEIRAMENTO de Busca Mensal (Download XML) para {mesano}")
    
    colecao = get_pre_cadastro_collection()
    tasks_col = get_tasks_collection()
    clientes = list(colecao.find({"ativo": True}).sort("_id", 1))
    print(f">>> CLIENTES ENCONTRADOS: {len(clientes)} <<<")

    if not clientes:
        logging.warning("[Scheduler] Nenhum cliente ativo encontrado.")
        return

    adicionados = 0
    for doc in clientes:
        cod = doc.get("_id")
        
        # Evita duplicidade se o job rodar duas vezes sem querer
        existente = tasks_col.find_one({"cliente_cod": cod, "mesano": mesano, "tipo": "rotina"})
        if existente and existente.get("status") not in ["concluído", "em_andamento"]:
            tasks_col.update_one(
                {"_id": existente["_id"]},
                {"$set": {"status": "pendente", "updated_at": agora}}
            )
            continue
        elif existente:
             continue

        tasks_col.insert_one({
            "cliente_cod": cod,
            "empresa": doc.get("empresa", ""),
            "cnpj": doc.get("cnpj", ""),
            "inscricao_municipal": doc.get("inscricao_municipal", ""),
            "mesano": mesano,
            "status": "pendente",
            "tipo": "rotina", 
            "username": "Rotina Automática",
            "created_at": agora,
            "updated_at": agora
        })
        adicionados += 1

    logging.info(f"[Scheduler] {adicionados} clientes adicionados à fila de Busca Mensal.")


def job_atualiza_faturamento():
    agora = datetime.now(timezone.utc)
    mesano = (agora.replace(day=1) - timedelta(days=1)).strftime("%Y%m")

    logging.info(f"[Scheduler] Iniciando ENFILEIRAMENTO de Atualização de Faturamento para {mesano}")
    
    colecao = get_pre_cadastro_collection()
    fat_tasks = get_tasksfaturamentos_collection()
    
    clientes = list(colecao.find({"ativo": True, "rotina": True}).sort("_id", 1))

    if not clientes:
        logging.warning("[Scheduler] Nenhum cliente ativo/rotina encontrado para faturamento.")
        return

    adicionados = 0
    for doc in clientes:
        cod = doc.get("_id")
        
        # Evita duplicidade
        existente = fat_tasks.find_one({"cliente_cod": cod, "mesano": mesano, "tipo": "xml"})
        if existente:
            continue

        fat_tasks.insert_one({
            "cliente_cod": cod,
            "empresa": doc.get("empresa", ""),
            "cnpj": doc.get("cnpj", ""),
            "mesano": mesano,
            "status": "pendente",
            "tipo": "xml", 
            "username": "Rotina Automática",
            "created_at": agora,
            "updated_at": agora
        })
        adicionados += 1

    logging.info(f"[Scheduler] {adicionados} clientes adicionados à fila de Faturamento.")


def job_atualiza_tomadas():
    """
    Enfileira tarefas de atualização de NFSe TOMADAS para o mês anterior.
    Não processa aqui; só cria registros na collection tasks_tomadas.
    """
    agora = datetime.now(timezone.utc)
    mesano = (agora.replace(day=1) - timedelta(days=1)).strftime("%Y%m")

    logging.info(f"[Scheduler][TOMADAS] Iniciando ENFILEIRAMENTO de Tomadas para {mesano}")

    colecao = get_pre_cadastro_collection()
    tomadas_tasks = get_taskstomadas_collection()

    clientes = list(colecao.find({"ativo": True, "rotina": True}).sort("_id", 1))

    if not clientes:
        logging.warning("[Scheduler][TOMADAS] Nenhum cliente ativo/rotina encontrado.")
        return

    adicionados = 0

    for doc in clientes:
        cod = doc.get("_id")

        # Evita duplicar pendente/em andamento.
        # Se já concluiu, não recria automaticamente no scheduler mensal.
        # Atualização manual pela tela continua podendo gerar nova task depois.
        existente = tomadas_tasks.find_one({
            "cliente_cod": cod,
            "mesano": mesano,
            "tipo": "xml_tomadas",
            "status": {"$in": ["pendente", "em_andamento", "concluído"]}
        })

        if existente:
            continue

        tomadas_tasks.insert_one({
            "cliente_cod": cod,
            "empresa": doc.get("empresa", ""),
            "cnpj": doc.get("cnpj", ""),
            "mesano": mesano,
            "status": "pendente",
            "tipo": "xml_tomadas",
            "username": "Rotina Automática",
            "created_at": agora,
            "updated_at": agora,
            "error_msg": None,
        })

        adicionados += 1

    logging.info(f"[Scheduler][TOMADAS] {adicionados} clientes adicionados à fila de Tomadas.")


# ---------------------------------------------------------
# 2. JOB DE SINCRONIZAÇÃO 
# ---------------------------------------------------------
def job_sincronizacao_inteligente():
    agora = datetime.now(timezone.utc)
    mesano = (agora.replace(day=1) - timedelta(days=1)).strftime("%Y%m")

    tasks_emitidas = get_tasks_collection()
    tomadas_tasks = get_taskstomadas_collection()

    rotinas_pesadas_em_aberto = (
        tasks_emitidas.count_documents({
            "mesano": mesano,
            "tipo": "rotina",
            "status": {"$in": ["pendente", "em_andamento"]}
        })
        +
        tomadas_tasks.count_documents({
            "mesano": mesano,
            "tipo": "xml_tomadas",
            "status": {"$in": ["pendente", "em_andamento"]}
        })
    )

    if rotinas_pesadas_em_aberto > 0:
        logging.info(
            f"[Sync Smart] Pulando execução porque há rotinas pesadas em aberto "
            f"para mesano={mesano}: {rotinas_pesadas_em_aberto}"
        )
        return

    
    logging.info(f"[Sync Smart] Iniciando verificação de delta para {mesano} com multi-threading...")

    pre_cad = get_pre_cadastro_collection()
    coll_fat = get_faturamentos_collection()
    clientes = list(pre_cad.find({"ativo": True, "rotina": True}).sort("_id", 1))
    
    if not clientes:
        return

    def verificar_cliente(doc):
        cod = doc.get("_id")
        cnpj = doc.get("cnpj")
        nome = doc.get("empresa", "Sem nome")
        
        if not cnpj:
            return 0
            
        cnpj_limpo = re.sub(r"\D", "", str(cnpj))
        mes_aws = f"{mesano[:4]}-{mesano[4:]}"
        
        try:
            arquivos_s3 = listar_xmls_mes(cnpj_limpo, mes_aws)
            qtd_aws = len(arquivos_s3)
            
            doc_mongo = coll_fat.find_one({"cod_cliente": cod, "mesano": mesano})
            qtd_mongo = doc_mongo.get("quantidade_notas", 0) if doc_mongo else 0
            
            if qtd_aws > qtd_mongo:
                logging.info(f"[Sync Smart] Delta detectado | Cliente {cod} ({nome}) | AWS: {qtd_aws} vs Mongo: {qtd_mongo}. Atualizando...")
                reprocessar_faturamento_mensal(cod, mesano)
                
                coll_fat.update_one(
                    {"cod_cliente": cod, "mesano": mesano},
                    {"$set": {"updated_at": datetime.now(timezone.utc)}}
                )
                return 1
        except Exception as e:
            logging.error(f"[Sync Smart] Erro ao verificar cliente {cod}: {e}")
        return 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        resultados = list(executor.map(verificar_cliente, clientes))

    sucessos = sum(resultados)
    logging.info(f"[Sync Smart] Finalizado. {sucessos} clientes foram reprocessados por divergência de notas.")


# ---------------------------------------------------------
# 3. VERIFICAÇÕES ISOLADAS
# ---------------------------------------------------------
def job_verificar_validade_certificados():
    logging.info("[Scheduler] Iniciando verificação de validade dos certificados...")
    col_cert = get_certificados_collection()
    hoje_str = datetime.now().strftime("%Y-%m-%d")
    filtro = {"Status": "Válido", "Validade": {"$lt": hoje_str}}
    atualizacao = {"$set": {"Status": "Vencido", "Ativo": False, "Validate": False}}
    try:
        resultado = col_cert.update_many(filtro, atualizacao)
        if resultado.modified_count > 0:
            logging.warning(f"[Scheduler] {resultado.modified_count} certificados vencidos atualizados.")
        else:
            logging.info("[Scheduler] Nenhum certificado vencido encontrado hoje.")
    except Exception as e:
        logging.error(f"[Scheduler] Erro ao verificar certificados: {e}")

def job_verifica_guia_enviada():
    logging.info("[Scheduler] Iniciando verificação cruzada de guias (Onvio vs Banco)...")
    hoje = datetime.now()
    primeiro_do_mes = hoje.replace(day=1)
    ultimo_do_mes_anterior = primeiro_do_mes - timedelta(days=1)
    
    mesano = ultimo_do_mes_anterior.strftime("%Y%m")
    primeiro = primeiro_do_mes.strftime("%Y-%m-%d")
    agora = hoje.strftime("%Y-%m-%dT%H:%M:%S")

    try:
        nome2ts = listar_nomes_com_data(f"{primeiro}/{agora}")
    except Exception as e:
        logging.error(f"[Scheduler] Erro ao conectar no Onvio: {e}")
        return

    pgdas_rx = re.compile(r"(?P<cod>\d+)-PGDAS-(?P<mes>\d{2})(?P<ano>\d{4})-(?P<hash>[a-fA-F0-9]{8})", re.IGNORECASE)
    das_rx = re.compile(r"(?P<cod>\d+)-DAS-(?P<mes>\d{2})(?P<ano>\d{4})-(?P<hash>[a-fA-F0-9]{8})", re.IGNORECASE)

    encontrados: dict[int, dict[str, dict]] = {}
    for name, ts in nome2ts.items():
        m_pgdas = pgdas_rx.search(name)
        m_das = das_rx.search(name)
        
        if m_pgdas and f"{m_pgdas.group('ano')}{m_pgdas.group('mes')}" == mesano:
            cod = int(m_pgdas.group('cod'))
            encontrados.setdefault(cod, {})["pgdas"] = {"hash": m_pgdas.group('hash').lower(), "ts": ts}
                
        elif m_das and f"{m_das.group('ano')}{m_das.group('mes')}" == mesano:
            cod = int(m_das.group('cod'))
            encontrados.setdefault(cod, {})["das"] = {"hash": m_das.group('hash').lower(), "ts": ts}

    col = get_guias_enviadas_collection()
    val_col = get_valordeclarado_collection()
    atualizados = 0

    print("\n--- INICIANDO VALIDAÇÃO DE HASHES ---")
    for cod, onvio_docs in encontrados.items():
        db_doc = col.find_one({"cod_cliente": cod, "mesano": mesano})
        
        if not db_doc:
            continue

        update_fields = {}

        if "pgdas" in onvio_docs:
            hash_onvio = onvio_docs["pgdas"]["hash"]
            hash_db = db_doc.get("pgdas", {}).get("hash", "").lower()
            if hash_onvio == hash_db:
                update_fields["pgdas.publicado_onvio"] = True
                update_fields["pgdas.onvio_published_at"] = onvio_docs["pgdas"]["ts"]

        if "das" in onvio_docs:
            hash_onvio = onvio_docs["das"]["hash"]
            hash_db = db_doc.get("das", {}).get("hash", "").lower()
            if hash_onvio == hash_db:
                update_fields["das.publicado_onvio"] = True
                update_fields["das.onvio_published_at"] = onvio_docs["das"]["ts"]

        if update_fields:
            update_fields["updated_at"] = datetime.now(timezone.utc)
            
            pgdas_ok = update_fields.get("pgdas.publicado_onvio", db_doc.get("pgdas", {}).get("publicado_onvio", False))
            das_ok = update_fields.get("das.publicado_onvio", db_doc.get("das", {}).get("publicado_onvio", False))
            
            val_doc = val_col.find_one({"cod_cliente": cod, "mesano": mesano})
            is_exempt = (val_doc and val_doc.get("declarado", 0) == 0)

            if pgdas_ok and (das_ok or is_exempt):
                update_fields["guia_enviada"] = True

            res = col.update_one({"cod_cliente": cod, "mesano": mesano}, {"$set": update_fields})
            if res.modified_count > 0:
                atualizados += 1
                
    print("-------------------------------------\n")
    logging.info(f"[Scheduler] Finalizado. {atualizados} clientes atualizados com sucesso no Onvio.")


# ---------------------------------------------------------
# 4. OS WORKERS (OPERÁRIOS DA FILA)
# ---------------------------------------------------------
def processar_tasks_pendentes():
    tasks = get_tasks_collection()
    pre = get_pre_cadastro_collection()
    agora = datetime.now(timezone.utc)
    
    # Puxa 1 por vez, podendo ser "manual" ou "rotina"
    job = tasks.find_one({
        "status": "pendente", 
        "tipo": {"$in": ["manual", "rotina"]},
        "$or": [{"next_attempt_at": {"$exists": False}}, {"next_attempt_at": {"$lte": agora}}]
    }, sort=[("created_at", 1)])
    
    if not job: return
    
    cod = job["cliente_cod"]
    cli = pre.find_one({"_id": cod})
    
    if not cli:
        tasks.update_one({"_id": job["_id"]}, {"$set": {"status": "erro", "error_msg": "Cliente não encontrado", "updated_at": datetime.now(timezone.utc)}})
        return
        
    tasks.update_one({"_id": job["_id"]}, {"$set": {"status": "em_andamento", "updated_at": datetime.now(timezone.utc)}})
    
    try:
        logging.info(f"[Worker XML] Processando download da empresa {cod} (Tipo: {job['tipo']})...")
        
        mes_formatado = f"{job['mesano'][:4]}-{job['mesano'][4:]}"
        
        # O ROTEAMENTO ACONTECE AQUI!
        if job["tipo"] == "rotina":
             resultado = processar_empresa_mes(str(cod), cli["empresa"], cli["cnpj"], mes_formatado)
        else:
             resultado = processar_task_manual(cod, cli["empresa"], cli["cnpj"], cli["inscricao_municipal"], job["mesano"])
             
        if isinstance(resultado, dict) and "erro" in resultado:
            tasks.update_one({"_id": job["_id"]}, {"$set": {"status": "erro", "error_msg": resultado["erro"], "finished_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}})
            return
            
        tasks.update_one({"_id": job["_id"]}, {"$set": {"status": "concluído", "resultados": resultado, "finished_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}, "$unset": {"next_attempt_at": ""}})
        
    except Exception as e:
        tasks.update_one({"_id": job["_id"]}, {"$set": {"status": "erro", "error_msg": str(e), "finished_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}})


def processar_faturamento_pendentes():
    fat_tasks = get_tasksfaturamentos_collection()
    pre = get_pre_cadastro_collection()
    agora = datetime.now(timezone.utc)
    
    job = fat_tasks.find_one({"status": "pendente", "tipo": "xml", "$or": [{"next_attempt_at": {"$exists": False}}, {"next_attempt_at": {"$lte": agora}}]}, sort=[("created_at", 1)])
    
    if not job: return
    
    cod = job["cliente_cod"]
    cli = pre.find_one({"_id": cod})
    
    if not cli:
        fat_tasks.update_one({"_id": job["_id"]}, {"$set": {"status": "erro", "error_msg": "Cliente não encontrado", "finished_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}})
        return
        
    fat_tasks.update_one({"_id": job["_id"]}, {"$set": {"status": "em_andamento", "updated_at": datetime.now(timezone.utc)}})
    
    try:
        logging.info(f"[Worker FAT] Processando recálculo da empresa {cod}...")
        res = reprocessar_faturamento_mensal(cod, job["mesano"])
        if res.get("mantido"): res = {"quantidade_notas": 0, "total_valor_servicos": 0.0}
        fat_tasks.update_one({"_id": job["_id"]}, {"$set": {"status": "concluído", "resultados": res, "finished_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}, "$unset": {"next_attempt_at": ""}})
    except Exception as e:
        fat_tasks.update_one({"_id": job["_id"]}, {"$set": {"status": "erro", "error_msg": str(e), "finished_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}})

def processar_tomadas_pendentes():
    """
    Processa a fila de TOMADAS separadamente.

    Prioridade:
    1. manual_tomadas  -> somente baixa XMLs para pasta individual
    2. valor_tomadas   -> atualiza nfse_tomadas sem salvar XML físico
    3. xml_tomadas     -> baixa XMLs mensais + atualiza nfse_tomadas
    """
    tomadas_tasks = get_taskstomadas_collection()
    pre = get_pre_cadastro_collection()
    agora = datetime.now(timezone.utc)

    filtro_base = {
        "status": "pendente",
        "$or": [
            {"next_attempt_at": {"$exists": False}},
            {"next_attempt_at": {"$lte": agora}}
        ]
    }

    job = None

    for tipo_prioritario in ["manual_tomadas", "valor_tomadas", "xml_tomadas"]:
        job = tomadas_tasks.find_one(
            {
                **filtro_base,
                "tipo": tipo_prioritario
            },
            sort=[("created_at", 1)]
        )

        if job:
            break

    if not job:
        return
    
    if job.get("tipo") == "xml_tomadas":
        tasks_emitidas = get_tasks_collection()

        emitidas_em_aberto = tasks_emitidas.count_documents({
            "mesano": job["mesano"],
            "tipo": "rotina",
            "status": {"$in": ["pendente", "em_andamento"]}
        })

        if emitidas_em_aberto > 0:
            logging.info(
                f"[Worker TOMADAS] Aguardando fila de EMITIDAS terminar "
                f"para mesano={job['mesano']}. "
                f"Pendentes/em andamento: {emitidas_em_aberto}"
            )
            return

    cod = job["cliente_cod"]
    cli = pre.find_one({"_id": cod})

    if not cli:
        tomadas_tasks.update_one(
            {"_id": job["_id"]},
            {"$set": {
                "status": "erro",
                "error_msg": "Cliente não encontrado",
                "finished_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc)
            }}
        )
        return

    tomadas_tasks.update_one(
        {"_id": job["_id"]},
        {"$set": {
            "status": "em_andamento",
            "updated_at": datetime.now(timezone.utc)
        }}
    )

    try:
        tipo = job.get("tipo")

        logging.info(
            f"[Worker TOMADAS] Processando cliente={cod} "
            f"mesano={job['mesano']} tipo={tipo}"
        )

        if tipo == "manual_tomadas":
            res = processar_task_manual_tomadas(
                codigo=cod,
                nome=cli.get("empresa", ""),
                cnpj=cli.get("cnpj", ""),
                mesano=job["mesano"],
                final_path=job.get("final_path")
            )

            if isinstance(res, dict) and "erro" in res:
                tomadas_tasks.update_one(
                    {"_id": job["_id"]},
                    {"$set": {
                        "status": "erro",
                        "error_msg": res["erro"],
                        "resultados": res,
                        "finished_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc)
                    }}
                )
                return

            tomadas_tasks.update_one(
                {"_id": job["_id"]},
                {
                    "$set": {
                        "status": "concluído",
                        "resultados": res,
                        "finished_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                        "error_msg": None,
                    },
                    "$unset": {
                        "next_attempt_at": ""
                    }
                }
            )

            logging.info(
                f"[Worker TOMADAS] Manual concluído cliente={cod} "
                f"salvos={res.get('total_salvos', 0)} "
                f"path={res.get('final_path')}"
            )

            return

        salvar_arquivos = tipo == "xml_tomadas"

        res = reprocessar_tomadas_mensal(
            cod,
            job["mesano"],
            salvar_arquivos=salvar_arquivos
        )

        tomadas_tasks.update_one(
            {"_id": job["_id"]},
            {
                "$set": {
                    "status": "concluído",
                    "resultados": {
                        "quantidade_xmls_s3": res.get("quantidade_xmls_s3", 0),
                        "quantidade_notas_validas": res.get("quantidade_notas_validas", 0),
                        "quantidade_canceladas": res.get("quantidade_canceladas", 0),
                        "quantidade_retencao": res.get("quantidade_retencao", 0),
                        "total_tomadas": res.get("total_tomadas", 0.0),
                        "total_retencao": res.get("total_retencao", 0.0),
                        "salvou_arquivos": salvar_arquivos,
                    },
                    "finished_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                    "error_msg": None,
                },
                "$unset": {
                    "next_attempt_at": ""
                }
            }
        )

        logging.info(
            f"[Worker TOMADAS] Concluído cliente={cod} tipo={tipo} "
            f"validas={res.get('quantidade_notas_validas', 0)} "
            f"canceladas={res.get('quantidade_canceladas', 0)} "
            f"servico={res.get('total_tomadas', 0.0)} "
            f"retencao={res.get('total_retencao', 0.0)} "
            f"salvou_arquivos={salvar_arquivos}"
        )

    except Exception as e:
        tomadas_tasks.update_one(
            {"_id": job["_id"]},
            {"$set": {
                "status": "erro",
                "error_msg": str(e),
                "finished_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc)
            }}
        )

        logging.exception(f"[Worker TOMADAS] Erro ao processar cliente={cod}")


def reap_stalled_tasks():
    try:
        limite = datetime.now(timezone.utc) - timedelta(minutes=60)

        update_watchdog = {
            "$set": {
                "status": "erro",
                "error_msg": "Watchdog: excedeu 60 min",
                "finished_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc)
            }
        }

        tasks = get_tasks_collection()
        tasks.update_many(
            {"status": "em_andamento", "updated_at": {"$lt": limite}},
            update_watchdog
        )

        fat_tasks = get_tasksfaturamentos_collection()
        fat_tasks.update_many(
            {"status": "em_andamento", "updated_at": {"$lt": limite}},
            update_watchdog
        )

        tomadas_tasks = get_taskstomadas_collection()
        tomadas_tasks.update_many(
            {"status": "em_andamento", "updated_at": {"$lt": limite}},
            update_watchdog
        )

    except Exception as e:
        logging.error(f"[Watchdog] Falha ao varrer tasks: {e}")

# ---------------------------------------------------------
# 5. INICIALIZAÇÃO E COMANDOS
# ---------------------------------------------------------
def main():
    if "--run-now" in sys.argv:
        print(">>> RUN NOW DISPARADO <<<")
        logging.info("modo --run-now reconhecido...")
        job_busca_mensal()
        print(">>> FINALIZOU <<<")
        sys.exit(0)

    if "--run-faturamento" in sys.argv:
        logging.info("modo --run-faturamento reconhecido, enfileirando faturamentos...")
        job_atualiza_faturamento()
        sys.exit(0)

    if "--run-tomadas" in sys.argv:
        logging.info("modo --run-tomadas reconhecido, enfileirando tomadas...")
        job_atualiza_tomadas()
        sys.exit(0)

    if "--run-smart" in sys.argv:
        logging.info("modo --run-smart reconhecido: iniciando sincronização AWS x Mongo")
        job_sincronizacao_inteligente()
        sys.exit(0)
    
    if "--processar-tomadas" in sys.argv:
        logging.info("modo --processar-tomadas reconhecido, processando uma pendente de tomadas...")
        processar_tomadas_pendentes()
        sys.exit(0)

    if "--run-certificados" in sys.argv:
        job_verificar_validade_certificados()
        sys.exit(0)

    if "--run-verificacao-guias" in sys.argv:
        job_verifica_guia_enviada()
        sys.exit(0)

    scheduler = BlockingScheduler(timezone="America/Sao_Paulo")

    # Os Gerentes
    scheduler.add_job(
        job_busca_mensal,
        id="busca_mensal",
        trigger=CronTrigger(day=1, hour=5, minute=0),
        max_instances=1,
        misfire_grace_time=3600
    )

    scheduler.add_job(
        job_atualiza_tomadas,
        id="atualiza_tomadas",
        trigger=CronTrigger(day=1, hour=7, minute=0),
        max_instances=1,
        misfire_grace_time=3600
    )

    scheduler.add_job(
        job_atualiza_faturamento,
        id="atualiza_faturamento",
        trigger=CronTrigger(day=10, hour=8, minute=0),
        max_instances=1,
        misfire_grace_time=3600
    )
    
    # Tarefas Isoladas
    scheduler.add_job(job_verificar_validade_certificados, id="check_certificados", trigger=CronTrigger(hour=6, minute=0), max_instances=1, misfire_grace_time=3600)
    scheduler.add_job(job_verifica_guia_enviada, id="verifica_guia_enviada", trigger=CronTrigger(hour=9, minute=0), max_instances=1, misfire_grace_time=3600)
    scheduler.add_job(job_sincronizacao_inteligente, id="sync_smart_delta", trigger=IntervalTrigger(minutes=30), max_instances=1, misfire_grace_time=300)
    scheduler.add_job(reap_stalled_tasks, id="reap_stalled", trigger=IntervalTrigger(minutes=5), max_instances=1, misfire_grace_time=120)

    # Os Operários (Workers rodando de 30 em 30 segundos puxando da fila)
    scheduler.add_job(
        processar_tasks_pendentes,
        id="poll_tasks",
        trigger=IntervalTrigger(seconds=30),
        max_instances=1,
        misfire_grace_time=30
    )

    scheduler.add_job(
        processar_faturamento_pendentes,
        id="poll_tasks_fat",
        trigger=IntervalTrigger(seconds=30),
        max_instances=1,
        misfire_grace_time=30
    )

    scheduler.add_job(
        processar_tomadas_pendentes,
        id="poll_tasks_tomadas",
        trigger=IntervalTrigger(seconds=35),
        max_instances=1,
        misfire_grace_time=30
    )

    logging.info(
      "[Scheduler START] Scheduler iniciado com sucesso. "
       f"pid={os.getpid()} "
       f"python={sys.executable} "
       f"cwd={os.getcwd()}"
    )

    try:
        scheduler.start()

    except KeyboardInterrupt:
        logging.warning("[Scheduler STOP] Interrompido manualmente por KeyboardInterrupt.")

    except SystemExit as e:
        logging.warning(f"[Scheduler STOP] Interrompido por SystemExit: {e}")

    except BaseException as e:
        logging.exception(f"[Scheduler FATAL] Scheduler parou por erro fatal não tratado: {e}")
        raise

    finally:
        logging.warning("[Scheduler FINALLY] Entrou no bloco finally do scheduler.")

        try:
            if scheduler.running:
                scheduler.shutdown(wait=False)
                logging.warning("[Scheduler SHUTDOWN] Shutdown executado com sucesso.")
            else:
                logging.warning("[Scheduler SHUTDOWN] Scheduler já não estava running.")
        except Exception as e:
            logging.exception(f"[Scheduler SHUTDOWN ERRO] Falha ao executar shutdown: {e}")

if __name__ == "__main__":
    main()
    