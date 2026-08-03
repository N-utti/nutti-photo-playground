from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from tortoise.transactions import in_transaction

from app.auth import (
    create_state,
    create_token,
    get_current_member,
    guest_member_id_from_authorization,
    member_id_from_state,
)
from app.common import not_implemented
from app.credits import grant_credits
from app.models import (
    CreditReason,
    CustomPromptLog,
    GenerationJob,
    Member,
    MemberKind,
    MetricEvent,
    PetProfile,
    SourceImage,
)
from app.settings import settings

router = APIRouter(prefix="/auth", tags=["auth"])


class GuestTokenResponse(BaseModel):
    token: str
    member_id: str
    kind: Literal["guest"]


class AuthCallbackResponse(BaseModel):
    token: str
    member_id: str
    kind: Literal["member"]
    merged: bool
    credit_balance: int


class MeResponse(BaseModel):
    member_id: str
    kind: Literal["guest", "member"]
    credit_balance: int
    cafe24_linked: bool


class KakaoLoginRequest(BaseModel):
    kakao_token: str


def _bad_gateway() -> HTTPException:
    return HTTPException(
        status_code=502,
        detail={"code": "BAD_GATEWAY", "message": "Cafe24 authentication failed", "detail": {}},
    )


async def _exchange_cafe24_code(code: str) -> dict:
    url = f"https://{settings.cafe24_mall_id}.cafe24api.com/api/v2/oauth/token"
    async with httpx.AsyncClient() as client:
        response = await client.post(
            url,
            auth=(settings.cafe24_client_id, settings.cafe24_client_secret),
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.cafe24_redirect_uri,
            },
        )
        response.raise_for_status()
        return response.json()


async def _fetch_cafe24_member(access_token: str) -> dict:
    url = f"https://{settings.cafe24_mall_id}.cafe24api.com/api/v2/customers/me"
    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers={"Authorization": f"Bearer {access_token}"})
        response.raise_for_status()
        data = response.json()
    member = data.get("customer") or data.get("user") or data
    member_id = member.get("cafe24_member_id") or member.get("member_id") or member.get("user_id") or member.get("id")
    if member_id is None:
        raise ValueError("Cafe24 member ID missing")
    return {"cafe24_member_id": str(member_id)}


@router.post("/guest", status_code=201, response_model=GuestTokenResponse)
async def issue_guest_token() -> GuestTokenResponse:
    member = await Member.create(
        kind=MemberKind.GUEST,
        guest_expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    await grant_credits(member.id, 1, CreditReason.GUEST_TRIAL, "guest_trial")
    return GuestTokenResponse(token=create_token(member.id, "guest"), member_id=str(member.id), kind="guest")


@router.get("/cafe24/authorize")
async def cafe24_authorize(authorization: str | None = Header(None, alias="Authorization")) -> RedirectResponse:
    member_id = guest_member_id_from_authorization(authorization)
    query = urlencode(
        {
            "client_id": settings.cafe24_client_id,
            "mall_id": settings.cafe24_mall_id,
            "redirect_uri": settings.cafe24_redirect_uri,
            "state": create_state(member_id),
        }
    )
    return RedirectResponse(
        f"https://{settings.cafe24_mall_id}.cafe24api.com/api/v2/oauth/authorize?{query}",
        status_code=302,
    )


@router.get("/cafe24/callback", response_model=AuthCallbackResponse)
async def cafe24_callback(
    code: str,
    state: str | None = None,
    authorization: str | None = Header(None, alias="Authorization"),
) -> AuthCallbackResponse:
    guest_id = member_id_from_state(state) or guest_member_id_from_authorization(authorization)
    try:
        token_data = await _exchange_cafe24_code(code)
        member_data = await _fetch_cafe24_member(token_data["access_token"])
        cafe24_member_id = str(member_data["cafe24_member_id"])
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        raise _bad_gateway() from exc

    merged = False
    async with in_transaction() as connection:
        existing = await Member.filter(
            kind=MemberKind.MEMBER,
            cafe24_member_id=cafe24_member_id,
        ).using_db(connection).first()
        guest = None
        if guest_id is not None:
            guest = await Member.filter(id=guest_id, kind=MemberKind.GUEST).using_db(connection).first()

        if existing is not None:
            target = existing
            if guest is not None and guest.id != existing.id:
                for model in (PetProfile, SourceImage, GenerationJob, CustomPromptLog, MetricEvent):
                    await model.filter(member_id=guest.id).using_db(connection).update(member_id=existing.id)
                guest.merged_into_id = existing.id
                await guest.save(update_fields=["merged_into_id"], using_db=connection)
                merged = True
        elif guest is not None:
            guest.kind = MemberKind.MEMBER
            guest.cafe24_member_id = cafe24_member_id
            guest.guest_expires_at = None
            await guest.save(
                update_fields=["kind", "cafe24_member_id", "guest_expires_at"],
                using_db=connection,
            )
            target = guest
        else:
            target = await Member.create(
                kind=MemberKind.MEMBER,
                cafe24_member_id=cafe24_member_id,
                using_db=connection,
            )

    await grant_credits(target.id, 3, CreditReason.LINK_ACCOUNT, "link_account")
    target = await Member.get(id=target.id)
    return AuthCallbackResponse(
        token=create_token(target.id, "member"),
        member_id=str(target.id),
        kind="member",
        merged=merged,
        credit_balance=target.credit_balance,
    )


@router.post("/kakao", response_model=AuthCallbackResponse)
async def kakao_login(body: KakaoLoginRequest):
    # 보조 로그인이고 외부 앱 등록이 필요하므로 이번 범위에서는 구현하지 않는다.
    not_implemented()


@router.get("/me", response_model=MeResponse)
async def get_me(member: Member = Depends(get_current_member)) -> MeResponse:
    return MeResponse(
        member_id=str(member.id),
        kind=member.kind.value,
        credit_balance=member.credit_balance,
        cafe24_linked=member.cafe24_member_id is not None,
    )


@router.post("/logout", status_code=204)
async def logout() -> None:
    return None
