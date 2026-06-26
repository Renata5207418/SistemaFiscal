# CALCULO DO FATURAMENTO:
# - cancelamento
# - substituição
# - desconto condicionado (Acrescenta no valor liquido)
# - desconto incondicionado

import xml
from lxml import etree


# ------------------------------------------------------------
# Detecta automaticamente o tipo de XML
# ------------------------------------------------------------
def detecta_tipo(xml: str) -> str:
    xml_lower = xml.lower()

    if "<nfse" in xml_lower:
        return "normal"

    if "<evento" in xml_lower and "<chnfse>" in xml_lower:
        return "cancelada"

    return "desconhecido"


# ------------------------------------------------------------
# Parse da NFSe normal (não cancelada)
# Inclui: substituição + descontos
# ------------------------------------------------------------
REGIME_NORMAL = {"lucro presumido", "lucro real"}

def parse_nfse_normal(xml: str, regime_tributario: str | None = None) -> dict | None:
    try:
        root = etree.fromstring(xml.encode("utf-8"))
    except Exception:
        return None
    inf = root.xpath('//*[local-name()="infNFSe"]')
    if not inf:
        return None

    inf = inf[0]

    id_raw = inf.attrib.get("Id", "")
    chave = id_raw.replace("NFS", "").strip()

    # Tags principais
    v_liq = root.xpath('.//*[local-name()="vLiq"]/text()')
    v_serv = root.xpath('.//*[local-name()="vServ"]/text()')
    v_desc_cond = root.xpath('.//*[local-name()="vDescCond"]/text()')
    v_desc_incond = root.xpath('.//*[local-name()="vDescIncond"]/text()')

    # ========================================================
    # INÍCIO DA CORREÇÃO: Busca flexível por Múltiplas Tags
    # ========================================================
    tags_tributacao = [
        "cTribNac",                  # Padrão Nacional novo
        "ItemListaServico",          # Padrão ABRASF principal
        "CodigoTributacaoMunicipio", # Variação municipal comum
        "codigoTributacaoMunicipio", # Variação (XPath é sensível a maiúsculas)
        "cServico",                  # Outra variação comum
        "ItemLC116",                 # Padrão Ginfes/SP antigo
        "cnae"                       # Último recurso
    ]

    ctrib_nac_raw = []
    for tag in tags_tributacao:
        valores = root.xpath(f'.//*[local-name()="{tag}"]/text()')
        
        valores_validos = [v for v in valores if v is not None and str(v).strip()]
        
        if valores_validos:
            ctrib_nac_raw = valores_validos
            break

    ctrib_nac = sorted({
        str(c).strip()
        for c in ctrib_nac_raw
        if c is not None and str(c).strip()
    })

    liquido = float(v_liq[0]) if v_liq else None
    bruto = float(v_serv[0]) if v_serv else 0.0
    desc_cond = float(v_desc_cond[0]) if v_desc_cond else 0.0
    desc_incond = float(v_desc_incond[0]) if v_desc_incond else 0.0

    regime = (regime_tributario or "").strip().lower()
    is_regime_normal = "real" in regime or "presumido" in regime

    if is_regime_normal:
        # REGRA REGIME NORMAL: Valor Bruto - Desconto Incondicionado
        valor_final = bruto 
    else:
        # Simples Nacional (mantém regra de priorizar líquido + condicionado)
        base = liquido if liquido is not None else bruto
        valor_final = base + desc_cond

    # Substituição
    subst = root.xpath('.//*[local-name()="subst"]')
    chave_substituida = None
    if subst:
        ch_sub = subst[0].xpath('.//*[local-name()="chSubstda"]/text()')
        if ch_sub:
            chave_substituida = ch_sub[0].strip()

    item = {"tipo": "normal", "chave": chave, "valor": valor_final, "cTribNac": ctrib_nac}

    if chave_substituida:
        item["substitui"] = chave_substituida

    return item


# ------------------------------------------------------------
# Parse do XML de cancelamento
# ------------------------------------------------------------
def parse_nfse_cancelada(xml: str) -> dict:
    root = etree.fromstring(xml.encode("utf-8"))

    chave = root.xpath('//*[local-name()="chNFSe"]/text()')
    if not chave:
        return None

    return {
        "tipo": "cancelada",
        "chave": chave[0].strip()
    }


# ------------------------------------------------------------
# Função unificada
# ------------------------------------------------------------
def parse_nfse(xml: str, regime_tributario: str | None = None) -> dict:
    tipo = detecta_tipo(xml)

    if tipo == "normal":
        return parse_nfse_normal(xml, regime_tributario=regime_tributario)

    if tipo == "cancelada":
        return parse_nfse_cancelada(xml)

    return {"tipo": "desconhecido"}

# ------------------------------------------------------------
# Soma final (com cancelamentos + substituídas)
# ------------------------------------------------------------
def calcular_faturamento(itens: list[dict]) -> dict:
    canceladas = {
        i["chave"]
        for i in itens
        if i and i.get("tipo") == "cancelada" and i.get("chave")
    }

    substituidas = {
        i["substitui"]
        for i in itens
        if i and i.get("tipo") == "normal" and i.get("substitui")
    }

    total = 0.0
    qtd = 0
    ctrib_nac_set = set()

    for item in itens:
        if not item or item.get("tipo") != "normal":
            continue

        chave = item.get("chave")

        if chave in canceladas:
            continue

        if chave in substituidas:
            continue

        total += item.get("valor", 0.0)
        qtd += 1

        for codigo in item.get("cTribNac", []) or []:
            codigo_limpo = str(codigo).strip()
            if codigo_limpo:
                ctrib_nac_set.add(codigo_limpo)

    return {
        "quantidade_notas": qtd,
        "total_valor_servicos": total,
        "cTribNac": sorted(ctrib_nac_set)
    }
