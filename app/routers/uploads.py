from fastapi import APIRouter, File, Form, UploadFile

from app.common import not_implemented

router = APIRouter(tags=["uploads"])


@router.post("/uploads")
async def upload_photo(file: UploadFile = File(...), pet_id: str | None = Form(None)):
    not_implemented()
