import asyncio
import logging
from repositories.task_repository import TaskRepository
from services.declaracao_service import DeclaracaoService

# Configurando log específico para o Worker
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] WORKER: %(message)s")
logger = logging.getLogger(__name__)

async def processar_fila():
    logger.info("Iniciando Worker da Fila de Tarefas...")
    repo = TaskRepository()
    declaracao_service = DeclaracaoService()

    while True:
        try:
            # Busca a próxima tarefa pendente e trava ela (Atomicidade)
            tarefa = repo.obter_proxima_tarefa_pendente()
            
            if not tarefa:
                # Se a fila estiver vazia, dorme 5 segundos e olha de novo
                await asyncio.sleep(5)
                continue

            task_id = str(tarefa["_id"])
            logger.info(f"Processando Tarefa {task_id} | Tipo: {tarefa['tipo']} | Cliente: {tarefa['cliente_cod']}")

            resultado = None
            
            # --- ROTEADOR DE TAREFAS ---
            if tarefa["tipo"] == "GERAR_PGDAS_DAS":
                resultado = await declaracao_service.processar_pipeline_completo(
                    cliente_cod=tarefa["cliente_cod"],
                    mesano=tarefa["mesano"],
                    username=tarefa.get("username", "sistema")
                )
            else:
                raise NotImplementedError(f"Tipo de tarefa {tarefa['tipo']} ainda não implementado no Worker.")

            # Atualiza para CONCLUIDO
            repo.atualizar_status(task_id, "CONCLUIDO", resultado=resultado)
            logger.info(f"Tarefa {task_id} concluída com SUCESSO.")

        except Exception as e:
            logger.error(f"Erro ao processar tarefa: {e}")
            if 'tarefa' in locals() and tarefa:
                # Atualiza para ERRO
                repo.atualizar_status(str(tarefa["_id"]), "ERRO", error_msg=str(e))
            await asyncio.sleep(5) # Pausa de segurança após um erro

if __name__ == "__main__":
    asyncio.run(processar_fila())
    