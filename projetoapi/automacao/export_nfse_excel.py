import io
import pandas as pd
import xml.etree.ElementTree as ET
from datetime import datetime
from automacao.parser_nfse import parse_nfse
from automacao.aws_s3 import listar_meses, listar_xmls_mes, baixar_xml


# ------------------------------------------------------------
# Extrai Múltiplos Dados da NFSe (Número, Data e Código Serviço)
# ------------------------------------------------------------
def extrair_dados_adicionais(xml_str: str) -> dict:
    dados = {"nNFSe": None, "dhEmi": None, "cTribNac": None}
    try:
        root = ET.fromstring(xml_str.encode("utf-8"))
        for elem in root.iter():
            tag = elem.tag.split('}')[-1] 
            
            if tag == "nNFSe" and not dados["nNFSe"]:
                dados["nNFSe"] = elem.text.strip() if elem.text else None
            elif tag == "dhEmi" and not dados["dhEmi"]:
                dados["dhEmi"] = elem.text.strip() if elem.text else None
            elif tag == "cTribNac" and not dados["cTribNac"]:
                dados["cTribNac"] = elem.text.strip() if elem.text else None
    except Exception:
        pass
    return dados


# ------------------------------------------------------------
# Carrega XMLs EMITIDAS do S3
# ------------------------------------------------------------
def carregar_xmls_emitidas(cnpj: str, mes: str | None = None):
    if mes:
        meses = [mes]
    else:
        meses = listar_meses(cnpj)

    notas = {}          # chave -> dados da nota
    canceladas = set()  # chaves canceladas

    for m in meses:
        for key in listar_xmls_mes(cnpj, m):
            if f"{cnpj}/EMITIDAS/" not in key:
                continue

            xml = baixar_xml(key)
            item = parse_nfse(xml)
            if not item:
                continue

            # -----------------------
            # EVENTO DE CANCELAMENTO
            # -----------------------
            if item["tipo"] == "cancelada":
                canceladas.add(item["chave"])
                continue

            # -----------------------
            # NFSe NORMAL
            # -----------------------
            if item["tipo"] == "normal":
                extra = extrair_dados_adicionais(xml)

                # ==========================================
                # FORMATAÇÃO DA DATA DE EMISSÃO
                # De: 2026-02-02T12:55:19-03:00 
                # Para: 02/02/2026 12:55:19
                # ==========================================
                data_formatada = ""
                if extra["dhEmi"]:
                    try:
                        # Tenta converter a data ISO para um objeto datetime
                        dt = datetime.fromisoformat(extra["dhEmi"].replace('Z', '+00:00'))
                        data_formatada = dt.strftime("%d/%m/%Y %H:%M:%S")
                    except Exception:
                        # Se o fromisoformat falhar por algum formato estranho, faz um recorte manual (Fallback)
                        try:
                            data_part = extra["dhEmi"].split("T")[0]
                            ano, mes_str, dia = data_part.split("-")
                            data_formatada = f"{dia}/{mes_str}/{ano}"
                        except:
                            data_formatada = extra["dhEmi"]

                notas[item["chave"]] = {
                    "NUMERO NOTA": extra["nNFSe"] or "",
                    "DATA EMISSAO": data_formatada,
                    "COD SERVICO": extra["cTribNac"] or "",
                    "VALOR LIQUIDO": round(item.get("valor", 0.0), 2),
                    "STATUS": "NORMAL",
                    "DESCONTO": 0.0,
                    "MES": m
                }

    # ------------------------------------------------
    # MARCA CANCELAMENTOS (SEM ZERAR VALOR)
    # ------------------------------------------------
    for chave in canceladas:
        if chave in notas:
            notas[chave]["STATUS"] = "CANCELADA"

    return list(notas.values())


# ------------------------------------------------------------
# Gera planilha e devolve em memória (Para a API)
# ------------------------------------------------------------
def gerar_excel_notas_buffer(cnpj: str, mes: str | None):
    linhas = carregar_xmls_emitidas(cnpj, mes)
    df = pd.DataFrame(linhas)
    if not df.empty:
        df.sort_values(["MES", "NUMERO NOTA"], inplace=True)

    buffer = io.BytesIO()
    # Usando engine openpyxl para evitar problemas de dependência
    with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name="Notas")
    
    buffer.seek(0)
    return buffer
