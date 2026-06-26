import logging
from datetime import datetime, timezone
from bson import ObjectId
from pymongo import ReturnDocument
from database.database import _DB  # Pegando a referência direta do banco

logger = logging.getLogger(__name__)

class TaskRepository:
    def __init__(self):
        # Criamos uma nova collection dedicada ao motor novo para não quebrar a antiga
        self.collection = _DB["fila_tarefas"]

    def criar_tarefa(self, dados: dict) -> str:
        agora = datetime.now(timezone.utc)
        dados["status"] = "PENDENTE"
        dados["created_at"] = agora
        dados["updated_at"] = agora
        resultado = self.collection.insert_one(dados)
        return str(resultado.inserted_id)

    def buscar_tarefa_existente(self, tipo: str, cliente_cod: int, mesano: str, status: list):
        """Evita duplicar tarefas iguais que já estão pendentes ou concluídas"""
        return self.collection.find_one({
            "tipo": tipo,
            "cliente_cod": cliente_cod,
            "mesano": mesano,
            "status": {"$in": status}
        })

    def obter_proxima_tarefa_pendente(self, tipo: str = None) -> dict:
        """Busca uma pendente e já trava ela como EM_ANDAMENTO (Atomicidade)"""
        filtro = {"status": "PENDENTE"}
        if tipo:
            filtro["tipo"] = tipo

        agora = datetime.now(timezone.utc)
        tarefa = self.collection.find_one_and_update(
            filtro,
            {"$set": {"status": "EM_ANDAMENTO", "updated_at": agora}},
            sort=[("created_at", 1)], # Pega a mais antiga primeiro (FIFO)
            return_document=ReturnDocument.AFTER
        )
        return tarefa

    def atualizar_status(self, task_id: str, status: str, resultado: dict = None, error_msg: str = None):
        agora = datetime.now(timezone.utc)
        update_data = {"status": status, "updated_at": agora}
        
        if resultado is not None:
            update_data["resultado"] = resultado
        if error_msg is not None:
            update_data["error_msg"] = error_msg

        self.collection.update_one(
            {"_id": ObjectId(task_id)},
            {"$set": update_data}
        )
        

    def listar_tarefas(self, skip: int = 0, limit: int = 100, status_filter: str = None) -> list:
        """Lista as tarefas com paginação e filtro opcional de status."""
        filtro = {}
        if status_filter:
            filtro["status"] = status_filter
            
        cursor = self.collection.find(filtro).sort("created_at", -1).skip(skip).limit(limit)
        return list(cursor)


    def reprocessar_tarefa(self, task_id: str) -> dict:
        """Pega uma tarefa em ERRO e joga de volta para PENDENTE."""
        agora = datetime.now(timezone.utc)
        tarefa = self.collection.find_one_and_update(
            {"_id": ObjectId(task_id), "status": "ERRO"},
            {"$set": {"status": "PENDENTE", "updated_at": agora, "error_msg": None}},
            return_document=ReturnDocument.AFTER
        )
        return tarefa    