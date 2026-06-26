import calendar
from datetime import datetime
from repositories.dominio_repository import DominioRepository
from database.database import get_pre_cadastro_collection, get_faturamentos_collection, get_valordeclarado_collection

class TabelasService:
    def __init__(self):
        self.dominio_repo = DominioRepository()
        self.clientes_col = get_pre_cadastro_collection()
        self.fat_col = get_faturamentos_collection()
        self.decl_col = get_valordeclarado_collection()

    def obter_dados_faturamento(self, mesano: str) -> list[dict]:
        # 1. Busca faturamento do Portal (XML)
        docs_fat = self.fat_col.find({"mesano": mesano})
        fat_portal = {doc["cod_cliente"]: doc.get("total_valor_servicos", 0.0) for doc in docs_fat}

        # 2. Busca faturamento do Domínio (Sybase)
        ano, mes = int(mesano[:4]), int(mesano[4:])
        inicio = datetime(ano, mes, 1).strftime("%Y-%m-%d")
        fim = datetime(ano, mes, calendar.monthrange(ano, mes)[1]).strftime("%Y-%m-%d")
        
        resultados_dom = self.dominio_repo.get_faturamento_mensal(inicio=inicio, fim=fim)
        fat_dominio = {row[0]: float(row[3]) for row in (resultados_dom or [])}

        # 3. Consolida APENAS clientes ativos e marcados para ROTINA
        tabela = []
        for cli in self.clientes_col.find({"ativo": True, "rotina": True}):
            nome = cli.get("empresa", "")
            cod = cli["_id"]
            
            val_portal = fat_portal.get(cod, 0.0)
            val_dominio = fat_dominio.get(cod, 0.0)
            diferenca = round(val_portal - val_dominio, 2)

            tabela.append({
                "cod_cliente": cod,
                "empresa": nome,
                "diferenca_faturamento": diferenca,
                "tooltip_portal": val_portal,
                "tooltip_dominio": val_dominio
            })
            
        return tabela

    def obter_dados_declaracao(self, mesano: str) -> list[dict]:
        # 1. Busca valores declarados (MongoDB)
        docs_decl = self.decl_col.find({"mesano": mesano})
        val_declarado = {}
        erros_declaracao = {}
        for doc in docs_decl:
            cod = doc["cod_cliente"]
            declarado = doc.get("declarado")
            
            if isinstance(declarado, (int, float)):
                val_declarado[cod] = float(declarado)
            else:
                try:
                    val_declarado[cod] = float(str(declarado).replace(".", "").replace(",", "."))
                except:
                    # Captura a mensagem de erro da Serpro se não for número
                    msgs = doc.get("retorno", {}).get("serpro_body", {}).get("mensagens", [])
                    erros_declaracao[cod] = msgs[0].get("texto") if msgs else str(declarado)

        # 2. Busca impostos calculados no Domínio (Sybase)
        ano, mes = mesano[:4], mesano[4:]
        data_sim = f"{ano}-{mes}-01"
        resultados_imp = self.dominio_repo.get_imposto_dominio_mensal(data_sim=data_sim)
        imp_dominio = {row[0]: float(str(row[1]).replace(",", ".")) for row in (resultados_imp or [])}

        # 3. Consolida para a tela (APENAS ativos e rotina)
        tabela = []
        for cli in self.clientes_col.find({"ativo": True, "rotina": True}):
            nome = cli.get("empresa", "")
            cod = cli["_id"]
            v_dominio = imp_dominio.get(cod, 0.0)
            
            if cod in erros_declaracao:
                diferenca = "ERRO"
                v_portal = 0.0
                erro_txt = erros_declaracao[cod]
            else:
                v_portal = val_declarado.get(cod, 0.0)
                diferenca = round(v_portal - v_dominio, 2)
                erro_txt = None

            tabela.append({
                "cod_cliente": cod,
                "empresa": nome,
                "diferenca_declarado": diferenca,
                "tooltip_declarado": v_portal,
                "tooltip_dominio": v_dominio,
                "erro_texto": erro_txt
            })
            
        return tabela