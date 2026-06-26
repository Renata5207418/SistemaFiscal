import calendar
from datetime import datetime
from repositories.dominio_repository import DominioRepository

class FaturamentoService:
    def __init__(self):
        self.dominio_repo = DominioRepository()

    def obter_faturamento_dominio(self, mesano: str) -> list[dict]:
        """
        Recebe 'YYYYMM', calcula o primeiro e último dia do mês e busca no banco Domínio.
        """
        ano = int(mesano[:4])
        mes = int(mesano[4:])
        
        primeiro_dia = datetime(ano, mes, 1).strftime("%Y-%m-%d")
        ultimo_dia_num = calendar.monthrange(ano, mes)[1]
        ultimo_dia = datetime(ano, mes, ultimo_dia_num).strftime("%Y-%m-%d")

        resultados = self.dominio_repo.get_faturamento_mensal(inicio=primeiro_dia, fim=ultimo_dia)

        if not resultados:
            return []

        # Mapeia a tupla do banco para a lista de dicionários esperada pelo Front
        return [
            {
                "cod_cliente": codi,
                "ano": ano,
                "mes": mes,
                "total_faturamento": float(total)
            }
            for codi, _, _, total in resultados
        ]
    