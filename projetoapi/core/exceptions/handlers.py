import logging
from fastapi import Request, status
from fastapi.responses import JSONResponse
from core.schemas.response import error_response

logger = logging.getLogger(__name__)

async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Erro não tratado na rota {request.url.path}: {exc}")
    # Mascara erros internos para o usuário, mas joga no log
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=error_response("Ocorreu um erro interno no servidor. Tente novamente mais tarde.")
    )

async def custom_http_exception_handler(request: Request, exc):
    # Trata os HTTPException que você já joga no código (ex: 400, 404)
    return JSONResponse(
        status_code=exc.status_code,
        content=error_response(exc.detail)
    )
