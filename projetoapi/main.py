import logging
import os
import glob
from fastapi import FastAPI, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware 
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from datetime import datetime
from core.exceptions.handlers import global_exception_handler, custom_http_exception_handler
from login.auth import router as auth_router, get_current_user
from api.usuarios import router as usuarios_router
from api.endpoints import router as cliente_router
from api.automacao_endpoints import router as automacao_router
from api.dashboard_endpoints import router as dashboard_router
from api.certificados import router as certificados_router

logging.getLogger("asyncio").setLevel(logging.CRITICAL)

app = FastAPI(title="Fiscal Core")

# --- CONFIGURAÇÃO DE CORS (LIBERA O FRONTEND) ---
# Adicionado para permitir que o Vite (5173) fale com o FastAPI (8000)
origins = [
    "*",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://10.0.0.172:5174",
    "http://172.18.0.1:5174",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"], # Permite POST, GET, OPTIONS, etc.
    allow_headers=["*"], # Permite Authorization, Content-Type, etc.
)

# --- Registrando Exception Handlers ---
app.add_exception_handler(Exception, global_exception_handler)
app.add_exception_handler(StarletteHTTPException, custom_http_exception_handler)

@app.middleware("http")
async def allow_private_network_requests(request: Request, call_next):
    response: Response = await call_next(request)
    # Mantendo sua regra de rede privada
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


# ==============================================================================
# --- ROTA DE MONITORAMENTO PARA O COMMAND CENTER ---
# ==============================================================================
def ler_ultimas_linhas_log(caminho_arquivo: str, qtd_linhas: int = 5) -> list:
    """Lê as últimas N linhas de um arquivo físico de log."""
    if not os.path.exists(caminho_arquivo):
        return ["Log não encontrado. Sistema ONLINE."]
    try:
        with open(caminho_arquivo, "r", encoding="utf-8") as f:
            # Pega as linhas, remove espaços vazios e ignora linhas em branco
            linhas = [linha.strip() for linha in f.readlines() if linha.strip()]
            return linhas[-qtd_linhas:] if linhas else ["Log vazio. Sistema ONLINE."]
    except Exception as e:
        return [f"Erro ao ler arquivo de log: {str(e)}"]


# Rota pública (sem o get_current_user) para o Streamlit conseguir ler
@app.get("/status_painel", tags=["Monitoramento"])
async def status_painel():
    padrao_busca = "local_storage/logs/*.log" 
    arquivos_log = glob.glob(padrao_busca)
    
    if not arquivos_log:
        mensagens = ["Aguardando geracao de log. Sistema ONLINE."]
    else:
        arquivo_mais_recente = max(arquivos_log, key=os.path.getmtime)
        mensagens = ler_ultimas_linhas_log(arquivo_mais_recente)
    
    return {
        "is_running": True, 
        "messages": mensagens,
        "last_update": datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    }


# --- ROTAS ---
app.include_router(auth_router, prefix="/api")
app.include_router(cliente_router, prefix="/api", dependencies=[Depends(get_current_user)])
app.include_router(automacao_router, prefix="/api", dependencies=[Depends(get_current_user)])
app.include_router(dashboard_router, prefix="/api", dependencies=[Depends(get_current_user)])
app.include_router(certificados_router, prefix="/api/certificados", dependencies=[Depends(get_current_user)])
app.include_router(usuarios_router, prefix="/api")

if __name__ == "__main__":
    import uvicorn
    # Rodando na porta 8000 para bater com o terminal
    uvicorn.run(app, host="0.0.0.0", port=8001)
    