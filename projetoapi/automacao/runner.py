from automacao.aws_s3 import listar_xmls_mes, baixar_xml
from automacao.storage import (
    criar_pasta_empresa,
    salvar_xml_empresa,
    caminho_pasta_empresa,
    criar_pasta_individual
)
from automacao.parser_nfse import parse_nfse, calcular_faturamento
from automacao.parser_nfse_tomadas import parse_nfse_tomada, calcular_tomadas
from services.faturamento_service import FaturamentoService
from database.database import (
    get_faturamentos_collection,
    get_pre_cadastro_collection,
    get_tomadas_collection,
)
from datetime import datetime, timezone
from automacao.config import STORAGE_INDIVIDUAL_TOMADAS
import os
import re
import logging
import time
from pathlib import Path

# ---------------------------------------------------------
# 1) PROCESSAR EMPRESA (BUSCA MENSAL)
# ---------------------------------------------------------
def processar_empresa_mes(codigo: str, nome: str, cnpj: str, mes: str):

    print(f"\n=== PROCESSANDO {codigo}-{nome} / CNPJ {cnpj} / Mes {mes} ===")

    # 1) Lista S3
    xmls = listar_xmls_mes(cnpj, mes)

    # Cria a pasta do mês (sem apagar o que já existe)
    criar_pasta_empresa(codigo, nome, mes)

    for path_s3 in xmls:
        nome_arquivo = os.path.basename(path_s3)
        conteudo = baixar_xml(path_s3)
        # Salva o XML passando a competência (mês) para a árvore de pastas
        salvar_xml_empresa(codigo, nome, mes, nome_arquivo, conteudo)

    # 2) PROCESSA XML
    pasta = caminho_pasta_empresa(codigo, nome, mes)
    itens = []

    pre = get_pre_cadastro_collection()
    cli = pre.find_one({"_id": int(codigo)})
    regime = cli.get("regime_tributario") if cli else None

    for xml_nome in os.listdir(pasta):
        if xml_nome.lower().endswith(".xml"):
            with open(pasta / xml_nome, "r", encoding="utf-8") as f:
                itens.append(parse_nfse(f.read(), regime_tributario=regime))

    resultado_xml = calcular_faturamento(itens)

    # 3) BUSCA VALOR DO DOMÍNIO
    fat_service = FaturamentoService()
    mesano = mes.replace("-", "")
    dados_dominio = fat_service.obter_faturamento_dominio(mesano)

    valor_dominio = 0.0
    for item in dados_dominio:
        if item["cod_cliente"] == int(codigo):
            valor_dominio = item["total_faturamento"]
            break

    # 4) SALVAR TUDO NO MONGO
    coll_fat = get_faturamentos_collection()
    coll_fat.update_one(
        {"cod_cliente": int(codigo), "mesano": mesano},
        {
            "$set": {
                "cod_cliente": int(codigo),
                "empresa": nome,
                "cnpj": cnpj,
                "mesano": mesano,
                "quantidade_notas": resultado_xml["quantidade_notas"],
                "total_valor_servicos": resultado_xml["total_valor_servicos"],
                "cTribNac": resultado_xml.get("cTribNac", []),
                "valor_dominio": valor_dominio,
                "updated_at": datetime.now(timezone.utc),
            }
        },
        upsert=True
    )

    return {
        "xml": resultado_xml,
        "valor_dominio": valor_dominio,
        "cTribNac": resultado_xml.get("cTribNac", [])
    }

# ---------------------------------------------------------
# 2) Chamado pelo scheduler
# ---------------------------------------------------------
def processar_periodo_para_cliente(cod, nome, cnpj, im, mesano):
    mes = f"{mesano[:4]}-{mesano[4:]}"
    return processar_empresa_mes(str(cod), nome, cnpj, mes)


# ---------------------------------------------------------
# 3) Chamado por tasks manuais
# ---------------------------------------------------------
def processar_task_manual(cod, nome, cnpj, im, mesano):
    import os

    mes = f"{mesano[:4]}-{mesano[4:]}"
    xmls = listar_xmls_mes(cnpj, mes)

    # PASTA INDIVIDUAL
    ts = datetime.now().strftime("%Y%m%d%H%M%S%f")
    nome_limpo = nome.replace(" ", "_")
    
    # Chama a função nova do storage para manter o código limpo
    pasta = criar_pasta_individual(str(cod), nome_limpo, ts)

    itens = []

    pre = get_pre_cadastro_collection()
    cli = pre.find_one({"_id": int(cod)})
    regime = cli.get("regime_tributario") if cli else None

    for caminho_s3 in xmls:
        nome_arq = os.path.basename(caminho_s3)
        xml = baixar_xml(caminho_s3)

        # salvar individual
        with open(pasta / nome_arq, "w", encoding="utf-8") as f:
            f.write(xml)        

        itens.append(parse_nfse(xml, regime_tributario=regime))

    return calcular_faturamento(itens)


# ---------------------------------------------------------
# 4) Reprocessamento de faturamento (sem baixar XML)
# ---------------------------------------------------------
def reprocessar_faturamento_mensal(cod, mesano):
    """
    Recalcula o faturamento pegando DIRETO DO S3.
    Não usa pasta local.
    """
    from automacao.aws_s3 import listar_xmls_mes, baixar_xml
    from automacao.parser_nfse import parse_nfse, calcular_faturamento
    from database.database import get_pre_cadastro_collection, get_faturamentos_collection

    pre = get_pre_cadastro_collection()
    cli = pre.find_one({"_id": int(cod)})
    if not cli:
        return {"mantido": True}

    cnpj_limpo = re.sub(r'\D', '', cli["cnpj"])
    mes = f"{mesano[:4]}-{mesano[4:]}"

    logging.info(f"[FAT] Cliente {cod} - listando XMLs S3 mes={mes}")

    paths = listar_xmls_mes(cnpj_limpo, mes)
    total = len(paths)

    logging.info(f"[FAT] Cliente {cod} - encontrados {total} XMLs no S3")

    if total == 0:
        resultado = {
            "quantidade_notas": 0,
            "total_valor_servicos": 0.0,
            "cTribNac": []
        }

    else:
        itens = []
        erros = 0

        regime = cli.get("regime_tributario")
        for i, path_s3 in enumerate(paths, start=1):
            logging.info(f"[FAT] Cliente {cod} ({i}/{total}) BAIXANDO {path_s3}")

            try:
                ini = time.time()
                xml = baixar_xml(path_s3)
                dur = time.time() - ini

                logging.info(
                    f"[FAT] Cliente {cod} ({i}/{total}) OK download {dur:.1f}s size={len(xml)}"
                )

                itens.append(parse_nfse(xml, regime_tributario=regime))

            except Exception as e:
                logging.exception(
                    f"[FAT] Cliente {cod} ERRO no XML {path_s3} ? ABORTANDO EMPRESA"
                )
                raise

        logging.info(
            f"[FAT] Cliente {cod} - parse finalizado: ok={len(itens)} erros={erros}"
        )

        resultado = calcular_faturamento(itens)

    coll = get_faturamentos_collection()
    coll.update_one(
        {"cod_cliente": int(cod), "mesano": mesano},
        {"$set": {
            "cod_cliente": int(cod),
            "empresa": cli["empresa"],
            "cnpj": cli.get("cnpj"),
            "mesano": mesano,
            "quantidade_notas": resultado["quantidade_notas"],
            "total_valor_servicos": resultado["total_valor_servicos"],
            "cTribNac": resultado.get("cTribNac", []),
            "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True
    )

    logging.info(
        f"[FAT] Cliente {cod} FINALIZADO notas={resultado['quantidade_notas']} "
        f"valor={resultado['total_valor_servicos']:.2f}"
    )

    return resultado

# ---------------------------------------------------------
# 5) TOMADAS - Reprocessamento mensal direto do S3
# ---------------------------------------------------------
def reprocessar_tomadas_mensal(cod, mesano: str, salvar_arquivos: bool = True):
    """
    Recalcula as NFSe TOMADAS pegando direto do S3.

    Busca em:
    {cnpj}/TOMADAS/YYYY-MM/

    Salva no Mongo:
    collection nfse_tomadas
    """
    pre = get_pre_cadastro_collection()
    cli = pre.find_one({"_id": int(cod)})

    if not cli:
        return {
            "status_leitura": "erro",
            "error_msg": f"Cliente {cod} não encontrado."
        }

    cnpj_limpo = re.sub(r"\D", "", str(cli.get("cnpj", "")))
    mes = f"{mesano[:4]}-{mesano[4:]}"

    logging.info(f"[TOMADAS] Cliente {cod} - listando XMLs S3 mes={mes}")

    paths = listar_xmls_mes(cnpj_limpo, mes, origem="TOMADAS")
    total_xmls = len(paths)

    logging.info(f"[TOMADAS] Cliente {cod} - encontrados {total_xmls} XMLs no S3")

    itens = []
    erros_parse = []

    for i, path_s3 in enumerate(paths, start=1):
        logging.info(f"[TOMADAS] Cliente {cod} ({i}/{total_xmls}) baixando {path_s3}")

        try:
            xml = baixar_xml(path_s3)

            if salvar_arquivos:
                nome_arquivo = os.path.basename(path_s3)
                salvar_xml_empresa(
                    str(cod),
                    cli.get("empresa", ""),
                    mes,
                    nome_arquivo,
                    xml,
                    origem="TOMADAS"
                )

            item = parse_nfse_tomada(xml, arquivo_s3=path_s3)

            if item.get("tipo") == "desconhecido":
                erros_parse.append({
                    "arquivo_s3": path_s3,
                    "erro": item.get("erro", "XML desconhecido")
                })

            itens.append(item)

        except Exception as e:
            logging.exception(f"[TOMADAS] Cliente {cod} erro no XML {path_s3}")
            erros_parse.append({
                "arquivo_s3": path_s3,
                "erro": str(e)
            })

    resultado = calcular_tomadas(
        itens,
        quantidade_xmls_s3=total_xmls,
        erros_parse=erros_parse
    )

    now = datetime.now(timezone.utc)

    doc_set = {
        "cod_cliente": int(cod),
        "empresa": cli.get("empresa", ""),
        "cnpj": cli.get("cnpj", ""),
        "mesano": mesano,
        "origem": "TOMADAS",

        "quantidade_xmls_s3": resultado["quantidade_xmls_s3"],
        "quantidade_notas_validas": resultado["quantidade_notas_validas"],
        "quantidade_canceladas": resultado["quantidade_canceladas"],
        "quantidade_retencao": resultado["quantidade_retencao"],

        "total_tomadas": resultado["total_tomadas"],
        "total_retencao": resultado["total_retencao"],

        "notas_retencao": resultado["notas_retencao"],
        "erros_parse": resultado["erros_parse"],

        "status_leitura": "concluido",
        "updated_at": now,
    }

    coll = get_tomadas_collection()
    coll.update_one(
        {"cod_cliente": int(cod), "mesano": mesano},
        {
            "$set": doc_set,
            "$setOnInsert": {
                "created_at": now
            }
        },
        upsert=True
    )

    logging.info(
        f"[TOMADAS] Cliente {cod} finalizado | "
        f"validas={resultado['quantidade_notas_validas']} "
        f"canceladas={resultado['quantidade_canceladas']} "
        f"servico={resultado['total_tomadas']:.2f} "
        f"retencao={resultado['total_retencao']:.2f}"
    )

    return resultado


# ---------------------------------------------------------
# 6) TOMADAS - Busca mensal com assinatura parecida com emitidas
# ---------------------------------------------------------
def processar_tomadas_empresa_mes(codigo: str, nome: str, cnpj: str, mes: str):
    """
    Versão parecida com processar_empresa_mes, mas para TOMADAS.

    mes vem como YYYY-MM.
    """
    mesano = mes.replace("-", "")
    return reprocessar_tomadas_mensal(codigo, mesano, salvar_arquivos=True)

def processar_task_manual_tomadas(codigo, nome, cnpj, mesano, final_path=None):
    """
    Busca individual de XMLs TOMADAS.

    Faz somente:
    - busca no S3 em CNPJ/TOMADAS/YYYY-MM/
    - baixa XMLs
    - salva em pasta individual de tomadas

    Não atualiza nfse_tomadas.
    """


    cnpj_limpo = re.sub(r"\D", "", str(cnpj or ""))

    if not cnpj_limpo:
        return {"erro": "CNPJ inválido ou vazio."}

    mes = f"{mesano[:4]}-{mesano[4:]}"

    logging.info(f"[TOMADAS MANUAL] Cliente {codigo} - listando XMLs S3 mes={mes}")

    paths = listar_xmls_mes(cnpj_limpo, mes, origem="TOMADAS")

    if not paths:
        return {
            "erro": f"Nenhum XML de tomadas encontrado no S3 para {cnpj_limpo} em {mes}."
        }

    if final_path:
        pasta = Path(final_path)
    else:
        ts = datetime.now().strftime("%Y%m%d%H%M%S%f")
        nome_limpo = str(nome or "SEM_NOME").replace(" ", "_")
        pasta = STORAGE_INDIVIDUAL_TOMADAS / f"{codigo}-{nome_limpo}-{ts}"

    pasta.mkdir(parents=True, exist_ok=True)

    salvos = []
    erros = []

    total_xmls = len(paths)

    for i, path_s3 in enumerate(paths, start=1):
        try:
            logging.info(
                f"[TOMADAS MANUAL] Cliente {codigo} ({i}/{total_xmls}) baixando {path_s3}"
            )

            xml = baixar_xml(path_s3)
            nome_arquivo = os.path.basename(path_s3)

            destino = pasta / nome_arquivo

            # Evita sobrescrever caso exista nome repetido.
            if destino.exists():
                stem = destino.stem
                suffix = destino.suffix
                destino = pasta / f"{stem}_{i}{suffix}"

            with open(destino, "w", encoding="utf-8") as f:
                f.write(xml)

            salvos.append({
                "arquivo_s3": path_s3,
                "arquivo_local": str(destino)
            })

        except Exception as e:
            logging.exception(f"[TOMADAS MANUAL] Erro ao baixar {path_s3}")
            erros.append({
                "arquivo_s3": path_s3,
                "erro": str(e)
            })

    return {
        "tipo": "manual_tomadas",
        "cliente_cod": int(codigo),
        "mesano": mesano,
        "origem": "TOMADAS",
        "total_encontrados_s3": total_xmls,
        "total_salvos": len(salvos),
        "total_erros": len(erros),
        "final_path": str(pasta),
        "arquivos": salvos,
        "erros": erros
    }
