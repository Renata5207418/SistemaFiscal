import re
import base64
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from database.database import get_pre_cadastro_collection, get_certificados_collection
from login.auth import get_current_user
from fastapi.responses import StreamingResponse
from services.relatorios_service import RelatoriosService
# Importações para lidar com o certificado PFX
from cryptography.hazmat.primitives.serialization import pkcs12, Encoding, PrivateFormat, NoEncryption
from cryptography import x509

router = APIRouter()


# --- FUNÇÃO AUXILIAR PARA EXTRAIR CNPJ DO CERTIFICADO ---
def extrair_cnpj_do_certificado(cert: x509.Certificate) -> str:
    """
    Tenta extrair o CNPJ dos atributos do certificado digital brasileiro.
    O CNPJ geralmente fica no OID 2.16.76.1.3.3 (Pessoa Jurídica)
    ou no Common Name (CN).
    """
    try:
        # 1. Tenta buscar pelo OID específico da ICP-Brasil (2.16.76.1.3.3)
        oid_cnpj = x509.ObjectIdentifier("2.16.76.1.3.3")
        extension = cert.extensions.get_extension_for_oid(x509.ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
        general_names = extension.value

        for name in general_names:
            if isinstance(name, x509.OtherName) and name.type_id == oid_cnpj:
                # O valor vem em bytes, precisamos decodificar (formato DER)
                # Os primeiros bytes são metadados, o CNPJ são os 14 caracteres numéricos
                data = name.value
                # Decodificação simples de string dentro do DER (pula cabeçalhos)
                texto = data.decode('utf-8', errors='ignore')
                apenas_numeros = re.sub(r'\D', '', texto)
                if len(apenas_numeros) >= 14:
                    return apenas_numeros[:14]

        # 2. Se falhar, tenta pegar do Common Name (CN) ex: "EMPRESA X:00000000000000"
        for attribute in cert.subject:
            if attribute.oid == x509.NameOID.COMMON_NAME:
                valor = attribute.value
                partes = valor.split(":")
                if len(partes) > 1:
                    potencial_cnpj = re.sub(r'\D', '', partes[-1])
                    if len(potencial_cnpj) == 14:
                        return potencial_cnpj

        return ""
    except Exception as e:
        print(f"Erro ao extrair CNPJ: {e}")
        return ""


# --- ENDPOINT DE LISTAGEM (MANTIDO E MELHORADO) ---
@router.get("/listar_completos")
async def listar_clientes_com_certificados(
        current_user: dict = Depends(get_current_user)
):
    try:
        col_clientes = get_pre_cadastro_collection()
        col_certificados = get_certificados_collection()

        clientes_cursor = col_clientes.find({}).sort("_id", 1)
        certificados_cursor = col_certificados.find({})
        mapa_certificados = {doc["_id"]: doc for doc in certificados_cursor}

        lista_final = []

        for cli in clientes_cursor:
            cnpj_raw = cli.get("cnpj", "")
            cnpj_limpo = re.sub(r'\D', '', cnpj_raw)
            cert = mapa_certificados.get(cnpj_limpo)

            if cert:
                validade = cert.get("Validade", "")
                # Tenta formatar a data visualmente para DD/MM/YYYY se estiver em YYYY-MM-DD
                if validade and "-" in validade:
                    try:
                        ano, mes, dia = validade.split("-")
                        validade = f"{dia}/{mes}/{ano}"
                    except:
                        pass

                status_texto = cert.get("Status", "Indefinido")

                # Definição de classes CSS para o Front
                if status_texto == "Válido":
                    status_class = "status-valido"
                elif status_texto == "Vencido":
                    status_class = "status-vencido"
                else:
                    status_class = "status-aviso"

                ativo_bool = cert.get("Ativo", False)
                situacao_texto = "Ativo" if ativo_bool else "Inativo"
            else:
                validade = "Sem certificado"
                status_texto = "Não Vinculado"
                status_class = "status-indefinido"
                situacao_texto = "-"

            cliente_mesclado = {
                "cod": cli.get("_id"),
                "empresa": cli.get("empresa"),
                "cnpj": cnpj_raw,
                "regime_tributario": cli.get("regime_tributario", ""),
                "grupo": cli.get("grupo", "Sem grupo"),
                "ativo": cli.get("ativo", True),
                "rotina": cli.get("rotina", True),
                "cert_validade": validade,
                "cert_status": status_texto,
                "cert_class": status_class,
                "cert_situacao": situacao_texto
            }
            lista_final.append(cliente_mesclado)

        return {"empresas": lista_final}

    except Exception as e:
        print(f"Erro: {e}")
        return {"empresas": []}


# --- ENDPOINT DE UPLOAD COM VALIDAÇÃO E LEITURA ---
@router.post("/upload")
async def upload_certificado(
        file: UploadFile = File(...),
        password: str = Form(...),
        cod_cliente: int = Form(...),
        current_user: dict = Depends(get_current_user)
):
    col_clientes = get_pre_cadastro_collection()
    col_certificados = get_certificados_collection()

    # 1. Busca Cliente no Banco para pegar CNPJ esperado
    cliente_db = col_clientes.find_one({"_id": cod_cliente})
    if not cliente_db:
        raise HTTPException(404, "Cliente não encontrado no cadastro.")

    cnpj_cliente_raw = cliente_db.get("cnpj", "")
    cnpj_cliente_limpo = re.sub(r'\D', '', cnpj_cliente_raw)

    if len(cnpj_cliente_limpo) != 14:
        raise HTTPException(400, "O cliente selecionado não tem um CNPJ válido cadastrado.")

    # 2. Ler o arquivo da memória
    try:
        pfx_data = await file.read()
    except Exception:
        raise HTTPException(400, "Falha ao ler o arquivo enviado.")

    # 3. Tentar abrir o PFX com a Senha
    try:
        # Carrega o PFX (Chave privada e Certificado)
        private_key, certificate, additional_certificates = pkcs12.load_key_and_certificates(
            pfx_data,
            password.encode('utf-8')
        )
    except ValueError:
        # ValueError geralmente ocorre quando a senha está errada
        raise HTTPException(400, "Senha incorreta para este certificado.")
    except Exception as e:
        raise HTTPException(400, f"Erro ao abrir certificado: {str(e)}")

    if not certificate:
        raise HTTPException(400, "O arquivo não contém um certificado válido.")

    # 4. Validar se o CNPJ do Certificado bate com o do Cliente
    cnpj_do_certificado = extrair_cnpj_do_certificado(certificate)

    # OBS: Se não conseguir extrair (string vazia), podemos decidir se bloqueia ou avisa.
    # Aqui vamos bloquear se extraiu algo diferente. Se não extraiu nada, deixamos passar com aviso no log (opcional).
    if cnpj_do_certificado and cnpj_do_certificado != cnpj_cliente_limpo:
        raise HTTPException(
            400,
            f"CNPJ não confere! O certificado pertence ao CNPJ {cnpj_do_certificado}, "
            f"mas você selecionou o cliente {cnpj_cliente_limpo}."
        )

    # 5. Extrair Validade e Status
    try:
        # Tenta pegar validade em UTC aware
        validade_dt = certificate.not_valid_after_utc
    except AttributeError:
        # Fallback para versões antigas da lib cryptography
        validade_dt = certificate.not_valid_after.replace(tzinfo=timezone.utc)

    agora = datetime.now(timezone.utc)
    esta_valido = validade_dt >= agora

    # Formato para salvar no banco (YYYY-MM-DD)
    validade_str = validade_dt.strftime("%Y-%m-%d")
    status_str = "Válido" if esta_valido else "Vencido"

    # 6. Converter Chave e Certificado para Base64 (Formato PEM)
    # Isso é necessário para salvar no Mongo como string, igual ao seu script de exemplo
    try:
        # Chave Privada
        key_pem = private_key.private_bytes(
            encoding=Encoding.PEM,
            format=PrivateFormat.PKCS8,
            encryption_algorithm=NoEncryption()
        )
        chave_b64 = base64.b64encode(key_pem).decode('utf-8')

        # Certificado Público
        cert_pem = certificate.public_bytes(Encoding.PEM)
        certificado_b64 = base64.b64encode(cert_pem).decode('utf-8')
    except Exception as e:
        raise HTTPException(500, f"Erro ao processar chaves criptográficas: {str(e)}")

    # 7. Montar Documento Final
    doc_certificado = {
        "_id": cnpj_cliente_limpo,  # O ID é o CNPJ
        "empresa": cliente_db.get("empresa"),
        "Validate": esta_valido,
        "Validade": validade_str,
        "chave_privada": chave_b64,
        "certificado": certificado_b64,
        "ClientID": str(cod_cliente),
        "Status": status_str,
        "Ativo": esta_valido,  # Se está válido, consideramos ativo para uso
        "metadados": {
            "arquivo_origem": file.filename,
            "data_importacao": datetime.now()
        }
    }

    # 8. Salvar no Mongo (Upsert = Atualiza se existir, cria se não)
    try:
        col_certificados.replace_one(
            {"_id": cnpj_cliente_limpo},
            doc_certificado,
            upsert=True
        )
    except Exception as e:
        raise HTTPException(500, f"Erro ao salvar no banco de dados: {str(e)}")

    return {"mensagem": f"Certificado importado com sucesso! Validade: {validade_str}"}


@router.get("/exportar_excel")
async def exportar_excel_certificados(current_user: dict = Depends(get_current_user)):
    """
    Endpoint que devolve o arquivo Excel com a lista de certificados,
    status de vencimento e dias restantes.
    """
    service = RelatoriosService()
    buffer = service.gerar_excel_certificados()
    
    agora = datetime.now().strftime("%Y%m%d_%H%M")
    nome_arquivo = f"relatorio_certificados_{agora}.xlsx"
    
    return StreamingResponse(
        buffer, 
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={nome_arquivo}"}
    )
