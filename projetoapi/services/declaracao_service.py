import os
import httpx
import base64
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from bson import ObjectId  
from automacao.config import PDF_DIR
from database.db_dominio import DatabaseConnection
from database.database import (
    get_valordeclarado_collection, 
    get_baixa_das_collection, 
    get_pre_cadastro_collection,
    get_guias_enviadas_collection,
    get_tasks_collection  
)

class DeclaracaoService:
    def __init__(self):
        self.is_dev = os.getenv("ENVIRONMENT") == "development"
        self.url_parceiro_pgdas = os.getenv("URL_PGDAS", "http://10.0.0.172:6200/transmitir-pgdas")
        self.url_parceiro_das = os.getenv("URL_DAS", "http://10.0.0.172:6200/gerar-das")
        self.val_col = get_valordeclarado_collection()
        self.das_col = get_baixa_das_collection()
        self.cli_col = get_pre_cadastro_collection()
        self.guias_col = get_guias_enviadas_collection()
        self.tasks_col = get_tasks_collection()

    def _salvar_pdf(self, cod_cliente: int, tipo: str, mesano: str, base64_str: str, hash_id: str) -> str:
        PDF_DIR.mkdir(parents=True, exist_ok=True)
        ano, mes = mesano[:4], mesano[4:]
        nome_arquivo = f"{cod_cliente}-{tipo}-{mes}{ano}-{hash_id}.pdf"
        caminho = PDF_DIR / nome_arquivo
        with open(caminho, "wb") as f:
            f.write(base64.b64decode(base64_str))
        return str(caminho)

    async def processar_pipeline_completo(self, cliente_cod: int, mesano: str, username: str, tipoDeclaracao: int = 1, task_id: str = None) -> dict:
        cliente = self.cli_col.find_one({"_id": cliente_cod})
        if not cliente:
            raise ValueError(f"Cliente {cliente_cod} não encontrado.")
        
        cnpj = cliente["cnpj"]
        pa_int = int(mesano)
        now = datetime.now(timezone.utc)

        # Atualiza Monitor: Iniciando PGDAS
        if task_id:
            self.tasks_col.update_one({"_id": ObjectId(task_id)}, {"$set": {"step": "pgdas_processando", "updated_at": datetime.now(timezone.utc)}})

        # ==========================================
        # ETAPA 1: TRANSMITIR PGDAS
        # ==========================================
        payload_pgdas = {"pa": pa_int, "cnpjs": [cnpj], "tipoDeclaracao": tipoDeclaracao}
        
        async with httpx.AsyncClient(timeout=45.0) as client_http:
            resp_pgdas = await client_http.post(self.url_parceiro_pgdas, json=payload_pgdas)
            
        if resp_pgdas.status_code != 200:
            if task_id:
                self.tasks_col.update_one({"_id": ObjectId(task_id)}, {"$set": {"step": "pgdas_erro", "error_msg": f"Erro HTTP {resp_pgdas.status_code}", "updated_at": datetime.now(timezone.utc)}})
            raise Exception(f"Erro no parceiro PGDAS: HTTP {resp_pgdas.status_code}")
            
        dados_pgdas = resp_pgdas.json().get("resultados", [])[0]
        status_pgdas = dados_pgdas.get("status")
        
        texto_erro = None
        retorno_completo = None
        tipo_enviado = tipoDeclaracao

        # === INTELIGÊNCIA: AUTO-RETIFICADORA ===
        if status_pgdas != "SUCESSO":
            retorno_completo = {"serpro_body": dados_pgdas.get("serpro_body", {})}
            mensagens = dados_pgdas.get("serpro_body", {}).get("mensagens", [])
            texto_erro = mensagens[0].get("texto") if mensagens else dados_pgdas.get("erro", "Erro na SERPRO")
            
            # Se tentou como Original (1) e a Serpro pediu Retificadora (2), tenta de novo automaticamente
            if tipo_enviado == 1 and texto_erro and "2-Retificadora" in texto_erro:
                tipo_enviado = 2
                payload_pgdas["tipoDeclaracao"] = 2
                
                # Atualiza Monitor: Tentando Retificadora
                if task_id:
                    self.tasks_col.update_one({"_id": ObjectId(task_id)}, {"$set": {"step": "pgdas_retificando", "updated_at": datetime.now(timezone.utc)}})
                
                async with httpx.AsyncClient(timeout=45.0) as client_http:
                    resp_pgdas = await client_http.post(self.url_parceiro_pgdas, json=payload_pgdas)
                
                if resp_pgdas.status_code == 200:
                    dados_pgdas = resp_pgdas.json().get("resultados", [])[0]
                    status_pgdas = dados_pgdas.get("status")
                    
                    if status_pgdas != "SUCESSO":
                        retorno_completo = {"serpro_body": dados_pgdas.get("serpro_body", {})}
                        mensagens = dados_pgdas.get("serpro_body", {}).get("mensagens", [])
                        texto_erro = mensagens[0].get("texto") if mensagens else dados_pgdas.get("erro", "Erro na SERPRO")
                    else:
                        texto_erro = None
                        retorno_completo = None

        total_devido = dados_pgdas.get("totalDevido", 0)
        base64_pgdas = dados_pgdas.get("pdfBase64", "")
        hash_pgdas = hashlib.sha256(f"{cnpj}-{mesano}-{total_devido}".encode()).hexdigest()[:8] if base64_pgdas else None
        caminho_pgdas = None
        
        if base64_pgdas:
            caminho_pgdas = self._salvar_pdf(cliente_cod, "PGDAS", mesano, base64_pgdas, hash_pgdas)

        # Salva o histórico exato
        self.val_col.insert_one({
            "cnpj": cnpj, "cod_cliente": cliente_cod, "mesano": mesano,
            "declarado": total_devido if status_pgdas == "SUCESSO" else texto_erro,
            "retorno": retorno_completo,
            "pdf_path": caminho_pgdas, "pdf_hash": hash_pgdas,
            "created_at": now, "user": username, "tipoDeclaracao": tipo_enviado
        })

        guia_doc = {
            "cod_cliente": cliente_cod, "cnpj": cnpj, "mesano": mesano, "updated_at": now,
            "guia_enviada": False,
            "tipo_declaracao": tipo_enviado
        }
        
        if base64_pgdas:
            guia_doc["pgdas"] = {"hash": hash_pgdas, "published_at": now.isoformat(), "base64": base64_pgdas}

        self.guias_col.update_one({"cod_cliente": cliente_cod, "mesano": mesano}, {"$set": guia_doc}, upsert=True)

        # Se falhou o PGDAS, interrompe aqui
        if status_pgdas != "SUCESSO":
            if task_id:
                self.tasks_col.update_one({"_id": ObjectId(task_id)}, {"$set": {"step": "pgdas_erro", "error_msg": texto_erro, "updated_at": datetime.now(timezone.utc)}})
            return {"status_pgdas": status_pgdas, "mensagem": texto_erro, "das_gerado": False}

        # ==========================================
        # VALIDAÇÃO DE VALORES (eCAC x DOMÍNIO)
        # ==========================================
        try:
            db_dom = DatabaseConnection()
            db_dom.connect()
            data_sim = f"{mesano[:4]}-{mesano[4:]}-01"
            impostos_dominio = db_dom.get_impostos_apurados_mensal(data_sim)
            db_dom.close()

            valor_apurado_dominio = impostos_dominio.get(cliente_cod, 0.0)

            # Trava de Segurança: Diferença de 1 centavo
            if abs(total_devido - valor_apurado_dominio) >= 0.01:
                msg_divergencia = (
                    f"Divergência detectada! eCAC (R$ {total_devido:.2f}) x Domínio (R$ {valor_apurado_dominio:.2f}). "
                    "Geração do DAS interrompida."
                )
                if task_id:
                    self.tasks_col.update_one({"_id": ObjectId(task_id)}, {"$set": {"status": "erro", "step": "pgdas_divergente", "error_msg": msg_divergencia, "updated_at": datetime.now(timezone.utc)}})
                
                # Interrompe o processo e devolve o erro
                return {"status_pgdas": "DIVERGENTE", "mensagem": msg_divergencia, "das_gerado": False}
                
        except Exception as e:
            raise Exception(f"Falha na validação com o banco Domínio: {str(e)}")

        # Se passou na validação, atualiza monitor
        if task_id:
            self.tasks_col.update_one({"_id": ObjectId(task_id)}, {"$set": {"step": "pgdas_concluido", "updated_at": datetime.now(timezone.utc)}})

        # ==========================================
        # ETAPA 2: GERAR DAS
        # ==========================================
        if total_devido <= 0:
            if task_id:
                self.tasks_col.update_one({"_id": ObjectId(task_id)}, {"$set": {"step": "das_isento", "updated_at": datetime.now(timezone.utc)}})
            return {"status_pgdas": "SUCESSO", "mensagem": "Sem imposto a pagar, DAS não necessário.", "das_gerado": False}

        if task_id:
            self.tasks_col.update_one({"_id": ObjectId(task_id)}, {"$set": {"step": "das_processando", "updated_at": datetime.now(timezone.utc)}})

        payload_das = {"pa": pa_int, "cnpjs": [cnpj]}
        
        async with httpx.AsyncClient(timeout=45.0) as client_http:
            resp_das = await client_http.post(self.url_parceiro_das, json=payload_das)
            
        if resp_das.status_code != 200:
            if task_id:
                self.tasks_col.update_one({"_id": ObjectId(task_id)}, {"$set": {"step": "das_erro", "error_msg": f"Erro HTTP {resp_das.status_code} no parceiro DAS", "updated_at": datetime.now(timezone.utc)}})
            raise Exception(f"Erro no parceiro DAS: HTTP {resp_das.status_code}")

        dados_das = resp_das.json().get("resultados", [])[0]
        base64_das = dados_das.get("das_pdf_b64", "")
        
        caminho_das = None
        hash_das = hashlib.sha256(f"{cnpj}-{mesano}-DAS-{total_devido}".encode()).hexdigest()[:8] if base64_das else None
        
        if base64_das:
            caminho_das = self._salvar_pdf(cliente_cod, "DAS", mesano, base64_das, hash_das)
            self.das_col.insert_one({
                "cnpj": cnpj, "cod_cliente": cliente_cod, "mesano": mesano,
                "pdf_path": caminho_das, "pdf_hash": hash_das, "created_at": now, "requested_by": username
            })

            self.guias_col.update_one(
                {"cod_cliente": cliente_cod, "mesano": mesano},
                {"$set": {"das": {"hash": hash_das, "published_at": now.isoformat(), "base64": base64_das}}}
            )

        if task_id:
            self.tasks_col.update_one({"_id": ObjectId(task_id)}, {"$set": {"step": "das_concluido", "updated_at": datetime.now(timezone.utc)}})

        return {
            "status_pgdas": "SUCESSO",
            "das_gerado": True,
            "pgdas_pdf": caminho_pgdas,
            "das_pdf": caminho_das,
            "tipo_enviado": tipo_enviado
        }