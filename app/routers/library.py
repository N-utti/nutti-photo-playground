from fastapi import APIRouter
from pydantic import BaseModel

from app.common import not_implemented

router = APIRouter(tags=["library"])


class DeleteLibraryRequest(BaseModel):
    ids: list[str]


@router.get("/library")
async def list_library(pet_id: str | None = None, cursor: str | None = None):
    not_implemented()


@router.delete("/library", status_code=204)
async def delete_library_items(body: DeleteLibraryRequest):
    not_implemented()
