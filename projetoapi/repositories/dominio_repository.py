import os
import logging
from database.db_dominio import DatabaseConnection

logger = logging.getLogger(__name__)

class DominioRepository:
    def __init__(self):
        self.db_params = {
            "host": os.getenv("DOMINIO_HOST"),
            "port": int(os.getenv("DOMINIO_PORT", 2638)),
            "dbname": os.getenv("DOMINIO_DB"),
            "user": os.getenv("DOMINIO_USER"),
            "password": os.getenv("DOMINIO_PASS")
        }

    def get_faturamento_mensal(self, inicio: str, fim: str):
        db = DatabaseConnection(**self.db_params)
        db.connect()
        try:
            return db.get_faturamento_mensal(inicio=inicio, fim=fim)
        finally:
            db.close()
            
    def get_apuracao_mensal(self, data_sim: str, codi_emp: int):
        db = DatabaseConnection(**self.db_params)
        db.connect()
        try:
            resultado = db.execute_query(
                "SELECT COUNT(*) FROM bethadba.efsdoimp WHERE data_sim = ? AND codi_emp = ?",
                (data_sim, codi_emp)
            )
            return resultado[0][0] if resultado and len(resultado) else 0
        finally:
            db.close()

    def get_imposto_dominio_mensal(self, data_sim: str):
        """Busca o valor do imposto (sdev_sim) codi_imp=44 para o primeiro dia do mês."""
        db = DatabaseConnection(**self.db_params)
        db.connect()
        try:
            query = """
            SELECT codi_emp, SUM(sdev_sim) 
            FROM bethadba.efsdoimp 
            WHERE data_sim = ? AND codi_imp = 44 
            GROUP BY codi_emp
            """
            return db.execute_query(query, (data_sim,))
        finally:
            db.close()     

    def get_todas_apuracoes_mensal(self, data_sim: str):
        """Verifica de uma vez só quais empresas têm registro gerado no mês."""
        db = DatabaseConnection(**self.db_params)
        db.connect()
        try:
            query = """
            SELECT codi_emp, COUNT(*) 
            FROM bethadba.efsdoimp 
            WHERE data_sim = ? 
            GROUP BY codi_emp
            """
            return db.execute_query(query, (data_sim,))
        finally:
            db.close()