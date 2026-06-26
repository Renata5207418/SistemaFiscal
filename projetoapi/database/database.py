import os
from pymongo import MongoClient

_MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
_client = MongoClient(_MONGO_URI)

_DB = _client["CadastroEmpresas"]


def get_pre_cadastro_collection():
    """
    Retorna a coleção 'Clientes.preCadastro' do banco 'CadastroEmpresas'.
    Essa coleção armazena os dados dos clientes.
    """
    return _DB["Clientes"]["preCadastro"]


def get_users_collection():
    """
    Retorna a coleção 'users' do banco 'CadastroEmpresas'.
    Essa coleção será usada para armazenar os usuários (login/signup).
    """
    return _DB["users"]


def get_tasks_collection():
    """
    Retorna a coleção 'tasks' no banco 'CadastroEmpresas'.
    """
    return _DB["tasks"]


def get_faturamentos_collection():
    """
    Retorna a coleção 'faturamentos' no banco 'CadastroEmpresas'.
    """
    return _DB["faturamentos"]


def get_tasksfaturamentos_collection():
    return _DB["tasks.faturamentos"]

def get_tomadas_collection():
    return _DB["nfse_tomadas"]


def get_taskstomadas_collection():
    return _DB["tasks_tomadas"]


def get_valordeclarado_collection():
    return _DB["valor.declarado"]


def get_baixa_das_collection():
    return _DB["baixa.das"]


def get_guias_enviadas_collection():
    return _DB["guias.enviadas"]


def get_groups_collection():

    return _DB["groups"]


def get_certificados_collection():
    """
    Retorna a coleção 'certificados' do banco 'CadastroEmpresas'.
    O _id desta coleção é o CNPJ (apenas números).
    """
    return _DB["certificados"]


def get_rpa_historico_collection():
    """
    Retorna a coleção 'rpa_historico' no banco 'CadastroEmpresas'.
    Armazena o histórico de execuções do robô.
    """
    return _DB["rpa_historico"]


def get_tarefas_mensais_collection():
    """
    Retorna a coleção 'tarefas.mensais' do banco 'CadastroEmpresas'.
    Armazena as checklists de obrigações do escritório divididas por competência.
    """
    return _DB["tarefas.mensais"]

