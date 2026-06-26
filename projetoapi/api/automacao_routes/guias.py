import base64
import zipfile
from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, Query, Response, HTTPException
from fastapi.responses import StreamingResponse

from database.database import get_guias_enviadas_collection
from login.auth import get_current_user
from api.automacao_routes.schemas import ConferenciaPayload, LoteDownloadPayload


router = APIRouter(tags=["automacao-guias"])


@router.post("/conferencia/toggle")
def toggle_conferencia(payload: ConferenciaPayload, user=Depends(get_current_user)):
    col = get_guias_enviadas_collection()
    doc = col.find_one({"cod_cliente": payload.cod_cliente, "mesano": payload.mesano})

    nome_usuario = user.get("username", "Sistema").split(" ")[0]
    data_atual = datetime.now().strftime("%d/%m")

    if doc and doc.get("conferencia", {}).get("status") is True:
        col.update_one(
            {"cod_cliente": payload.cod_cliente, "mesano": payload.mesano},
            {"$set": {"conferencia": {"status": False, "user": None, "date": None}}}
        )
        return {"status": False}

    col.update_one(
        {"cod_cliente": payload.cod_cliente, "mesano": payload.mesano},
        {"$set": {
            "conferencia": {
                "status": True,
                "user": nome_usuario,
                "date": data_atual
            }
        }},
        upsert=True
    )

    return {"status": True, "user": nome_usuario, "date": data_atual}


@router.get("/guia-enviada", response_model=dict[int, bool])
def get_guia_enviada(mesano: str = Query(..., pattern=r"^\d{6}$")):
    col = get_guias_enviadas_collection()
    docs = col.find({"mesano": mesano}, {"cod_cliente": 1, "guia_enviada": 1})

    return {
        d["cod_cliente"]: d.get("guia_enviada", False)
        for d in docs
    }


@router.get("/guias-enviadas")
def listar_guias_enviadas(
    mesano: str = Query(..., regex=r"^\d{6}$"),
    user=Depends(get_current_user)
):
    col = get_guias_enviadas_collection()
    docs = col.find({"mesano": mesano})

    resultados = []

    for d in docs:
        resultados.append({
            "cod_cliente": d["cod_cliente"],
            "cnpj": d.get("cnpj"),
            "mesano": d["mesano"],
            "pgdas": d.get("pgdas"),
            "das": d.get("das"),
            "guia_enviada": d.get("guia_enviada", False),
            "updated_at": d.get("updated_at")
        })

    return {"guias": resultados}


@router.post("/download-lote-zip")
def download_lote_zip(payload: LoteDownloadPayload, user=Depends(get_current_user)):
    col = get_guias_enviadas_collection()
    docs = col.find({
        "mesano": payload.mesano,
        "cod_cliente": {"$in": payload.codigos}
    })

    mes = payload.mesano[4:]
    ano = payload.mesano[:4]

    zip_buffer = BytesIO()

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for doc in docs:
            cod = doc["cod_cliente"]

            if payload.tipo_download in ["ambos", "pgdas"]:
                pgdas = doc.get("pgdas")
                if pgdas and pgdas.get("base64"):
                    zip_file.writestr(
                        f"{cod}-PGDAS-{mes}{ano}-{pgdas.get('hash', 'nao')}.pdf",
                        base64.b64decode(pgdas["base64"])
                    )

            if payload.tipo_download in ["ambos", "das"]:
                das = doc.get("das")
                if das and das.get("base64"):
                    zip_file.writestr(
                        f"{cod}-DAS-{mes}{ano}-{das.get('hash', 'nao')}.pdf",
                        base64.b64decode(das["base64"])
                    )

    zip_buffer.seek(0)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="Lote_Guias_{mes}{ano}.zip"'
        }
    )


@router.get("/download-guia")
def download_guia_banco(
    cod_cliente: int = Query(...),
    mesano: str = Query(...),
    tipo: str = Query(...)
):
    col = get_guias_enviadas_collection()
    doc = col.find_one({"cod_cliente": cod_cliente, "mesano": mesano})

    if not doc or not doc.get(tipo, {}).get("base64"):
        raise HTTPException(404, "Arquivo PDF não encontrado.")

    pdf_bytes = base64.b64decode(doc[tipo]["base64"])
    filename = f"{cod_cliente}-{tipo.upper()}-{mesano[4:]}{mesano[:4]}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )