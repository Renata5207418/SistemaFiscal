import pandas as pd
from datetime import datetime, timezone
import re
from io import BytesIO
from database.database import get_pre_cadastro_collection, get_certificados_collection

class RelatoriosService:
    def __init__(self):
        self.clientes_col = get_pre_cadastro_collection()
        self.certificados_col = get_certificados_collection()

    def gerar_excel_certificados(self) -> BytesIO:
        """
        Gera um arquivo Excel em memória com a lista de clientes,
        status do certificado e dias para o vencimento.
        """
        clientes = self.clientes_col.find().sort("_id", 1)
        certificados = {doc["_id"]: doc for doc in self.certificados_col.find()}
        
        hoje = datetime.now(timezone.utc).date()
        dados_planilha = []

        for cli in clientes:
            nome = cli.get("empresa", "")
            email = cli.get("email", "")
            
            # Filtro de segurança e consistência para relatórios gerenciais
            if "Leandro" in nome or "Paula Francielle" in nome or "fiscal17@scryta.com.br" in email:
                continue

            cnpj_raw = cli.get("cnpj", "")
            cnpj_limpo = re.sub(r'\D', '', cnpj_raw)
            cert = certificados.get(cnpj_limpo)

            vencido = "Sim"
            dias_para_vencer = "Sem certificado"
            validade_str = "-"

            if cert:
                validade_db = cert.get("Validade", "")
                if validade_db and "-" in validade_db:
                    try:
                        ano, mes, dia = map(int, validade_db.split("-"))
                        data_validade = datetime(ano, mes, dia).date()
                        dias = (data_validade - hoje).days
                        
                        validade_str = f"{dia:02d}/{mes:02d}/{ano}"
                        dias_para_vencer = dias
                        vencido = "Não" if dias >= 0 else "Sim"
                    except Exception:
                        pass

            dados_planilha.append({
                "Cód": cli.get("_id"),
                "Empresa": nome,
                "CNPJ": cnpj_raw,
                "Regime": cli.get("regime_tributario", ""),
                "Validade": validade_str,
                "Vencido?": vencido,
                "Dias para Vencer": dias_para_vencer
            })

        # Cria o DataFrame do Pandas
        df = pd.DataFrame(dados_planilha)
        
        # Gera o Excel em memória (Buffer)
        buffer = BytesIO()
        with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Certificados')
            
            # Ajuste simples de largura das colunas
            worksheet = writer.sheets['Certificados']
            for col in worksheet.columns:
                max_length = 0
                column = col[0].column_letter
                for cell in col:
                    try:
                        if len(str(cell.value)) > max_length:
                            max_length = len(cell.value)
                    except:
                        pass
                worksheet.column_dimensions[column].width = min(max_length + 2, 50)

        buffer.seek(0)
        return buffer
    