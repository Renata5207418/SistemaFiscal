import os
from bson import ObjectId
from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timedelta, timezone
from passlib.context import CryptContext
from jose import JWTError, jwt
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from database.database import get_users_collection
from dotenv import load_dotenv
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart



load_dotenv()

# Configurações do seu e-mail corporativo (AGORA APONTANDO PARA A MICROSOFT)
SMTP_SERVER = "smtp.office365.com" 
SMTP_PORT = 587
SMTP_USER = "tecnologia2@scryta.com.br"
SMTP_PASS = os.getenv("SMTP_PASSWORD") 

router = APIRouter(
    prefix="/auth",
    tags=["auth"]
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("⚠️  SECRET_KEY não definida no arquivo .env")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 300

# IMPORTANTE: tokenUrl precisa ser "/auth/token" porque o prefix do router é "/auth"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: Optional[str] = None


class Token(BaseModel):
    access_token: str
    token_type: str


def verificar_usuario_existente(username: str, email: str):
    """
    Lança HTTPException se já houver usuário com mesmo username ou e-mail.
    """
    users_col = get_users_collection()
    if users_col.find_one({"username": username}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Usuário já existe."
        )
    if users_col.find_one({"email": email}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="E-mail já cadastrado."
        )


@router.post("/signup", response_model=dict, summary="Criar novo usuário")
def signup(user: UserCreate):
    """
    Registra um novo usuário em 'users' (coleção no MongoDB).
    Gera hash da senha e armazena username, email, full_name, created_at, etc.
    """
    users_col = get_users_collection()

    verificar_usuario_existente(user.username, user.email)

    hashed_password = pwd_context.hash(user.password)

    # Monta o documento e insere no Mongo
    usuario_doc = {
        "username":        user.username,
        "email":           user.email,
        "full_name":       user.full_name,
        "hashed_password": hashed_password,
        "is_active":       True,
        "is_admin":        False,
        "created_at":      datetime.now(timezone.utc)
    }
    try:
        result = users_col.insert_one(usuario_doc)
        return {
            "mensagem": "Usuário registrado com sucesso",
            "user_id": str(result.inserted_id)
        }
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def authenticate_user(login: str, password: str):
    """
    Busca usuário por username OU email e verifica senha.
    Retorna o documento do usuário se válido; caso contrário, retorna False.
    """
    users_col = get_users_collection()

    login_normalizado = login.strip()

    user_doc = users_col.find_one({
        "$or": [
            {"username": login_normalizado},
            {"email": login_normalizado.lower()}
        ]
    })

    if not user_doc:
        return False

    if not user_doc.get("is_active", True):
        return False

    if not verify_password(password, user_doc["hashed_password"]):
        return False

    return user_doc


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """
    Cria um JWT com expiração.
    'data' deve conter pelo menos a chave "sub": username.
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


@router.post("/token", response_model=Token, summary="Obter token (login)")
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    """
    Recebe form-data com 'username' e 'password' (x-www-form-urlencoded).
    Retorna um JWT válido se credenciais estiverem corretas.
    """
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha incorretos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": str(user["_id"]),
            "username": user.get("username", "")
        },
        expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


async def get_current_user(token: str = Depends(oauth2_scheme)):
    """
    Valida o token JWT, extrai o usuário e retorna o documento do Mongo.

    Novo padrão:
    - sub = _id do usuário

    Compatibilidade:
    - se sub antigo for username, ainda tenta buscar por username.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Não autenticado",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub: str = payload.get("sub")

        if sub is None:
            raise credentials_exception

    except JWTError:
        raise credentials_exception

    users_col = get_users_collection()

    user_doc = None

    # Novo padrão: sub é ObjectId
    if ObjectId.is_valid(sub):
        user_doc = users_col.find_one({"_id": ObjectId(sub)})

    # Compatibilidade com tokens antigos: sub era username
    if user_doc is None:
        user_doc = users_col.find_one({"username": sub})

    if user_doc is None:
        raise credentials_exception

    if not user_doc.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuário inativo."
        )

    return user_doc

async def require_admin(current_user=Depends(get_current_user)):
    """
    Permite acesso somente para usuários administradores.
    """
    if not current_user.get("is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso permitido somente para administradores."
        )

    return current_user

@router.post("/forgot-password", summary="Enviar link de recuperação via SMTP")
async def forgot_password(payload: dict):
    email = payload.get("email")
    users_col = get_users_collection()
    user = users_col.find_one({"email": email})
    
    if not user:
        raise HTTPException(status_code=404, detail="E-mail não encontrado.")

    # Gera token temporário (15 min)
    token = create_access_token(
        data={"sub": str(user["_id"])},
        expires_delta=timedelta(minutes=15)
    )
    reset_link = f"http://10.0.0.172:5174/reset-password?token={token}"

    msg = MIMEMultipart('alternative') # Mudado para 'alternative' para suportar HTML
    msg['From'] = SMTP_USER
    msg['To'] = email
    msg['Subject'] = "Recuperação de Senha - FISCAL CORE"
    
    nome_usuario = user.get('full_name', 'Usuário')

    # Versão em texto puro (fallback para clientes de email antigos)
    text_body = f"Olá {nome_usuario},\n\nVocê solicitou a redefinição de sua senha.\nCopie e cole este link no seu navegador para criar uma nova senha:\n\n{reset_link}"
    
    # Versão em HTML (O "botãozinho bonito")
    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background-color: #f3f4f6; padding: 30px; margin: 0;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); border: 1px solid #e5e7eb;">
            <div style="background-color: #3a3a3a; padding: 25px; text-align: center; border-bottom: 5px solid #fdb913;">
                <h2 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px;">FISCAL CORE</h2>
            </div>
            <div style="padding: 40px 30px; text-align: center;">
                <p style="color: #4b5563; font-size: 16px; margin-bottom: 10px;">Olá, <strong>{nome_usuario}</strong>!</p>
                <p style="color: #6b7280; font-size: 14px; margin-bottom: 30px; line-height: 1.5;">Recebemos um pedido para redefinir a senha da sua conta corporativa. Clique no botão abaixo para criar uma nova senha.</p>
                
                <a href="{reset_link}" style="display: inline-block; background-color: #fdb913; color: #3a3a3a; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Redefinir Senha</a>
                
                <p style="color: #9ca3af; font-size: 12px; margin-top: 35px; border-top: 1px solid #f3f4f6; pt-4;">Se você não solicitou esta alteração, ignore este e-mail. O link expira em 15 minutos.</p>
            </div>
        </div>
    </body>
    </html>
    """

    # Anexa as duas versões (o cliente de e-mail escolhe exibir a melhor)
    part1 = MIMEText(text_body, 'plain')
    part2 = MIMEText(html_body, 'html')
    
    msg.attach(part1)
    msg.attach(part2)

    try:
        # A Microsoft Office 365 exige STARTTLS na porta 587
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(SMTP_USER, SMTP_PASS)
        server.send_message(msg, from_addr=SMTP_USER, to_addrs=[email])
        server.quit()
        return {"mensagem": "E-mail enviado com sucesso."}
    except Exception as e:
        print(f"Detalhe do erro SMTP: {str(e)}") 
        raise HTTPException(status_code=500, detail=f"Erro ao enviar e-mail: {str(e)}")


@router.get("/me", summary="Obter dados do usuário logado")
async def get_me(current_user=Depends(get_current_user)):
    return {
        "id": str(current_user["_id"]),
        "username": current_user["username"],
        "email": current_user["email"],
        "full_name": current_user.get("full_name"),
        "is_active": current_user.get("is_active", True),
        "is_admin": current_user.get("is_admin", False),
    }

class PasswordReset(BaseModel):
    token: str
    new_password: str


@router.post("/reset-password", summary="Redefinir senha com token")
async def reset_password(payload: PasswordReset):
    try:
        # Abre o token para ver quem pediu a troca
        decoded = jwt.decode(payload.token, SECRET_KEY, algorithms=[ALGORITHM])
        sub: str = decoded.get("sub")
        if not sub:
            raise HTTPException(status_code=400, detail="Token inválido.")
    except JWTError:
        raise HTTPException(status_code=400, detail="Link expirado ou inválido. Peça um novo e-mail.")

    users_col = get_users_collection()
    user = None

    if ObjectId.is_valid(sub):
        user = users_col.find_one({"_id": ObjectId(sub)})

    # Compatibilidade com tokens antigos
    if user is None:
        user = users_col.find_one({"username": sub})

    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    # Criptografa a senha nova e salva no Mongo
    hashed_password = pwd_context.hash(payload.new_password)
    users_col.update_one(
        {"_id": user["_id"]},
        {"$set": {"hashed_password": hashed_password}}
    )

    return {"mensagem": "Senha redefinida com sucesso."}