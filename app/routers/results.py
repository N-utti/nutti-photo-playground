from fastapi import APIRouter

from app.common import not_implemented

router = APIRouter(tags=["results"])


@router.get("/calculator-link")
async def get_calculator_link(pet_id: str | None = None, job_id: str | None = None):
    not_implemented()
