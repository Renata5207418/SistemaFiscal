import calendar
import logging
from io import BytesIO
from datetime import datetime

import pandas as pd
from lxml import etree as ET

from automacao.aws_s3 import listar_xmls_mes, baixar_xml
from utils.utils import limpar_cnpj


COLUNAS_SERVICO = [
    "Número NFS-e",
    "Código Verificação",
    "Data Emissão DPS",
    "Competência",

    "Local Emissão",
    "Local Prestação",
    "Local Incidência",
    "Cód. Mun. Incidência",

    "Prestador CNPJ",
    "Prestador Nome",
    "Prestador Fone",
    "Prestador Email",
    "Opção Simples Nacional",
    "Regime Apuração SN",
    "Regime Especial Trib",

    "Tomador CNPJ/CPF",
    "Tomador Nome",
    "Tomador Endereço",
    "Tomador Número",
    "Tomador Complemento",
    "Tomador Bairro",
    "Tomador Cidade",
    "Tomador Mun IBGE",
    "Tomador CEP",
    "Tomador Email",
    "Tomador Fone",

    "Código Serviço (Trib Nac)",
    "Descrição Serviço",
    "Desc. Tributação Nacional",

    "Valor Serviço",
    "Valor Desconto Incondicionado",
    "Valor Desconto Condicionado",
    "Valor Total Retenções",
    "Valor Líquido NFS-e",

    "Trib Mun ISSQN",
    "Retenção ISSQN",
    "Aliquota ISS",
    "Valor ISS",
    "Valor PIS",
    "Valor COFINS",
    "Valor IRRF",
    "Valor CSLL",

    "Total Trib Federais",
    "Total Trib Estaduais",
    "Total Trib Municipais",
    "Perc. Total Trib."
]


CLASSIFICACAO_OPTIONS = [
    "REVENDA",
    "INSUMO",
    "USO E CONSUMO",
    "COMPRA PARA PRESTAÇÃO DE SERVIÇO",
    "DEVOLUÇÃO",
    "REMESSA",
    "ATIVO IMOBILIZADO",
    "TRANSFERENCIA",
]


class ExtratorXMLTomadasPlanilha:
    def get_local_name(self, tag):
        return tag.split("}", 1)[-1] if "}" in tag else tag

    def parse_xml(self, xml_content):
        parser = ET.XMLParser(remove_blank_text=True, recover=True)
        return ET.fromstring(xml_content, parser=parser)

    def clean_xml_content(self, xml_content):
        try:
            root = self.parse_xml(xml_content)
            root_tag = self.get_local_name(root.tag)

            if root_tag == "NFSe":
                return xml_content

            nfse_elements = root.xpath('.//*[local-name()="NFSe"]')
            if nfse_elements:
                return ET.tostring(nfse_elements[0], encoding="utf-8")

            return None

        except Exception:
            return None

    def extrair_chave_cancelamento(self, xml_content):
        """
        Eventos/cancelamentos costumam trazer chNFSe.
        Retorna a chave da NFSe cancelada quando existir.
        """
        try:
            root = self.parse_xml(xml_content)
            chave = root.xpath('string(.//*[local-name()="chNFSe"])')
            return chave.strip() if chave else None
        except Exception:
            return None

    def extrair_id_inf_nfse(self, xml_content):
        """
        Retorna o atributo Id do infNFSe da nota principal.
        Usado para comparar com chNFSe de eventos/cancelamentos.
        """
        try:
            cleaned_content = self.clean_xml_content(xml_content)
            if cleaned_content is None:
                return ""

            root = self.parse_xml(cleaned_content)
            inf_nfse = self.find_element(root, './/*[local-name()="infNFSe"]')

            if inf_nfse is None:
                return ""

            return inf_nfse.get("Id", "") or ""

        except Exception:
            return ""

    def extrair_informacoes_completas_bytes(self, xml_content):
        try:
            if not xml_content:
                return []

            if isinstance(xml_content, str):
                xml_content = xml_content.encode("utf-8")

            if not xml_content.strip():
                return []

            cleaned_content = self.clean_xml_content(xml_content)

            if cleaned_content is None:
                return []

            root = self.parse_xml(cleaned_content)
            root_tag = self.get_local_name(root.tag)

            if root_tag != "NFSe":
                return []

            return self.extract_data_servico(root)

        except Exception as e:
            logging.error(f"Erro ao processar XML de tomadas: {e}")
            return []

    def convert_value(self, value):
        try:
            number = float(value)
            return f"{number:.6f}".rstrip("0").rstrip(".").replace(".", ",")
        except ValueError:
            return value
        except TypeError:
            return value

    def extract_data_servico(self, root):
        all_items_data = []

        infNFSe_elements = root.xpath('.//*[local-name()="infNFSe"]')

        if not infNFSe_elements:
            return []

        infNFSe = infNFSe_elements[0]
        infDPS = self.find_element(infNFSe, './/*[local-name()="infDPS"]')

        fields_map = {
            "Número NFS-e": self.find_text(infNFSe, './/*[local-name()="nNFSe"]'),
            "Código Verificação": self.find_text(infNFSe, './/*[local-name()="nDFSe"]'),

            "Local Emissão": self.find_text(infNFSe, './/*[local-name()="xLocEmi"]'),
            "Local Prestação": self.find_text(infNFSe, './/*[local-name()="xLocPrestacao"]'),
            "Local Incidência": self.find_text(infNFSe, './/*[local-name()="xLocIncid"]'),
            "Cód. Mun. Incidência": self.find_text(infNFSe, './/*[local-name()="cLocIncid"]'),

            "Data Emissão DPS": self.find_text(infDPS, './/*[local-name()="dhEmi"]'),
            "Competência": self.find_text(infDPS, './/*[local-name()="dCompet"]'),

            "Prestador CNPJ": self.find_text(
                infDPS,
                './/*[local-name()="prest"]/*[local-name()="CNPJ"]'
            ),
            "Prestador Nome": self.find_text(
                infDPS,
                './/*[local-name()="prest"]/*[local-name()="xNome"]'
            ),
            "Prestador Fone": self.find_text(
                infDPS,
                './/*[local-name()="prest"]/*[local-name()="fone"]'
            ),
            "Prestador Email": self.find_text(
                infDPS,
                './/*[local-name()="prest"]/*[local-name()="email"]'
            ),
            "Opção Simples Nacional": self.find_text(
                infDPS,
                './/*[local-name()="prest"]/*[local-name()="regTrib"]/*[local-name()="opSimpNac"]'
            ),
            "Regime Apuração SN": self.find_text(
                infDPS,
                './/*[local-name()="prest"]/*[local-name()="regTrib"]/*[local-name()="regApTribSN"]'
            ),
            "Regime Especial Trib": self.find_text(
                infDPS,
                './/*[local-name()="prest"]/*[local-name()="regTrib"]/*[local-name()="regEspTrib"]'
            ),

            "Tomador CNPJ/CPF": self.find_text(
                infDPS,
                './/*[local-name()="toma"]/*[local-name()="CNPJ"]'
            ) or self.find_text(
                infDPS,
                './/*[local-name()="toma"]/*[local-name()="CPF"]'
            ),
            "Tomador Nome": self.find_text(
                infDPS,
                './/*[local-name()="toma"]/*[local-name()="xNome"]'
            ),
            "Tomador Endereço": self.find_text(
                infDPS,
                './/*[local-name()="toma"]/*[local-name()="end"]/*[local-name()="xLgr"]'
            ),
            "Tomador Número": self.find_text(
                infDPS,
                './/*[local-name()="toma"]/*[local-name()="end"]/*[local-name()="nro"]'
            ),
            "Tomador Complemento": self.find_text(
                infDPS,
                './/*[local-name()="toma"]/*[local-name()="end"]/*[local-name()="xCpl"]'
            ),
            "Tomador Bairro": self.find_text(
                infDPS,
                './/*[local-name()="toma"]/*[local-name()="end"]/*[local-name()="xBairro"]'
            ),
            "Tomador Cidade": self.find_text(
                infDPS,
                './/*[local-name()="toma"]/*[local-name()="end"]/*[local-name()="endNac"]/*[local-name()="xMun"]'
            ) or self.find_text(
                infDPS,
                './/*[local-name()="toma"]/*[local-name()="end"]/*[local-name()="xMun"]'
            ),
            "Tomador Mun IBGE": self.find_text(
                infDPS,
                './/*[local-name()="toma"]/*[local-name()="end"]/*[local-name()="endNac"]/*[local-name()="cMun"]'
            ),
            "Tomador CEP": self.find_text(
                infDPS,
                './/*[local-name()="toma"]/*[local-name()="end"]/*[local-name()="endNac"]/*[local-name()="CEP"]'
            ),
            "Tomador Email": self.find_text(
                infDPS,
                './/*[local-name()="toma"]/*[local-name()="email"]'
            ),
            "Tomador Fone": self.find_text(
                infDPS,
                './/*[local-name()="toma"]/*[local-name()="fone"]'
            ),

            "Código Serviço (Trib Nac)": self.find_text(
                infDPS,
                './/*[local-name()="cServ"]/*[local-name()="cTribNac"]'
            ),
            "Descrição Serviço": self.find_text(
                infDPS,
                './/*[local-name()="cServ"]/*[local-name()="xDescServ"]'
            ),
            "Desc. Tributação Nacional": self.find_text(
                infNFSe,
                './/*[local-name()="xTribNac"]'
            ),

            "Valor Serviço": self.find_text(
                infDPS,
                './/*[local-name()="vServPrest"]/*[local-name()="vServ"]'
            ),
            "Valor Desconto Incondicionado": self.find_text(
                infDPS,
                './/*[local-name()="vServPrest"]/*[local-name()="vDescIncond"]'
            ),
            "Valor Desconto Condicionado": self.find_text(
                infDPS,
                './/*[local-name()="vServPrest"]/*[local-name()="vDescCond"]'
            ),
            "Valor Total Retenções": self.find_text(
                infNFSe,
                './/*[local-name()="valores"]/*[local-name()="vTotalRet"]'
            ),
            "Valor Líquido NFS-e": self.find_text(
                infNFSe,
                './/*[local-name()="valores"]/*[local-name()="vLiq"]'
            ),

            "Trib Mun ISSQN": self.find_text(
                infDPS,
                './/*[local-name()="trib"]/*[local-name()="tribMun"]/*[local-name()="tribISSQN"]'
            ),
            "Retenção ISSQN": self.find_text(
                infDPS,
                './/*[local-name()="trib"]/*[local-name()="tribMun"]/*[local-name()="tpRetISSQN"]'
            ),
            "Aliquota ISS": self.find_text(
                infDPS,
                './/*[local-name()="trib"]/*[local-name()="tribMun"]/*[local-name()="pAliq"]'
            ),
            "Valor ISS": self.find_text(
                infDPS,
                './/*[local-name()="trib"]/*[local-name()="tribMun"]/*[local-name()="vISSQN"]'
            ),

            "Valor PIS": self.find_text(
                infDPS,
                './/*[local-name()="trib"]/*[local-name()="tribFed"]/*[local-name()="vPIS"]'
            ),
            "Valor COFINS": self.find_text(
                infDPS,
                './/*[local-name()="trib"]/*[local-name()="tribFed"]/*[local-name()="vCOFINS"]'
            ),
            "Valor IRRF": self.find_text(
                infDPS,
                './/*[local-name()="trib"]/*[local-name()="tribFed"]/*[local-name()="vIRRF"]'
            ),
            "Valor CSLL": self.find_text(
                infDPS,
                './/*[local-name()="trib"]/*[local-name()="tribFed"]/*[local-name()="vCSLL"]'
            ),

            "Total Trib Federais": self.find_text(
                infDPS,
                './/*[local-name()="trib"]/*[local-name()="totTrib"]/*[local-name()="vTotTribFed"]'
            ),
            "Total Trib Estaduais": self.find_text(
                infDPS,
                './/*[local-name()="trib"]/*[local-name()="totTrib"]/*[local-name()="vTotTribEst"]'
            ),
            "Total Trib Municipais": self.find_text(
                infDPS,
                './/*[local-name()="trib"]/*[local-name()="totTrib"]/*[local-name()="vTotTribMun"]'
            ),
            "Perc. Total Trib.": self.find_text(
                infDPS,
                './/*[local-name()="trib"]/*[local-name()="totTrib"]/*[local-name()="pTotTribSN"]'
            ),
        }

        data = {}

        for field, value in fields_map.items():
            if value:
                extracted_text = value.strip()

                if field == "Código Verificação":
                    data[field] = extracted_text

                elif (
                    "Valor" in field
                    or "Aliquota" in field
                    or "Perc." in field
                    or "Total Trib" in field
                ):
                    data[field] = self.convert_value(extracted_text)

                else:
                    data[field] = extracted_text
            else:
                data[field] = "0,00" if ("Valor" in field or "Total" in field) else ""

        all_items_data.append(data)
        return all_items_data

    def find_text(self, element, xpath):
        try:
            if element is None:
                return None

            result = element.xpath(xpath)

            if result:
                if isinstance(result, list):
                    return result[0].text if result[0].text else None
                return result.text

            return None

        except Exception:
            return None

    def find_element(self, element, xpath):
        try:
            if element is None:
                return None

            result = element.xpath(xpath)

            if result:
                return result[0]

            return None

        except Exception:
            return None


def _normalizar_xml_para_bytes(xml):
    if isinstance(xml, bytes):
        return xml

    if isinstance(xml, str):
        return xml.encode("utf-8")

    return bytes(xml)


def _gerar_excel_buffer(dados, ignorados):
    colunas_ordenadas = COLUNAS_SERVICO.copy()

    df = pd.DataFrame(dados, columns=colunas_ordenadas)

    df["Prestador CNPJ"] = df["Prestador CNPJ"].astype(str)
    df["Tomador CNPJ/CPF"] = df["Tomador CNPJ/CPF"].astype(str)

    coluna_chave = "Código Verificação"
    descricao_index_name = "Descrição Serviço"

    descricao_produto_index = colunas_ordenadas.index(descricao_index_name) + 1

    colunas_ordenadas.insert(descricao_produto_index, "Classificação")
    df.insert(descricao_produto_index, "Classificação", "")

    df = df[colunas_ordenadas]

    chaves_unicas = df[coluna_chave].drop_duplicates().reset_index(drop=True)
    df_chaves = pd.DataFrame({"Chave/ID": chaves_unicas})

    df_ignorados = pd.DataFrame(
        ignorados,
        columns=["Arquivo S3", "Motivo"]
    )

    buffer = BytesIO()

    with pd.ExcelWriter(buffer, engine="xlsxwriter") as writer:
        df.to_excel(writer, sheet_name="Dados", index=False)
        df_chaves.to_excel(writer, sheet_name="Chaves", index=False)
        df_ignorados.to_excel(writer, sheet_name="Ignorados", index=False)

        workbook = writer.book
        worksheet = writer.sheets["Dados"]

        header_format = workbook.add_format({
            "bold": True,
            "font_color": "white",
            "bg_color": "#413D3A",
            "align": "center",
            "valign": "vcenter",
            "border": 1
        })

        text_format = workbook.add_format({
            "valign": "vcenter"
        })

        for col_num, coluna in enumerate(df.columns):
            worksheet.write(0, col_num, coluna, header_format)

            if not df.empty:
                largura = max(
                    len(str(coluna)),
                    min(60, df[coluna].astype(str).map(len).max())
                )
            else:
                largura = len(str(coluna))

            worksheet.set_column(col_num, col_num, min(largura + 2, 60), text_format)

        worksheet.freeze_panes(1, 0)
        worksheet.autofilter(0, 0, len(df), len(df.columns) - 1)

        hidden_sheet_name = "Opcoes"
        hidden_worksheet = workbook.add_worksheet(hidden_sheet_name)
        hidden_worksheet.hide()

        for row, option in enumerate(CLASSIFICACAO_OPTIONS):
            hidden_worksheet.write(row, 0, option)

        dropdown_range = f"={hidden_sheet_name}!$A$1:$A${len(CLASSIFICACAO_OPTIONS)}"

        first_row = 1
        last_row = len(df)

        for row in range(first_row, last_row + 1):
            worksheet.data_validation(
                row,
                descricao_produto_index,
                row,
                descricao_produto_index,
                {
                    "validate": "list",
                    "source": dropdown_range,
                    "input_message": "Selecione uma classificação",
                    "error_message": "Valor inválido. Escolha uma das opções."
                }
            )

        worksheet_chaves = writer.sheets["Chaves"]

        for col_num, coluna in enumerate(df_chaves.columns):
            worksheet_chaves.write(0, col_num, coluna, header_format)
            worksheet_chaves.set_column(col_num, col_num, 60, text_format)

        worksheet_chaves.freeze_panes(1, 0)

        worksheet_ignorados = writer.sheets["Ignorados"]

        for col_num, coluna in enumerate(df_ignorados.columns):
            worksheet_ignorados.write(0, col_num, coluna, header_format)
            worksheet_ignorados.set_column(col_num, col_num, 80 if col_num == 0 else 35, text_format)

        worksheet_ignorados.freeze_panes(1, 0)

    buffer.seek(0)
    return buffer


def gerar_planilha_tomadas_xml_s3(mesano: str, clientes: list[dict]):
    """
    Lê XMLs de TOMADAS diretamente do S3 e gera planilha geral.

    Não salva no banco.
    Não salva XML local.
    """
    mes_s3 = f"{mesano[:4]}-{mesano[4:]}"
    extrator = ExtratorXMLTomadasPlanilha()

    arquivos = []
    conteudos_por_path = {}
    ignorados = []

    for cliente in clientes:
        cod = cliente.get("_id")
        empresa = cliente.get("empresa", "")
        cnpj = limpar_cnpj(cliente.get("cnpj", ""))

        if not cnpj:
            ignorados.append([f"cliente={cod} {empresa}", "Cliente sem CNPJ"])
            continue

        try:
            paths = listar_xmls_mes(cnpj, mes_s3, origem="TOMADAS")
        except Exception as e:
            ignorados.append([f"cliente={cod} {empresa}", f"Erro ao listar S3: {e}"])
            continue

        for path_s3 in paths:
            arquivos.append(path_s3)

    arquivos = sorted(set(arquivos))

    chaves_canceladas = set()

    for path_s3 in arquivos:
        try:
            xml = baixar_xml(path_s3)
            xml_bytes = _normalizar_xml_para_bytes(xml)
            conteudos_por_path[path_s3] = xml_bytes

            chave_cancelada = extrator.extrair_chave_cancelamento(xml_bytes)

            if chave_cancelada:
                chaves_canceladas.add(chave_cancelada)

        except Exception as e:
            ignorados.append([path_s3, f"Erro ao baixar XML: {e}"])

    todos_dados = []

    for path_s3, xml_bytes in conteudos_por_path.items():
        try:
            id_inf_nfse = extrator.extrair_id_inf_nfse(xml_bytes)

            if id_inf_nfse and any(chave in id_inf_nfse for chave in chaves_canceladas):
                ignorados.append([path_s3, "NFSe cancelada por evento chNFSe"])
                continue

            dados = extrator.extrair_informacoes_completas_bytes(xml_bytes)

            if not dados:
                ignorados.append([path_s3, "XML não gerou dados de NFSe"])
                continue

            todos_dados.extend(dados)

        except Exception as e:
            ignorados.append([path_s3, f"Erro ao extrair dados: {e}"])

    return _gerar_excel_buffer(todos_dados, ignorados)