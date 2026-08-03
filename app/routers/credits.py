from fastapi import APIRouter
from pydantic import BaseModel

from app.common import not_implemented

router = APIRouter(prefix="/credits", tags=["credits"])


class ClaimCreditRequest(BaseModel):
    action: str


@router.get("")
async def get_credits():
    not_implemented()


@router.post("/claim")
async def claim_credit(body: ClaimCreditRequest):
    not_implemented()


@router.get("/ledger")
async def get_credit_ledger(cursor: str | None = None):
    not_implemented()
