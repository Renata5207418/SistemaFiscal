# 📊 Sistema Fiscal Core - Automação e Gestão Contábil

Um sistema completo de automação fiscal e painel executivo para escritórios de contabilidade. Este projeto integra dados do sistema Domínio (Sybase), notas fiscais armazenadas na AWS S3 e automações de transmissão no eCAC/Serpro, centralizando o controle de rotinas mensais (Simples Nacional e Regime Normal) em uma interface moderna e inteligente.

## 🚀 Principais Funcionalidades

### 1\. Painel Executivo (Dashboard)

  * **Checklist Inteligente:** Controle de tarefas mensais (Início, Meio e Fim do mês) com cálculo automático de atrasos baseado no conceito de Mês de Competência vs. Mês de Execução.
  * **Saúde dos Certificados:** Monitoramento em tempo real de certificados digitais vencidos ou a vencer nos próximos 30 dias.
  * **Alertas de Fator R:** Cruzamento de dados da Domínio para alertar sobre empresas em risco (\<= 28%) ou atenção (28%-30%).
  * **Progresso de Postagens:** Visão em tempo real das guias publicadas para o cliente via integração Onvio.

### 2\. Automação de Faturamento

  * Integração direta com **AWS S3** para busca de XMLs de notas fiscais emitidas.
  * Recálculo automático de faturamento via parser de XML, separando serviços conforme o regime tributário.
  * Comparativo automático (Divergências) entre o faturamento calculado pelos XMLs e o valor apurado no banco SQL da Domínio.

### 3\. Automação de Guias (PGDAS e DAS)

  * Transmissão automatizada via fila de processamento.
  * **Trava de Segurança (Compliance):** O sistema valida o valor retornado pelo eCAC contra o valor apurado internamente na Domínio. Em caso de diferença de centavos, o processo é interrompido e a geração do DAS é bloqueada, evitando guias incorretas.
  * Lógica inteligente de Auto-Retificadora para recálculo no eCAC.
  * Geração e armazenamento seguro de PDFs em diretórios de rede e base64 no MongoDB.

### 4\. Background Jobs & Filas (Scheduler)

  * Arquitetura resiliente baseada em banco de dados: o sistema gera as tarefas de fechamento e uma fila (`Workers`) processa os clientes um a um.
  * Sincronização inteligente com a AWS S3 usando *Multi-threading* para atualizar deltas de faturamento.
  * *Watchdogs* integrados para monitorar e derrubar tarefas travadas.

-----

## 🛠️ Arquitetura e Tecnologias

O projeto está dividido em duas frentes dentro deste repositório (*monorepo*):

  * **Backend (`/projetoapi`)**:

      * [Python](https://www.python.org/) + [FastAPI](https://fastapi.tiangolo.com/) (API REST rápida e moderna)
      * [MongoDB](https://www.mongodb.com/) (Banco de dados NoSQL para logs, filas e dados dinâmicos)
      * [PyODBC](https://github.com/mkleehammer/pyodbc) (Conexão direta com o banco Sybase do sistema Domínio)
      * [Boto3](https://boto3.amazonaws.com/v1/documentation/api/latest/index.html) (Integração com AWS S3)
      * [APScheduler](https://apscheduler.readthedocs.io/) (Agendamento de rotinas de fundo)

  * **Frontend (`/SistemaSimples`)**:

      * [React](https://reactjs.org/) + [TypeScript](https://www.typescriptlang.org/) (Construído com Vite)
      * [Tailwind CSS](https://tailwindcss.com/) (Estilização responsiva e moderna)
      * [ApexCharts](https://apexcharts.com/) (Gráficos do painel executivo)
      * [Lucide React](https://lucide.dev/) (Ícones)

-----

## ⚙️ Configuração e Instalação

### Pré-requisitos

  * Python 3.10+
  * Node.js 18+
  * Acesso à rede da empresa (Mapeamento Z: / Servidor RPA)
  * MongoDB rodando localmente ou na nuvem

### Configurando o Backend

1.  Entre na pasta do backend (`cd projetoapi`)
2.  Crie e ative o ambiente virtual (`python -m venv .venv` e `source .venv/bin/activate`)
3.  Instale as dependências (`pip install -r requirements.txt`)
4.  Crie um arquivo `.env` na raiz da pasta `projetoapi` com as seguintes variáveis:
      * MONGO\_URI
      * DOMINIO\_DSN
      * AWS\_ACCESS\_KEY\_ID
      * AWS\_SECRET\_ACCESS\_KEY
      * AWS\_REGION
      * AWS\_BUCKET\_NAME
      * URL\_PGDAS
      * URL\_DAS
5.  Inicie o servidor (`python main.py`)

### Configurando o Frontend

1.  Entre na pasta do frontend (`cd SistemaSimples`)
2.  Instale as dependências (`npm install`)
3.  Inicie o servidor de desenvolvimento (`npm run dev`)

-----

## 🤝 Créditos e Refatoração

Este projeto é uma **refatoração e evolução arquitetônica** de um sistema inicialmente idealizado e desenvolvido por **[Kailane (KaiDCC)](https://github.com/KaiDCC)**.

As melhorias trazidas nesta versão focam em escalabilidade, segurança e design de código, incluindo:

  * **Arquitetura & Performance:** Implementação de banco de dados NoSQL (MongoDB) para filas de processamento resilientes e transição para integrações assíncronas com FastAPI.

* **Modularização:** Reestruturação do código utilizando Design Patterns para facilitar a manutenção e escalabilidade.

* **Precisão Contábil:** Separação lógica entre Mês de Execução vs. Competência em todo o sistema.

* **Compliance Fiscal:** Implementação da Trava de Conformidade eCAC x Domínio, garantindo que guias só sejam geradas se os valores baterem.

* **Gestão Estratégica:** Inclusão da tela de acompanhamento de Fator R e implementação do checklist de controle das atividades mensais por ondas.

* **UX/UI:** Reformulação completa da interface com foco em usabilidade, indicadores visuais (KPIs) e suporte a tomada de decisão.


-----



## ⚖️ Licença e Propriedade Intelectual
Copyright © 2026 

Este software é um produto de propriedade privada e confidencial. O acesso ao código-fonte é restrito a colaboradores autorizados da empresa.

Proibida a reprodução: Nenhuma parte deste sistema pode ser copiada, modificada, distribuída ou transmitida de qualquer forma ou por qualquer meio sem a autorização prévia por escrito da diretoria.

Uso restrito: O uso deste software é exclusivo para as operações internas da empresa e seus clientes autorizados.