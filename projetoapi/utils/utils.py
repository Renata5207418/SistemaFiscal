import re
from fastapi import HTTPException


def limpar_cnpj(cnpj: str) -> str:
    return re.sub(r'\D', '', cnpj)


def limpar_inscricao(inscricao: str) -> str:
    return re.sub(r'\D', '', inscricao)


def validar_cnpj_unico(cnpj: str, colecao) -> None:
    if colecao.find_one({"cnpj": cnpj}):
        raise HTTPException(status_code=400, detail=f"CNPJ '{cnpj}' já cadastrado.")
