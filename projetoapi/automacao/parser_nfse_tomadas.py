from lxml import etree
import re


def _to_float(valor, default: float = 0.0) -> float:
    if valor is None:
        return default

    try:
        texto = str(valor).strip()

        if not texto:
            return default

        # Aceita 1234.56 e também 1.234,56
        if "," in texto:
            texto = texto.replace(".", "").replace(",", ".")

        return float(texto)
    except Exception:
        return default


def _first_text(node, xpath: str):
    try:
        vals = node.xpath(xpath)
        if not vals:
            return None

        valor = vals[0]

        if hasattr(valor, "text"):
            texto = valor.text
        else:
            texto = str(valor)

        texto = (texto or "").strip()
        return texto or None
    except Exception:
        return None


def _chave_from_inf_nfse_id(id_raw: str) -> str:
    id_raw = str(id_raw or "").strip()
    return re.sub(r"^NFS", "", id_raw, flags=re.IGNORECASE).strip()


def parse_nfse_tomada(xml: str, arquivo_s3: str | None = None) -> dict:
    """
    Lê XML de NFSe tomada.

    Retorna:
    - tipo normal
    - tipo cancelada
    - tipo desconhecido
    """
    try:
        root = etree.fromstring(xml.encode("utf-8"))
    except Exception as e:
        return {
            "tipo": "desconhecido",
            "arquivo_s3": arquivo_s3,
            "erro": f"Erro ao ler XML: {e}"
        }

    nome_raiz = etree.QName(root).localname.lower()

    # Evento/cancelamento
    if nome_raiz == "evento":
        chave = _first_text(root, '//*[local-name()="chNFSe"]/text()')

        return {
            "tipo": "cancelada",
            "chave": chave,
            "arquivo_s3": arquivo_s3
        }

    # NFSe normal
    if nome_raiz != "nfse":
        return {
            "tipo": "desconhecido",
            "arquivo_s3": arquivo_s3,
            "erro": f"Raiz XML não reconhecida: {nome_raiz}"
        }

    infs = root.xpath('//*[local-name()="infNFSe"]')
    if not infs:
        return {
            "tipo": "desconhecido",
            "arquivo_s3": arquivo_s3,
            "erro": "Tag infNFSe não encontrada"
        }

    inf = infs[0]
    chave = _chave_from_inf_nfse_id(inf.attrib.get("Id", ""))

    emit_nodes = root.xpath('//*[local-name()="emit"]')
    toma_nodes = root.xpath('//*[local-name()="toma"]')

    emit = emit_nodes[0] if emit_nodes else root
    toma = toma_nodes[0] if toma_nodes else root

    valor_servico = _to_float(
        _first_text(root, '//*[local-name()="vServ"]/text()')
    )

    valor_retencao = _to_float(
        _first_text(root, '//*[local-name()="vTotalRet"]/text()')
    )

    # ========================================================
    # BUSCA FLEXÍVEL DO CÓDIGO DE SERVIÇO
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

    codigo_servico_encontrado = None
    for tag in tags_tributacao:
        valor = _first_text(root, f'//*[local-name()="{tag}"]/text()')
        if valor:
            codigo_servico_encontrado = valor
            break
    # ========================================================

    return {
        "tipo": "normal",
        "chave": chave,
        "arquivo_s3": arquivo_s3,

        # Dados principais
        "numero_nfse": (
            _first_text(inf, './*[local-name()="nNFSe"]/text()')
            or _first_text(root, '//*[local-name()="nNFSe"]/text()')
        ),
        "data_competencia": _first_text(root, '//*[local-name()="dCompet"]/text()'),

        # Emitente / prestador
        "emit_cnpj": _first_text(emit, './*[local-name()="CNPJ"]/text()'),
        "emit_nome": _first_text(emit, './*[local-name()="xNome"]/text()'),

        # Tomador / empresa cadastrada
        "toma_cnpj": _first_text(toma, './*[local-name()="CNPJ"]/text()'),
        "toma_nome": _first_text(toma, './*[local-name()="xNome"]/text()'),

        # Valores
        "valor_servico": valor_servico,
        "valor_retencao": valor_retencao,

        # Serviço / tributação 
        "codigo_servico": codigo_servico_encontrado,
        "trib_issqn": _first_text(root, '//*[local-name()="tribISSQN"]/text()'),
        "tp_ret_issqn": _first_text(root, '//*[local-name()="tpRetISSQN"]/text()'),
    }


def calcular_tomadas(
    itens: list[dict],
    quantidade_xmls_s3: int | None = None,
    erros_parse: list[dict] | None = None
) -> dict:
    """
    Regra:
    - XMLs evento/cancelamento geram conjunto de chaves canceladas.
    - Nota normal cuja chave aparece em canceladas é ignorada.
    - total_tomadas soma vServ das notas válidas.
    - total_retencao soma vTotalRet das notas válidas.
    - notas_retencao guarda apenas notas válidas com vTotalRet > 0.
    """
    itens = [i for i in itens if i]

    chaves_canceladas = {
        i.get("chave")
        for i in itens
        if i.get("tipo") == "cancelada" and i.get("chave")
    }

    notas_validas = []
    quantidade_canceladas = 0

    for item in itens:
        if item.get("tipo") != "normal":
            continue

        chave = item.get("chave")

        if chave in chaves_canceladas:
            quantidade_canceladas += 1
            continue

        notas_validas.append(item)

    notas_retencao = []
    for item in notas_validas:
        valor_retencao = _to_float(item.get("valor_retencao"))

        if valor_retencao > 0:
            notas_retencao.append({
                "chave_nfse": item.get("chave"),
                "numero_nfse": item.get("numero_nfse"),
                "data_competencia": item.get("data_competencia"),

                "emit_cnpj": item.get("emit_cnpj"),
                "emit_nome": item.get("emit_nome"),

                "valor_servico": _to_float(item.get("valor_servico")),
                "valor_retencao": valor_retencao,

                "codigo_servico": item.get("codigo_servico"),
                "trib_issqn": item.get("trib_issqn"),
                "tp_ret_issqn": item.get("tp_ret_issqn"),

                "arquivo_s3": item.get("arquivo_s3"),
            })

    total_tomadas = round(
        sum(_to_float(i.get("valor_servico")) for i in notas_validas),
        2
    )

    total_retencao = round(
        sum(_to_float(i.get("valor_retencao")) for i in notas_validas),
        2
    )

    return {
        "quantidade_xmls_s3": quantidade_xmls_s3 if quantidade_xmls_s3 is not None else len(itens),
        "quantidade_notas_validas": len(notas_validas),
        "quantidade_canceladas": quantidade_canceladas,
        "quantidade_retencao": len(notas_retencao),

        "total_tomadas": total_tomadas,
        "total_retencao": total_retencao,

        "notas_retencao": notas_retencao,
        "erros_parse": erros_parse or [],
    }