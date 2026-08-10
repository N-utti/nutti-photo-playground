import asyncio
import hashlib
import math
import secrets
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from tortoise.transactions import in_transaction

from app.auth import (
    DUMMY_PASSWORD_HASH,
    create_state,
    create_token,
    get_current_member,
    hash_password,
    identity_from_authorization,
    state_identity,
    verify_password,
)
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

# ponytail: single-process in-memory limit; move to Redis when the API runs multiple workers.
_guest_requests: dict[str, deque[float]] = {}
_login_requests: dict[str, deque[float]] = {}
_register_requests: dict[str, deque[float]] = {}
_refresh_requests: dict[str, deque[float]] = {}

# ponytail: fixed thresholds are enough for now; promote to settings when traffic data warrants tuning.
_LOGIN_IP_RATE_LIMIT = 20
_LOGIN_EMAIL_RATE_LIMIT = 10
_REGISTER_IP_RATE_LIMIT = 20


class GuestTokenResponse(BaseModel):
    token: str
    member_id: str
    kind: Literal["guest"]


class AuthCallbackResponse(BaseModel):
    token: str
    refresh_token: str
    member_id: str
    kind: Literal["member"]
    merged: bool
    credit_balance: int


class AuthorizeResponse(BaseModel):
    authorize_url: str


class Cafe24LinkResponse(BaseModel):
    cafe24_linked: Literal[True]
    credit_balance: int


class RegisterRequest(BaseModel):
    email: str = Field(pattern=r"^.*@.*\..*$", max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class LoginRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class RefreshRequest(BaseModel):
    refresh_token: str = Field(max_length=128)


class RefreshResponse(BaseModel):
    token: str
    refresh_token: str


class MeResponse(BaseModel):
    member_id: str
    kind: Literal["guest", "member"]
    credit_balance: int
    email: str | None
    nickname: str | None
    providers: list[str]
    cafe24_linked: bool


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


def _already_member() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"code": "ALREADY_MEMBER", "message": "Already signed in as a member", "detail": {}},
    )


def _invalid_credentials() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail={"code": "INVALID_CREDENTIALS", "message": "Invalid email or password", "detail": {}},
    )


def _client_ip(request: Request) -> str:
    if settings.trust_proxy:
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            return forwarded_for.rsplit(",", 1)[-1].strip()
    return request.client.host if request.client else "unknown"


def _prune_expired_buckets(buckets: dict[str, deque[float]], now: float) -> None:
    if len(buckets) > 10_000:
        expired_keys = [
            bucket_key
            for bucket_key, bucket in buckets.items()
            if not bucket or bucket[-1] <= now - 3600
        ]
        for expired_key in expired_keys:
            del buckets[expired_key]


def _check_bucket(buckets: dict[str, deque[float]], key: str, limit: int) -> None:
    now = time.monotonic()
    _prune_expired_buckets(buckets, now)
    requests = buckets.setdefault(key, deque())
    while requests and requests[0] <= now - 3600:
        requests.popleft()
    if len(requests) >= limit:
        retry_after = max(1, math.ceil(requests[0] + 3600 - now))
        raise HTTPException(
            status_code=429,
            detail={"code": "RATE_LIMITED", "message": "Authentication rate limit exceeded", "detail": {}},
            headers={"Retry-After": str(retry_after)},
        )
    requests.append(now)


def _peek_bucket(buckets: dict[str, deque[float]], key: str, limit: int) -> None:
    """한도 검사만 하고 소비하지 않는다 — 실패 시에만 _record_failure로 기록.

    ponytail: 이메일 버킷은 실패만 계수(성공이 남의 예산을 태우는 락아웃 DoS 완화).
    지속적으로 오답을 부어넣는 공격자는 여전히 잠금 창을 유지할 수 있음 — CAPTCHA/지수 백오프가 업그레이드 경로.
    """
    now = time.monotonic()
    _prune_expired_buckets(buckets, now)
    requests = buckets.get(key)
    if not requests:
        return
    while requests and requests[0] <= now - 3600:
        requests.popleft()
    if len(requests) >= limit:
        retry_after = max(1, math.ceil(requests[0] + 3600 - now))
        raise HTTPException(
            status_code=429,
            detail={"code": "RATE_LIMITED", "message": "Authentication rate limit exceeded", "detail": {}},
            headers={"Retry-After": str(retry_after)},
        )


def _record_failure(buckets: dict[str, deque[float]], key: str) -> None:
    buckets.setdefault(key, deque()).append(time.monotonic())


def _check_guest_rate_limit(request: Request) -> None:
    try:
        _check_bucket(
            _guest_requests,
            _client_ip(request),
            settings.guest_rate_limit_per_hour,
        )
    except HTTPException as exc:
        exc.detail["message"] = "Guest token issuance rate limit exceeded"
        raise


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
    member_id = (
        member.get("cafe24_member_id")
        or member.get("member_id")
        or member.get("user_id")
        or member.get("id")
    )
    if member_id is None:
        raise ValueError("Cafe24 member ID missing")
    return {"cafe24_member_id": str(member_id)}


async def _exchange_kakao_code(code: str) -> dict:
    data = {
        "grant_type": "authorization_code",
        "client_id": settings.kakao_rest_api_key,
        "redirect_uri": settings.kakao_redirect_uri,
        "code": code,
    }
    if settings.kakao_client_secret:
        data["client_secret"] = settings.kakao_client_secret
    async with httpx.AsyncClient() as client:
        response = await client.post("https://kauth.kakao.com/oauth/token", data=data)
        response.raise_for_status()
        return response.json()


async def _fetch_kakao_member(access_token: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://kapi.kakao.com/v2/user/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        return response.json()


async def _exchange_naver_code(code: str, state: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://nid.naver.com/oauth2.0/token",
            data={
                "grant_type": "authorization_code",
                "client_id": settings.naver_client_id,
                "client_secret": settings.naver_client_secret,
                "code": code,
                "state": state,
            },
        )
        response.raise_for_status()
        return response.json()


async def _fetch_naver_member(access_token: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://openapi.naver.com/v1/nid/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        return response.json()


async def _merge_or_promote_guest(
    connection,
    guest_id: uuid.UUID,
    *,
    id_field: str,
    id_value: str,
    nickname: str | None = None,
) -> tuple[Member, bool]:
    """Merge a locked guest into an existing member or promote it in place."""
    if id_field not in {"kakao_id", "naver_id", "email"}:
        raise ValueError("unsupported member identity field")

    guest = await Member.get(id=guest_id).using_db(connection)
    existing = await Member.filter(
        kind=MemberKind.MEMBER, **{id_field: id_value}
    ).select_for_update().using_db(connection).first()
    if existing is not None:
        for model in (PetProfile, SourceImage, GenerationJob, CustomPromptLog, MetricEvent):
            await model.filter(member_id=guest.id).using_db(connection).update(member_id=existing.id)
        guest.merged_into_id = existing.id
        await guest.save(update_fields=["merged_into_id"], using_db=connection)
        existing.oauth_state_nonce = None
        existing.oauth_state_expires_at = None
        update_fields = ["oauth_state_nonce", "oauth_state_expires_at"]
        if existing.nickname is None and nickname is not None:
            existing.nickname = nickname
            update_fields.append("nickname")
        await existing.save(
            update_fields=update_fields,
            using_db=connection,
        )
        return existing, True

    guest.kind = MemberKind.MEMBER
    setattr(guest, id_field, id_value)
    guest.guest_expires_at = None
    guest.oauth_state_nonce = None
    guest.oauth_state_expires_at = None
    guest.nickname = nickname
    await guest.save(
        update_fields=[
            "kind",
            id_field,
            "guest_expires_at",
            "oauth_state_nonce",
            "oauth_state_expires_at",
            "nickname",
        ],
        using_db=connection,
    )
    return guest, False


@router.post("/guest", status_code=201, response_model=GuestTokenResponse)
async def issue_guest_token(request: Request) -> GuestTokenResponse:
    _check_guest_rate_limit(request)
    member = await Member.create(
        kind=MemberKind.GUEST,
        guest_expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    await grant_credits(member.id, 1, CreditReason.GUEST_TRIAL, "guest_trial")
    return GuestTokenResponse(token=create_token(member.id, "guest"), member_id=str(member.id), kind="guest")


# Fixed Cafe24 paths must be registered before the provider parameter routes below.
@router.get("/cafe24/authorize", response_model=AuthorizeResponse)
async def cafe24_authorize(member: Member = Depends(get_current_member)) -> AuthorizeResponse:
    if member.kind != MemberKind.MEMBER:
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
            "state": create_state(member.id, nonce, expires_at),
        }
    )
    return AuthorizeResponse(
        authorize_url=f"https://{settings.cafe24_mall_id}.cafe24api.com/api/v2/oauth/authorize?{query}"
    )


@router.get("/cafe24/callback", response_model=Cafe24LinkResponse)
async def cafe24_callback(code: str, state: str) -> Cafe24LinkResponse:
    member_id, nonce = state_identity(state)
    async with in_transaction() as connection:
        member = await Member.filter(
            id=member_id,
            kind=MemberKind.MEMBER,
            merged_into_id__isnull=True,
        ).select_for_update().using_db(connection).first()
        if (
            member is None
            or member.oauth_state_nonce is None
            or not secrets.compare_digest(member.oauth_state_nonce, nonce)
            or member.oauth_state_expires_at is None
            or member.oauth_state_expires_at <= datetime.now(timezone.utc)
        ):
            raise _unauthorized()
        member.oauth_state_nonce = None
        member.oauth_state_expires_at = None
        await member.save(
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
        member = await Member.filter(
            id=member_id,
            kind=MemberKind.MEMBER,
            merged_into_id__isnull=True,
        ).select_for_update().using_db(connection).first()
        if member is None:
            raise _unauthorized()
        existing = await Member.filter(
            kind=MemberKind.MEMBER,
            cafe24_member_id=cafe24_member_id,
        ).using_db(connection).first()
        if existing is not None and existing.id != member.id:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "CAFE24_ALREADY_LINKED",
                    "message": "Cafe24 account is already linked",
                    "detail": {},
                },
            )
        if (
            member.cafe24_member_id is not None
            and member.cafe24_member_id != cafe24_member_id
        ):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "CAFE24_ALREADY_LINKED",
                    "message": "Member is already linked to another Cafe24 account",
                    "detail": {},
                },
            )
        member.cafe24_member_id = cafe24_member_id
        if member.order_reward_cutoff is None:
            member.order_reward_cutoff = datetime.now(timezone.utc)
        await member.save(
            update_fields=["cafe24_member_id", "order_reward_cutoff"],
            using_db=connection,
        )

    await grant_credits(member_id, 3, CreditReason.LINK_ACCOUNT, "link_account")
    member = await Member.get(id=member_id)
    return Cafe24LinkResponse(cafe24_linked=True, credit_balance=member.credit_balance)


@router.get("/{provider}/authorize", response_model=AuthorizeResponse)
async def social_authorize(
    provider: Literal["kakao", "naver"],
    authorization: str | None = Header(None, alias="Authorization"),
) -> AuthorizeResponse:
    identity = identity_from_authorization(authorization)
    if identity is None:
        raise _unauthorized()
    guest_id, kind = identity
    if kind == "member":
        raise _already_member()
    if kind != "guest":
        raise _unauthorized()
    guest = await Member.filter(
        id=guest_id,
        kind=MemberKind.GUEST,
        merged_into_id__isnull=True,
    ).first()
    if guest is None:
        raise _unauthorized()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    nonce = secrets.token_urlsafe(32)
    guest.oauth_state_nonce = nonce
    guest.oauth_state_expires_at = expires_at
    await guest.save(update_fields=["oauth_state_nonce", "oauth_state_expires_at"])
    state = create_state(guest.id, nonce, expires_at)
    if provider == "kakao":
        url = "https://kauth.kakao.com/oauth/authorize"
        client_id = settings.kakao_rest_api_key
        redirect_uri = settings.kakao_redirect_uri
    else:
        url = "https://nid.naver.com/oauth2.0/authorize"
        client_id = settings.naver_client_id
        redirect_uri = settings.naver_redirect_uri
    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "state": state,
        }
    )
    return AuthorizeResponse(authorize_url=f"{url}?{query}")


@router.get("/{provider}/callback", response_model=AuthCallbackResponse)
async def social_callback(
    provider: Literal["kakao", "naver"], code: str, state: str
) -> AuthCallbackResponse:
    guest_id, nonce = state_identity(state)
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
        if provider == "kakao":
            token_data = await _exchange_kakao_code(code)
            profile = await _fetch_kakao_member(token_data["access_token"])
            provider_id = profile["id"]
            if not isinstance(provider_id, int):
                raise TypeError("Kakao member ID missing")
            id_field, id_value = "kakao_id", str(provider_id)
            properties = profile.get("properties")
            nickname = properties.get("nickname") if isinstance(properties, dict) else None
            if not isinstance(nickname, str):
                account = profile.get("kakao_account")
                account_profile = account.get("profile") if isinstance(account, dict) else None
                nickname = account_profile.get("nickname") if isinstance(account_profile, dict) else None
            if not isinstance(nickname, str):
                nickname = None
        else:
            token_data = await _exchange_naver_code(code, state)
            profile = await _fetch_naver_member(token_data["access_token"])
            response = profile.get("response")
            if not isinstance(response, dict):
                raise TypeError("Naver member ID missing")
            provider_id = response.get("id")
            if not isinstance(provider_id, str) or not provider_id:
                raise TypeError("Naver member ID missing")
            id_field, id_value = "naver_id", provider_id
            nickname = response.get("nickname")
            if not isinstance(nickname, str):
                nickname = None
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
        target, merged = await _merge_or_promote_guest(
            connection,
            guest_id,
            id_field=id_field,
            id_value=id_value,
            nickname=nickname,
        )
        # ponytail: concurrent login is last-commit-wins; an earlier refresh gets 401, then the client re-logs in. Use a session table for multi-device support.
        refresh_token = secrets.token_urlsafe(32)
        target.refresh_token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
        target.refresh_expires_at = datetime.now(timezone.utc) + timedelta(
            seconds=settings.jwt_refresh_expires_in
        )
        await target.save(
            update_fields=["refresh_token_hash", "refresh_expires_at"],
            using_db=connection,
        )

    target = await Member.get(id=target.id)
    return AuthCallbackResponse(
        token=create_token(target.id, "member"),
        refresh_token=refresh_token,
        member_id=str(target.id),
        kind="member",
        merged=merged,
        credit_balance=target.credit_balance,
    )


@router.post("/register", status_code=201, response_model=AuthCallbackResponse)
async def register(
    body: RegisterRequest,
    request: Request,
    authorization: str | None = Header(None, alias="Authorization"),
) -> AuthCallbackResponse:
    _check_bucket(_register_requests, _client_ip(request), _REGISTER_IP_RATE_LIMIT)
    identity = identity_from_authorization(authorization)
    if identity is None:
        raise _unauthorized()
    guest_id, kind = identity
    if kind == "member":
        raise _already_member()
    if kind != "guest":
        raise _unauthorized()
    guest = await Member.filter(
        id=guest_id,
        kind=MemberKind.GUEST,
        merged_into_id__isnull=True,
    ).first()
    if guest is None:
        raise _unauthorized()
    # scrypt(~40ms)를 트랜잭션 밖에서 수행 — DB 커넥션·행 잠금 점유 방지
    password_hash = await asyncio.to_thread(hash_password, body.password)
    async with in_transaction() as connection:
        if await Member.filter(email=body.email).using_db(connection).exists():
            raise HTTPException(
                status_code=409,
                detail={"code": "EMAIL_TAKEN", "message": "Email is already registered", "detail": {}},
            )
        guest = await Member.filter(
            id=guest_id,
            kind=MemberKind.GUEST,
            merged_into_id__isnull=True,
        ).select_for_update().using_db(connection).first()
        if guest is None:
            raise _unauthorized()
        target, merged = await _merge_or_promote_guest(
            connection, guest_id, id_field="email", id_value=body.email
        )
        if merged:
            raise HTTPException(
                status_code=409,
                detail={"code": "EMAIL_TAKEN", "message": "Email is already registered", "detail": {}},
            )
        target.password_hash = password_hash
        refresh_token = secrets.token_urlsafe(32)
        target.refresh_token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
        target.refresh_expires_at = datetime.now(timezone.utc) + timedelta(
            seconds=settings.jwt_refresh_expires_in
        )
        await target.save(
            update_fields=["password_hash", "refresh_token_hash", "refresh_expires_at"],
            using_db=connection,
        )

    target = await Member.get(id=target.id)
    return AuthCallbackResponse(
        token=create_token(target.id, "member"),
        refresh_token=refresh_token,
        member_id=str(target.id),
        kind="member",
        merged=False,
        credit_balance=target.credit_balance,
    )


@router.post("/login", response_model=AuthCallbackResponse)
async def login(
    body: LoginRequest,
    request: Request,
    authorization: str | None = Header(None, alias="Authorization"),
) -> AuthCallbackResponse:
    _check_bucket(_login_requests, f"ip:{_client_ip(request)}", _LOGIN_IP_RATE_LIMIT)
    email_key = f"email:{body.email}"
    _peek_bucket(_login_requests, email_key, _LOGIN_EMAIL_RATE_LIMIT)
    identity = identity_from_authorization(authorization)
    if identity is None:
        raise _unauthorized()
    guest_id, kind = identity
    if kind == "member":
        raise _already_member()
    if kind != "guest":
        raise _unauthorized()
    guest = await Member.filter(
        id=guest_id,
        kind=MemberKind.GUEST,
        merged_into_id__isnull=True,
    ).first()
    if guest is None:
        raise _unauthorized()
    member = await Member.filter(email=body.email, kind=MemberKind.MEMBER).first()
    if member is None:
        await asyncio.to_thread(verify_password, body.password, DUMMY_PASSWORD_HASH)
        _record_failure(_login_requests, email_key)
        raise _invalid_credentials()
    if not await asyncio.to_thread(verify_password, body.password, member.password_hash):
        _record_failure(_login_requests, email_key)
        raise _invalid_credentials()
    _login_requests.pop(email_key, None)

    async with in_transaction() as connection:
        guest = await Member.filter(
            id=guest_id,
            kind=MemberKind.GUEST,
            merged_into_id__isnull=True,
        ).select_for_update().using_db(connection).first()
        if guest is None:
            raise _unauthorized()
        target, merged = await _merge_or_promote_guest(
            connection, guest_id, id_field="email", id_value=body.email
        )
        refresh_token = secrets.token_urlsafe(32)
        target.refresh_token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
        target.refresh_expires_at = datetime.now(timezone.utc) + timedelta(
            seconds=settings.jwt_refresh_expires_in
        )
        await target.save(
            update_fields=["refresh_token_hash", "refresh_expires_at"],
            using_db=connection,
        )

    target = await Member.get(id=target.id)
    return AuthCallbackResponse(
        token=create_token(target.id, "member"),
        refresh_token=refresh_token,
        member_id=str(target.id),
        kind="member",
        merged=merged,
        credit_balance=target.credit_balance,
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(body: RefreshRequest, request: Request) -> RefreshResponse:
    client_ip = _client_ip(request)
    _peek_bucket(_refresh_requests, client_ip, 20)
    refresh_hash = hashlib.sha256(body.refresh_token.encode()).hexdigest()
    now = datetime.now(timezone.utc)
    async with in_transaction() as connection:
        # ponytail: rotation removes the old hash, so reuse naturally fails this lookup.
        member = await Member.filter(
            refresh_token_hash=refresh_hash,
            kind=MemberKind.MEMBER,
            merged_into_id__isnull=True,
        ).select_for_update().using_db(connection).first()
        if (
            member is None
            or member.refresh_expires_at is None
            or member.refresh_expires_at <= now
        ):
            _record_failure(_refresh_requests, client_ip)
            raise _unauthorized()
        refresh_token = secrets.token_urlsafe(32)
        member.refresh_token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
        member.refresh_expires_at = now + timedelta(seconds=settings.jwt_refresh_expires_in)
        await member.save(
            update_fields=["refresh_token_hash", "refresh_expires_at"],
            using_db=connection,
        )
    return RefreshResponse(
        token=create_token(member.id, "member"),
        refresh_token=refresh_token,
    )


@router.get("/me", response_model=MeResponse)
async def get_me(member: Member = Depends(get_current_member)) -> MeResponse:
    providers = []
    if member.kind == MemberKind.MEMBER:
        if member.kakao_id is not None:
            providers.append("kakao")
        if member.naver_id is not None:
            providers.append("naver")
        if member.password_hash is not None:
            providers.append("local")
    return MeResponse(
        member_id=str(member.id),
        kind=member.kind.value,
        credit_balance=member.credit_balance,
        email=member.email,
        nickname=member.nickname,
        providers=providers,
        cafe24_linked=member.cafe24_member_id is not None,
    )


@router.post("/logout", status_code=204)
async def logout(member: Member = Depends(get_current_member)) -> None:
    if member.kind == MemberKind.GUEST:
        # ponytail: access tokens remain valid for their lifetime, as before; issue #11 L4 is out of scope.
        return None
    member.refresh_token_hash = None
    member.refresh_expires_at = None
    await member.save(update_fields=["refresh_token_hash", "refresh_expires_at"])
    return None
