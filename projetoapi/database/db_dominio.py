import os
from dotenv import load_dotenv

load_dotenv()

# Prepara SQL Anywhere somente no Linux.
# No Windows não faz nada.
# Precisa acontecer antes do import pyodbc.
if os.name != "nt":
    try:
        from utils.sqlany_env import preparar_ambiente_sqlanywhere
        preparar_ambiente_sqlanywhere()
    except Exception as e:
        print(f"[SQLANY] Aviso: não foi possível preparar ambiente SQL Anywhere: {e}")
        

import pyodbc
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO)

class DatabaseConnection:
    def __init__(self, host=None, port=None, dbname=None, user=None, password=None):
        self.host = host or os.getenv("DOMINIO_HOST")
        self.port = port or os.getenv("DOMINIO_PORT", "2638")
        self.dbname = dbname or os.getenv("DOMINIO_DB")
        self.user = user or os.getenv("DOMINIO_USER")
        self.password = password or os.getenv("DOMINIO_PASSWORD")

        tcpip_host = "dominio.scryta" if self.host == "dominio" else self.host
        
        self.conn_str_raw = (
            "DRIVER=SQL Anywhere 17;"
            f"UID={self.user};"
            f"PWD={self.password};"
            f"ENG=dominio;"
            f"DBN={self.dbname};"
            f"LINKS=TCPIP(host={tcpip_host}:{self.port});"
        )
        self.conn = None

    def connect(self):
        """Estabelece conexão com o banco de dados."""
        try:
            logging.info(f"Tentando conectar ao banco via pyodbc: {self.conn_str_raw.replace(self.password, '***')}") 
            self.conn = pyodbc.connect(self.conn_str_raw)
        except pyodbc.Error as e:
            logging.error(f"Erro ao conectar ao banco de dados: {e}")
            self.conn = None

    def close(self):
        """Fecha a conexão com o banco de dados."""
        if self.conn is not None:
            self.conn.close()

    def execute_query(self, query, params=None):
        """Executa uma consulta SQL e retorna os resultados."""
        if self.conn is None:
            logging.error("Conexão ao banco não estabelecida.")
            return None
        cursor = self.conn.cursor()
        try:
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
            return cursor.fetchall()
        except pyodbc.Error as e:
            logging.error(f"Erro ao executar a consulta: {e}")
            return None
        finally:
            cursor.close()

    def get_faturamento_mensal(self, inicio=None, fim=None, codi_emp=None):
        """
        Retorna a soma do faturamento por cliente e por mês.
        """
        filtros = []
        params = []

        if inicio:
            filtros.append("dser_ser >= ?")
            params.append(inicio)
        if fim:
            filtros.append("dser_ser <= ?")
            params.append(fim)
        if codi_emp:
            filtros.append("codi_emp = ?")
            params.append(codi_emp)

        where = f"WHERE {' AND '.join(filtros)}" if filtros else ""

        query = f"""
        SELECT
          codi_emp,
          YEAR(dser_ser) AS ano,
          MONTH(dser_ser) AS mes,
          SUM(vcon_ser)      AS total_faturamento
        FROM bethadba.efservicos
        {where}
        GROUP BY
          codi_emp,
          YEAR(dser_ser),
          MONTH(dser_ser)
        ORDER BY
          codi_emp,
          ano,
          mes;
        """

        logging.info("Executando query de faturamento mensal...")
        resultados = self.execute_query(query, tuple(params))
        return resultados

    def get_faturamento_acumulado(self, codi_list, ano, mes):
        inicio = f"{ano}-01-01"
        fim = f"{ano}-{mes:02d}-01"
        filtros = ["dser_ser >= ?", "dser_ser < ?"]
        params = [inicio, fim]
        if codi_list:
            placeholders = ",".join("?" for _ in codi_list)
            filtros.append(f"codi_emp IN ({placeholders})")
            params += codi_list
        where = "WHERE " + " AND ".join(filtros)
        query = f"""
          SELECT codi_emp, SUM(vcon_ser) AS total
          FROM bethadba.efservicos
          {where}
          GROUP BY codi_emp
        """
        rows = self.execute_query(query, tuple(params))
        return [(row[0], float(row[1])) for row in rows]

    def get_todas_apuracoes_mensal(self, data_sim):
        """Retorna os códigos das empresas que possuem apuração no mês."""
        query = "SELECT DISTINCT codi_emp FROM bethadba.efsdoimp WHERE data_sim = ?"
        rows = self.execute_query(query, (data_sim,))
        return [row[0] for row in (rows or [])]

    def get_impostos_apurados_mensal(self, data_sim, codi_imp=44):
        """Busca o valor somado de um imposto específico (Padrão 44 - Simples Nacional)."""
        query = """
            SELECT codi_emp, SUM(sdev_sim) 
            FROM bethadba.efsdoimp 
            WHERE data_sim = ? AND codi_imp = ? 
            GROUP BY codi_emp
        """
        rows = self.execute_query(query, (data_sim, codi_imp))
        return {row[0]: float(str(row[1]).replace(",", ".")) for row in (rows or [])}

    def get_fator_r_dados(self, ano, mes):
        """Busca os índices de Fator R calculados no Domínio trazendo Nome e CNPJ."""
        query = """
        SELECT
            ge.codi_emp,
            ge.nome_emp,
            ge.cgce_emp,
            MAX(imp.vdi6_sim) * 100 AS fator_r_percentual,
            MAX(sn.anexo) AS anexo,
            MAX(tab.descricao) AS descricao,
            MAX(sn.data_sim) AS data_sim
        FROM bethadba.efsdoimp_simples_nacional sn
        JOIN bethadba.geempre ge ON ge.codi_emp = sn.filial
        JOIN bethadba.efsdoimp imp ON 
            imp.codi_emp = sn.filial AND 
            imp.data_sim = sn.data_sim AND 
            imp.codi_imp = 44
        LEFT JOIN bethadba.eftabela_simples_nacional_tabela tab ON 
            tab.anexo = sn.anexo AND 
            tab.secao = sn.secao AND 
            tab.tabela = sn.tabela AND 
            tab.vigencia = (
                SELECT MAX(v.vigencia) 
                FROM bethadba.eftabela_simples_nacional_tabela v 
                WHERE v.anexo = sn.anexo AND v.secao = sn.secao AND v.tabela = sn.tabela 
                AND v.vigencia <= sn.data_sim
            )
        WHERE YEAR(sn.data_sim) = ? AND MONTH(sn.data_sim) = ?
          AND sn.anexo IN (3, 5)
          AND (
              sn.anexo = 5 
              OR (sn.anexo = 3 AND LOWER(tab.descricao) LIKE '%fator%')
              OR imp.vdi6_sim > 0
          )
          AND (tab.descricao IS NULL OR LOWER(tab.descricao) NOT LIKE '%n%o sujeito%')
        GROUP BY ge.codi_emp, ge.nome_emp, ge.cgce_emp
        ORDER BY ge.codi_emp
        """
        rows = self.execute_query(query, (ano, mes))
        return rows if rows else []

if __name__ == "__main__":
   
    db = DatabaseConnection()
    db.connect()

    totais = db.get_faturamento_mensal()
    if totais:
        for codi, ano, mes, total in totais:
            valor = float(total)
            data_str = datetime(ano, mes, 1).strftime("%Y-%m")
            print(f"Cliente {codi} — {data_str}: R$ {valor:,.2f}")

    db.close()