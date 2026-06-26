from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from database.database import get_users_collection
from login.auth import pwd_context, require_admin


router = APIRouter(
    prefix="/usuarios",
    tags=["usuarios"]
)


class UsuarioAdminCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: Optional[str] = None
    is_active: bool = True
    is_admin: bool = False


class UsuarioAdminUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None


def _payload_dict(payload: BaseModel) -> dict:
    if hasattr(payload, "model_dump"):
        return payload.model_dump(exclude_unset=True)

    return payload.dict(exclude_unset=True)


def _serializar_usuario(user: dict) -> dict:
    return {
        "id": str(user["_id"]),
        "username": user.get("username", ""),
        "email": user.get("email", ""),
        "full_name": user.get("full_name", ""),
        "is_active": user.get("is_active", True),
        "is_admin": user.get("is_admin", False),
        "created_at": user.get("created_at").isoformat() if user.get("created_at") else None,
        "updated_at": user.get("updated_at").isoformat() if user.get("updated_at") else None,
    }


def _validar_object_id(user_id: str) -> ObjectId:
    if not ObjectId.is_valid(user_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ID de usuário inválido."
        )

    return ObjectId(user_id)


@router.get("")
def listar_usuarios(admin=Depends(require_admin)):
    users_col = get_users_collection()

    usuarios = list(
        users_col.find({}).sort("username", 1)
    )

    return {
        "usuarios": [_serializar_usuario(u) for u in usuarios]
    }


@router.get("/{user_id}")
def obter_usuario(user_id: str, admin=Depends(require_admin)):
    users_col = get_users_collection()
    oid = _validar_object_id(user_id)

    user = users_col.find_one({"_id": oid})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuário não encontrado."
        )

    return _serializar_usuario(user)


@router.post("", status_code=status.HTTP_201_CREATED)
def criar_usuario(payload: UsuarioAdminCreate, admin=Depends(require_admin)):
    users_col = get_users_collection()

    username = payload.username.strip()
    email = str(payload.email).strip().lower()

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

    now = datetime.now(timezone.utc)

    doc = {
        "username": username,
        "email": email,
        "full_name": payload.full_name,
        "hashed_password": pwd_context.hash(payload.password),
        "is_active": payload.is_active,
        "is_admin": payload.is_admin,
        "created_at": now,
        "updated_at": now,
    }

    result = users_col.insert_one(doc)

    criado = users_col.find_one({"_id": result.inserted_id})

    return {
        "mensagem": "Usuário criado com sucesso.",
        "usuario": _serializar_usuario(criado)
    }


@router.put("/{user_id}")
def atualizar_usuario(
    user_id: str,
    payload: UsuarioAdminUpdate,
    admin=Depends(require_admin)
):
    users_col = get_users_collection()
    oid = _validar_object_id(user_id)

    user = users_col.find_one({"_id": oid})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuário não encontrado."
        )

    dados = _payload_dict(payload)
    update_data = {}

    if "email" in dados and dados["email"] is not None:
        email = str(dados["email"]).strip().lower()

        existente_email = users_col.find_one({
            "email": email,
            "_id": {"$ne": oid}
        })

        if existente_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="E-mail já está em uso por outro usuário."
            )

        update_data["email"] = email
    
    if "username" in dados and dados["username"] is not None:
        username = dados["username"].strip()

        existente_username = users_col.find_one({
            "username": username,
            "_id": {"$ne": oid}
        })

    if existente_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username já está em uso por outro usuário."
        )

    update_data["username"] = username

    if "full_name" in dados:
        update_data["full_name"] = dados["full_name"]

    if "is_active" in dados and dados["is_active"] is not None:
        update_data["is_active"] = dados["is_active"]

    if "is_admin" in dados and dados["is_admin"] is not None:
        update_data["is_admin"] = dados["is_admin"]

    if "password" in dados and dados["password"]:
        update_data["hashed_password"] = pwd_context.hash(dados["password"])
    

    if not update_data:
        return {
            "mensagem": "Nenhuma alteração enviada.",
            "usuario": _serializar_usuario(user)
        }

    update_data["updated_at"] = datetime.now(timezone.utc)

    users_col.update_one(
        {"_id": oid},
        {"$set": update_data}
    )

    atualizado = users_col.find_one({"_id": oid})

    return {
        "mensagem": "Usuário atualizado com sucesso.",
        "usuario": _serializar_usuario(atualizado)
    }