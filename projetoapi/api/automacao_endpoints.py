from fastapi import APIRouter

from api.automacao_routes.emitidas import router as emitidas_router
from api.automacao_routes.emitidas import faturamento_dominio_sql
from api.automacao_routes.tomadas import router as tomadas_router
from api.automacao_routes.declaracoes import router as declaracoes_router
from api.automacao_routes.guias import router as guias_router
from api.automacao_routes.rpa import router as rpa_router
from api.automacao_routes.tabelas import router as tabelas_router
from api.automacao_routes.paineis import router as paineis_router


router = APIRouter(prefix="/automacao")

router.include_router(emitidas_router)
router.include_router(tomadas_router)
router.include_router(declaracoes_router)
router.include_router(guias_router)
router.include_router(rpa_router)
router.include_router(tabelas_router)
router.include_router(paineis_router)