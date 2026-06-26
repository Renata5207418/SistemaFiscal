# BUSCA AS NOTAS NO AWS S3
import boto3
import os
import re
from dotenv import load_dotenv
from botocore.config import Config


load_dotenv()

AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION")
AWS_BUCKET_NAME = os.getenv("AWS_BUCKET_NAME")

ORIGENS_VALIDAS = {"EMITIDAS", "TOMADAS"}

config = Config(
    connect_timeout=10,
    read_timeout=60,
    retries={"max_attempts": 5, "mode": "standard"},
)

s3 = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    config=config
)


def limpar_cnpj_s3(cnpj: str) -> str:
    return re.sub(r"\D", "", str(cnpj or ""))


def normalizar_origem(origem: str) -> str:
    origem = str(origem or "EMITIDAS").strip().upper()

    if origem not in ORIGENS_VALIDAS:
        raise ValueError(f"Origem inválida para S3: {origem}. Use EMITIDAS ou TOMADAS.")

    return origem


def listar_meses(cnpj: str, origem: str = "EMITIDAS"):
    cnpj = limpar_cnpj_s3(cnpj)
    origem = normalizar_origem(origem)

    prefix = f"{cnpj}/{origem}/"
    resp = s3.list_objects_v2(Bucket=AWS_BUCKET_NAME, Prefix=prefix, Delimiter="/")

    meses = []
    for obj in resp.get("CommonPrefixes", []):
        meses.append(obj["Prefix"].replace(prefix, "").rstrip("/"))

    return meses


def listar_xmls_mes(cnpj: str, mes: str, origem: str = "EMITIDAS"):
    cnpj = limpar_cnpj_s3(cnpj)
    origem = normalizar_origem(origem)

    prefix = f"{cnpj}/{origem}/{mes}/"

    paginator = s3.get_paginator("list_objects_v2")
    arquivos = []

    for page in paginator.paginate(
        Bucket=AWS_BUCKET_NAME,
        Prefix=prefix
    ):
        for item in page.get("Contents", []):
            if item["Key"].lower().endswith(".xml"):
                arquivos.append(item["Key"])

    return arquivos


def baixar_xml(caminho_s3: str) -> str:
    obj = s3.get_object(Bucket=AWS_BUCKET_NAME, Key=caminho_s3)
    return obj["Body"].read().decode("utf-8", errors="ignore")