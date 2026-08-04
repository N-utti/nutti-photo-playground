import secrets
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from tortoise.transactions import in_transaction

from app.auth import (
    create_state,
    create_token,
    get_current_member,
    guest_member_id_from_authorization,
    state_identity,
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

# ponytail: 단일 프로세스 인메모리(10,000개 초과 시 만료 버킷 정리) — 멀티 프로세스 전환 시 slowapi/Redis로 승격
_guest_requests: dict[str, deque[float]] = {}


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


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail={"code": "UNAUTHORIZED", "message": "Invalid or missing authentication token", "detail": {}},
    )


def _client_ip(request: Request) -> str:
    if settings.trust_proxy:
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            # 신뢰 프록시가 append하므로 마지막 값이 프록시가 기록한 클라이언트
            return forwarded_for.rsplit(",", 1)[-1].strip()
    return request.client.host if request.client else "unknown"


def _check_guest_rate_limit(request: Request) -> None:
    now = time.monotonic()
    if len(_guest_requests) > 10_000:
        expired_ips = [
            ip for ip, bucket in _guest_requests.items() if not bucket or bucket[-1] <= now - 3600
        ]
        for expired_ip in expired_ips:
            del _guest_requests[expired_ip]
    ip = _client_ip(request)
    requests = _guest_requests.setdefault(ip, deque())
    while requests and requests[0] <= now - 3600:
        requests.popleft()
    if len(requests) >= settings.guest_rate_limit_per_hour:
        raise HTTPException(
            status_code=429,
            detail={"code": "RATE_LIMITED", "message": "Guest token issuance rate limit exceeded", "detail": {}},
        )
    requests.append(now)


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
async def issue_guest_token(request: Request) -> GuestTokenResponse:
    _check_guest_rate_limit(request)
    member = await Member.create(
        kind=MemberKind.GUEST,
        guest_expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    await grant_credits(member.id, 1, CreditReason.GUEST_TRIAL, "guest_trial")
    return GuestTokenResponse(token=create_token(member.id, "guest"), member_id=str(member.id), kind="guest")


@router.get("/cafe24/authorize")
async def cafe24_authorize(authorization: str | None = Header(None, alias="Authorization")) -> RedirectResponse:
    member_id = guest_member_id_from_authorization(authorization)
    if member_id is None:
        raise _unauthorized()
    member = await Member.filter(
        id=member_id,
        kind=MemberKind.GUEST,
        merged_into_id__isnull=True,
    ).first()
    if member is None:
        raise _unauthorized()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    nonce = secrets.token_urlsafe(32)
    member.oauth_state_nonce = nonce
    member.oauth_state_expires_at = expires_at
    await member.save(update_fields=["oauth_state_nonce", "oauth_state_expires_at"])
    query = urlencode(
        {
            "client_id": settings.cafe24_client_id,
            "mall_id": settings.cafe24_mall_id,
            "redirect_uri": settings.cafe24_redirect_uri,
            "response_type": "code",
            "scope": settings.cafe24_scope,
            "state": create_state(member_id, nonce, expires_at),
        }
    )
    return RedirectResponse(
        f"https://{settings.cafe24_mall_id}.cafe24api.com/api/v2/oauth/authorize?{query}",
        status_code=302,
    )


@router.get("/cafe24/callback", response_model=AuthCallbackResponse)
async def cafe24_callback(
    code: str,
    state: str,
) -> AuthCallbackResponse:
    guest_id, nonce = state_identity(state)
    merged = False
    async with in_transaction() as connection:
        guest = await Member.filter(
            id=guest_id,
            kind=MemberKind.GUEST,
            merged_into_id__isnull=True,
        ).select_for_update().using_db(connection).first()
        if (
            guest is None
            or guest.oauth_state_nonce is None
            or not secrets.compare_digest(guest.oauth_state_nonce, nonce)
            or guest.oauth_state_expires_at is None
            or guest.oauth_state_expires_at <= datetime.now(timezone.utc)
        ):
            raise _unauthorized()
        guest.oauth_state_nonce = None
        guest.oauth_state_expires_at = None
        await guest.save(
            update_fields=["oauth_state_nonce", "oauth_state_expires_at"],
            using_db=connection,
        )

    try:
        token_data = await _exchange_cafe24_code(code)
        member_data = await _fetch_cafe24_member(token_data["access_token"])
        cafe24_member_id = str(member_data["cafe24_member_id"])
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        raise _bad_gateway() from exc

    async with in_transaction() as connection:
        guest = await Member.filter(
            id=guest_id,
            kind=MemberKind.GUEST,
            merged_into_id__isnull=True,
        ).select_for_update().using_db(connection).first()
        if guest is None:
            raise _unauthorized()

        existing = await Member.filter(
            kind=MemberKind.MEMBER,
            cafe24_member_id=cafe24_member_id,
        ).using_db(connection).first()

        if existing is not None:
            target = existing
            if guest.id != existing.id:
                for model in (PetProfile, SourceImage, GenerationJob, CustomPromptLog, MetricEvent):
                    await model.filter(member_id=guest.id).using_db(connection).update(member_id=existing.id)
                guest.merged_into_id = existing.id
                await guest.save(update_fields=["merged_into_id"], using_db=connection)
                merged = True
        else:
            guest.kind = MemberKind.MEMBER
            guest.cafe24_member_id = cafe24_member_id
            guest.guest_expires_at = None
            await guest.save(
                update_fields=["kind", "cafe24_member_id", "guest_expires_at"],
                using_db=connection,
            )
            target = guest

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
