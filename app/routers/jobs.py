from fastapi import APIRouter, Header
from pydantic import BaseModel

from app.common import not_implemented

router = APIRouter(prefix="/jobs", tags=["jobs"])


class CreateJobRequest(BaseModel):
    style_id: int | None = None
    upload_id: str
    pet_id: str | None = None
    custom_prompt: str | None = None


class ShareRequest(BaseModel):
    channel: str


@router.post("", status_code=202)
async def create_job(body: CreateJobRequest, idempotency_key: str = Header(..., alias="Idempotency-Key")):
    not_implemented()


@router.get("/{job_id}")
async def get_job(job_id: str):
    not_implemented()


@router.post("/{job_id}/share")
async def share_result(job_id: str, body: ShareRequest):
    not_implemented()
