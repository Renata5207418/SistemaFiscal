from pathlib import Path
from automacao.config import (
    BASE_STORAGE_DIR,
    STORAGE_INDIVIDUAL,
    BASE_STORAGE_TOMADAS_DIR,
    STORAGE_INDIVIDUAL_TOMADAS,
)


def montar_nome_pasta_empresa(codigo: str, nome: str) -> str:
    """
    Usa exatamente o nome do cadastro, sem normalizar.
    """
    return f"{codigo}-{nome}"


def normalizar_origem(origem: str) -> str:
    origem = str(origem or "EMITIDAS").strip().upper()

    if origem not in {"EMITIDAS", "TOMADAS"}:
        raise ValueError(f"Origem inválida: {origem}. Use EMITIDAS ou TOMADAS.")

    return origem


def base_storage_por_origem(origem: str) -> Path:
    origem = normalizar_origem(origem)

    if origem == "TOMADAS":
        return BASE_STORAGE_TOMADAS_DIR

    return BASE_STORAGE_DIR


def storage_individual_por_origem(origem: str) -> Path:
    origem = normalizar_origem(origem)

    if origem == "TOMADAS":
        return STORAGE_INDIVIDUAL_TOMADAS

    return STORAGE_INDIVIDUAL


def formatar_pasta_mes(mesano: str) -> str:
    """
    Aceita:
    - 202605 -> 2026-05
    - 2026-05 -> 2026-05
    """
    mesano = str(mesano)

    if len(mesano) == 6 and mesano.isdigit():
        return f"{mesano[:4]}-{mesano[4:]}"

    return mesano


def caminho_pasta_empresa(
    codigo: str,
    nome: str,
    mesano: str,
    origem: str = "EMITIDAS"
) -> Path:
    """
    Emitidas:
    BASE_STORAGE_DIR/YYYY-MM/{codigo}-{nome}

    Tomadas:
    BASE_STORAGE_TOMADAS_DIR/YYYY-MM/{codigo}-{nome}
    """
    pasta_mes = formatar_pasta_mes(mesano)
    pasta_nome = montar_nome_pasta_empresa(codigo, nome)

    return base_storage_por_origem(origem) / pasta_mes / pasta_nome


def criar_pasta_empresa(
    codigo: str,
    nome: str,
    mesano: str,
    origem: str = "EMITIDAS"
) -> Path:
    pasta = caminho_pasta_empresa(codigo, nome, mesano, origem=origem)
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta


def salvar_xml_empresa(
    codigo: str,
    nome: str,
    mesano: str,
    nome_arquivo: str,
    conteudo,
    origem: str = "EMITIDAS"
):
    pasta = criar_pasta_empresa(codigo, nome, mesano, origem=origem)
    destino = pasta / nome_arquivo

    if isinstance(conteudo, bytes):
        with open(destino, "wb") as f:
            f.write(conteudo)
    else:
        with open(destino, "w", encoding="utf-8") as f:
            f.write(conteudo)

    return destino


def caminho_pasta_individual(
    codigo: str,
    nome_limpo: str,
    timestamp: str,
    origem: str = "EMITIDAS"
) -> Path:
    pasta_nome = f"{codigo}-{nome_limpo}-{timestamp}"
    return storage_individual_por_origem(origem) / pasta_nome


def criar_pasta_individual(
    codigo: str,
    nome_limpo: str,
    timestamp: str,
    origem: str = "EMITIDAS"
) -> Path:
    pasta = caminho_pasta_individual(codigo, nome_limpo, timestamp, origem=origem)
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta