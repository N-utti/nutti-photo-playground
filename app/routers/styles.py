from fastapi import APIRouter

from app.common import not_implemented

router = APIRouter(prefix="/styles", tags=["styles"])


@router.get("")
async def list_styles(section: str | None = None, limit: int | None = None):
    not_implemented()


@router.get("/{style_id}")
async def get_style(style_id: int):
    not_implemented()
