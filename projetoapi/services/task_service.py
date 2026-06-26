from core.schemas.task import TaskCreate, TaskStatus
from repositories.task_repository import TaskRepository

class TaskService:
    def __init__(self):
        self.repo = TaskRepository()

    def agendar_tarefa(self, task_data: TaskCreate) -> dict:
        # 1. Regra de Idempotência: Verifica se já existe uma rodando ou que já deu sucesso
        existente = self.repo.buscar_tarefa_existente(
            tipo=task_data.tipo.value,
            cliente_cod=task_data.cliente_cod,
            mesano=task_data.mesano,
            status=[TaskStatus.PENDING.value, TaskStatus.PROCESSING.value, TaskStatus.SUCCESS.value]
        )

        if existente:
            return {
                "mensagem": f"Tarefa já existe com status {existente['status']}.",
                "task_id": str(existente["_id"]),
                "status": existente["status"]
            }

        # 2. Se não existe, cria a nova tarefa
        task_dict = task_data.model_dump()
        # Convertendo Enum para string antes de salvar no Mongo
        task_dict["tipo"] = task_dict["tipo"].value 
        
        task_id = self.repo.criar_tarefa(task_dict)
        
        return {
            "mensagem": "Tarefa enfileirada com sucesso.",
            "task_id": task_id,
            "status": TaskStatus.PENDING.value
        }
    