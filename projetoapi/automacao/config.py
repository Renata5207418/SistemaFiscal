import os
import logging
from pathlib import Path
from datetime import date

# Detecta se estamos rodando no Windows (produção) ou Linux (Dev local)
# No Windows, os.name é 'nt'. No Linux/Mac, é 'posix'.
IS_WINDOWS = os.name == 'nt'

# Define os caminhos baseados no ambiente
if IS_WINDOWS:
    # PRODUÇÃO
    BASE_STORAGE_DIR = Path(r"Z:\SETOR FISCAL\AUTOMACAO\0.1 - XMLS ROTINA\ROTINA XML")
    STORAGE_INDIVIDUAL = Path(r"Z:\SETOR FISCAL\AUTOMACAO\0.1 - XMLS ROTINA\INDIVIDUAIS")

    BASE_STORAGE_TOMADAS_DIR = Path(r"Z:\SETOR FISCAL\AUTOMACAO\0.1 - XMLS ROTINA\ROTINA XML TOMADOS")
    STORAGE_INDIVIDUAL_TOMADAS = Path(r"Z:\SETOR FISCAL\AUTOMACAO\0.1 - XMLS ROTINA\INDIVIDUAIS TOMADOS")

    PDF_DIR = Path(r"Z:\SETOR FISCAL\AUTOMACAO\0.2 - SIMPLES NACIONAL\0.1 - PGDAS-DAS AUTOMATICO")
    LOG_DIR = Path(r"C:\Users\Usuario\PycharmProjects\projetoapi\log")
else:
    # DESENVOLVIMENTO (Linux/VS Code)
    BASE_DIR = Path(__file__).parent.parent / "local_storage"
    BASE_STORAGE_DIR = BASE_DIR / "rotina_xml"
    STORAGE_INDIVIDUAL = BASE_DIR / "individuais"
    BASE_STORAGE_TOMADAS_DIR = BASE_DIR / "rotina_xml_tomadas"
    STORAGE_INDIVIDUAL_TOMADAS = BASE_DIR / "individuais_tomadas"
    PDF_DIR = BASE_DIR / "pgdas_das_automatico"
    LOG_DIR = BASE_DIR / "logs"


# Cria as pastas de forma segura
os.makedirs(BASE_STORAGE_DIR, exist_ok=True)
os.makedirs(STORAGE_INDIVIDUAL, exist_ok=True)
os.makedirs(BASE_STORAGE_TOMADAS_DIR, exist_ok=True)
os.makedirs(STORAGE_INDIVIDUAL_TOMADAS, exist_ok=True)
os.makedirs(PDF_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)

hoje = date.today().isoformat()
LOG_FILENAME = LOG_DIR / f"automacao_curitiba_{hoje}.log"

logging.basicConfig(
    filename=str(LOG_FILENAME),
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

# Constantes da API antiga
TOKEN = "E3AE92543C8C4B7097C2C6F85D840A28"
URL_SOAP = "https://isscuritiba.curitiba.pr.gov.br/Iss.NfseWebService/nfsews.asmx"

RETRY_TOTAL = 5
RETRY_BACKOFF = 1
RETRY_STATUS_FORCELIST = [500, 502, 503, 504]
RETRY_ALLOWED_METHODS = ["POST"]
