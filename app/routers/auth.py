from fastapi import APIRouter
from pydantic import BaseModel

from app.common import not_implemented

router = APIRouter(prefix="/auth", tags=["auth"])


class KakaoLoginRequest(BaseModel):
    kakao_token: str


@router.post("/guest", status_code=201)
async def issue_guest_token():
    not_implemented()


@router.get("/cafe24/authorize")
async def cafe24_authorize():
    not_implemented()


@router.get("/cafe24/callback")
async def cafe24_callback(code: str, state: str):
    not_implemented()


@router.post("/kakao")
async def kakao_login(body: KakaoLoginRequest):
    not_implemented()


@router.get("/me")
async def get_me():
    not_implemented()


@router.post("/logout", status_code=204)
async def logout():
    not_implemented()
