from datetime import datetime, timezone, timedelta

import httpx
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse

from database.database import get_rpa_historico_collection
from login.auth import get_current_user


router = APIRouter(tags=["automacao-rpa"])

RPA_URL_BASE = "http://10.0.0.67:5000"

rpa_state = {
    "is_running": False,
    "last_user": None,
    "start_time": None,
    "last_progress": {
        "messages": [],
        "processed_count": 0,
        "total_count": 0
    },
}

rpa_hist_col = get_rpa_historico_collection()


@router.post("/rpa/apurar")
async def iniciar_apuracao_rpa(
    arquivo_empresas: UploadFile = File(...),
    usuario: str = Form(...),
    senha: str = Form(...),
    user=Depends(get_current_user)
):
    global rpa_state

    if rpa_state["is_running"]:
        raise HTTPException(
            status_code=423,
            detail=f"O robô já está sendo utilizado por {rpa_state['last_user']}."
        )

    try:
        rpa_state["is_running"] = True

        nome_usuario = user.get("username", "Sistema")
        rpa_state["last_user"] = nome_usuario
        rpa_state["last_progress"] = {
            "messages": ["Iniciando conexão..."],
            "processed_count": 0,
            "total_count": 0
        }

        file_content = await arquivo_empresas.read()

        files = {
            "arquivo_empresas": (
                arquivo_empresas.filename,
                file_content,
                arquivo_empresas.content_type
            )
        }

        data = {
            "usuario": usuario,
            "senha": senha
        }

        async with httpx.AsyncClient(timeout=3600.0) as client_http:
            resposta = await client_http.post(
                f"{RPA_URL_BASE}/upload-and-login",
                data=data,
                files=files
            )

        resultado = resposta.json()

        doc = {
            "relatorio": resultado.get("relatorio"),
            "executado_por": nome_usuario,
            "horario": datetime.now().strftime("%d/%m/%Y %H:%M"),
            "created_at": datetime.now(timezone.utc),
            "status": "sucesso"
        }

        rpa_hist_col.insert_one(doc)
        rpa_state["is_running"] = False

        return {
            **resultado,
            "executado_por": nome_usuario,
            "horario": doc["horario"]
        }

    except Exception as e:
        rpa_state["is_running"] = False

        doc = {
            "error": str(e),
            "executado_por": user.get("username", "Sistema"),
            "horario": datetime.now().strftime("%d/%m/%Y %H:%M"),
            "created_at": datetime.now(timezone.utc),
            "status": "erro"
        }

        rpa_hist_col.insert_one(doc)

        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rpa/status-atual")
async def status_atual_rpa():
    global rpa_state

    if rpa_state["is_running"]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client_http:
                res = await client_http.get(f"{RPA_URL_BASE}/progresso")
                if res.status_code == 200:
                    rpa_state["last_progress"] = res.json()
        except Exception:
            pass

    vinte_e_quatro_horas_atras = datetime.now(timezone.utc) - timedelta(hours=24)

    cursor = (
        rpa_hist_col
        .find({"created_at": {"$gte": vinte_e_quatro_horas_atras}})
        .sort("created_at", -1)
        .limit(10)
    )

    history_list = []

    for doc in cursor:
        item = {
            "executado_por": doc.get("executado_por"),
            "horario": doc.get("horario"),
            "status": doc.get("status")
        }

        if doc.get("relatorio"):
            item["relatorio"] = doc.get("relatorio")

        if doc.get("error"):
            item["error"] = doc.get("error")

        history_list.append(item)

    return {
        "is_running": rpa_state["is_running"],
        "last_user": rpa_state["last_user"],
        "last_progress": rpa_state["last_progress"],
        "history": history_list
    }


@router.get("/rpa/progresso")
async def acompanhar_progresso_rpa():
    try:
        async with httpx.AsyncClient(timeout=10.0) as client_http:
            resposta = await client_http.get(f"{RPA_URL_BASE}/progresso")

        return resposta.json()

    except Exception as e:
        return {
            "messages": [f"Erro ao buscar progresso: {str(e)}"],
            "is_running": False
        }


@router.get("/rpa/download/{filename}")
async def baixar_relatorio_rpa(filename: str):
    url_arquivo = f"{RPA_URL_BASE}/uploads/{filename}"

    client_http = httpx.AsyncClient()
    request = client_http.build_request("GET", url_arquivo)
    response = await client_http.send(request, stream=True)

    if response.status_code != 200:
        raise HTTPException(
            status_code=404,
            detail="Arquivo não encontrado no servidor RPA."
        )

    return StreamingResponse(
        response.aiter_raw(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )


@router.post("/rpa/limpar")
async def limpar_historico_rpa(user=Depends(get_current_user)):
    global rpa_state

    if rpa_state["is_running"]:
        raise HTTPException(
            status_code=400,
            detail="Não é possível limpar o terminal com o robô em execução."
        )

    rpa_state["last_progress"] = {
        "messages": [],
        "processed_count": 0,
        "total_count": 0
    }

    return {"message": "Terminal limpo com sucesso"}