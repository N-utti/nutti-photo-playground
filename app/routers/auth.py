import asyncio
import hashlib
import logging
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
from tortoise.exceptions import IntegrityError
from tortoise.expressions import F
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
from app.common import api_error, member_only, unauthorized, validation_error
from app import cafe24
from app.credits import grant_credits
from app.models import (
    CreditLedger,
    CreditReason,
    CustomPromptLog,
    GenerationJob,
    GenerationResult,
    JobStatus,
    Member,
    MemberKind,
    MetricEvent,
    PetProfile,
    SourceImage,
)
from app.settings import settings

logger = logging.getLogger(__name__)

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
    cafe24_linked: bool
    credit_balance: int
    # 한 휴대폰 번호에 쇼핑몰 계정이 여러 개면(OTP 통과 후에만) 고르게 한다 — 이때 코드는 소비하지 않음
    candidates: list[str] | None = None


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


def _bad_gateway(exc: BaseException | None = None) -> HTTPException:
    # 카페24 실패 사유(SMS 429/422, 토큰 만료 등)를 남겨야 운영에서 502를 추적할 수 있다 — 응답 본문엔 노출 안 함
    if exc is not None:
        response = getattr(exc, "response", None)
        body = response.text[:300] if response is not None else ""
        logger.warning("cafe24 upstream failure: %s %s %s", type(exc).__name__, exc, body)
    return api_error(502, "BAD_GATEWAY", "Cafe24 authentication failed")


def _already_member() -> HTTPException:
    return api_error(409, "ALREADY_MEMBER", "Already signed in as a member")


def _invalid_credentials() -> HTTPException:
    return api_error(401, "INVALID_CREDENTIALS", "Invalid email or password")


def _client_ip(request: Request) -> str:
    if settings.trust_proxy:
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            return forwarded_for.rsplit(",", 1)[-1].strip()
    return request.client.host if request.client else "unknown"


_PRUNE_INTERVAL = 60.0
_last_prune_at: dict[int, float] = {}  # 버킷 dict별 마지막 전수 스캔 시각


def _prune_expired_buckets(buckets: dict[str, deque[float]], now: float) -> None:
    # N1(#11): 키 10k 초과가 유지되면 요청마다 O(n) 전수 스캔이 돌던 것을 dict별 60초 1회로 상각
    if len(buckets) <= 10_000:
        return
    if now - _last_prune_at.get(id(buckets), float("-inf")) < _PRUNE_INTERVAL:
        return
    _last_prune_at[id(buckets)] = now
    expired_keys = [
        bucket_key
        for bucket_key, bucket in buckets.items()
        if not bucket or bucket[-1] <= now - 3600
    ]
    for expired_key in expired_keys:
        del buckets[expired_key]


def _raise_if_limited(requests: deque[float], now: float, limit: int) -> None:
    while requests and requests[0] <= now - 3600:
        requests.popleft()
    if len(requests) >= limit:
        retry_after = max(1, math.ceil(requests[0] + 3600 - now))
        raise api_error(
            429,
            "RATE_LIMITED",
            "Authentication rate limit exceeded",
            headers={"Retry-After": str(retry_after)},
        )


def _check_bucket(buckets: dict[str, deque[float]], key: str, limit: int) -> None:
    now = time.monotonic()
    _prune_expired_buckets(buckets, now)
    requests = buckets.setdefault(key, deque())
    _raise_if_limited(requests, now, limit)
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
    _raise_if_limited(requests, now, limit)


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


async def _require_guest(authorization: str | None) -> Member:
    identity = identity_from_authorization(authorization)
    if identity is None:
        raise unauthorized()
    guest_id, kind = identity
    if kind == "member":
        raise _already_member()
    if kind != "guest":
        raise unauthorized()
    guest = await Member.filter(
        id=guest_id,
        kind=MemberKind.GUEST,
        merged_into_id__isnull=True,
    ).first()
    if guest is None:
        raise unauthorized()
    return guest


async def _lock_guest(connection, guest_id) -> Member:
    guest = await Member.filter(
        id=guest_id,
        kind=MemberKind.GUEST,
        merged_into_id__isnull=True,
    ).select_for_update().using_db(connection).first()
    if guest is None:
        raise unauthorized()
    return guest


async def _issue_oauth_state(member: Member, provider: str) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    nonce = secrets.token_urlsafe(32)
    member.oauth_state_nonce = nonce
    member.oauth_state_expires_at = expires_at
    await member.save(update_fields=["oauth_state_nonce", "oauth_state_expires_at"])
    return create_state(member.id, nonce, expires_at, provider)


async def _consume_oauth_state(
    member_id, nonce: str, kind: MemberKind
) -> None:
    async with in_transaction() as connection:
        member = await Member.filter(
            id=member_id,
            kind=kind,
            merged_into_id__isnull=True,
        ).select_for_update().using_db(connection).first()
        if (
            member is None
            or member.oauth_state_nonce is None
            or not secrets.compare_digest(member.oauth_state_nonce, nonce)
            or member.oauth_state_expires_at is None
            or member.oauth_state_expires_at <= datetime.now(timezone.utc)
        ):
            raise unauthorized()
        member.oauth_state_nonce = None
        member.oauth_state_expires_at = None
        await member.save(
            update_fields=["oauth_state_nonce", "oauth_state_expires_at"],
            using_db=connection,
        )


def _rotate_refresh_token(member: Member) -> str:
    refresh_token = secrets.token_urlsafe(32)
    member.refresh_token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
    member.refresh_expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=settings.jwt_refresh_expires_in
    )
    return refresh_token


async def _auth_callback_response(
    target: Member, refresh_token: str, merged: bool
) -> AuthCallbackResponse:
    target = await Member.get(id=target.id)
    return AuthCallbackResponse(
        token=create_token(target.id, "member", target.token_version),
        refresh_token=refresh_token,
        member_id=str(target.id),
        kind="member",
        merged=merged,
        credit_balance=target.credit_balance,
    )


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
        # N3(#11): 병합돼 죽는 게스트 행에 OAuth nonce 비밀값을 남기지 않는다(데이터 위생)
        guest.oauth_state_nonce = None
        guest.oauth_state_expires_at = None
        update_guest_fields = ["merged_into_id", "oauth_state_nonce", "oauth_state_expires_at"]
        # L6(#11): 게스트가 **벌어들인** 크레딧만 병합 대상에게 이관 — 무료 체험(guest_trial)분은 제외.
        # 전액 이관은 게스트 발급→병합 반복으로 무료 +1을 영구 계정에 적립하는 farming 경로가 된다(보안 리뷰 #235).
        # 오늘은 게스트 획득 경로가 없어 사실상 0이지만, 게스트가 벌 수 있게 되는 순간 자동으로 이관이 산다.
        trial = await CreditLedger.filter(
            member_id=guest.id, dedupe_key="guest_trial"
        ).using_db(connection).first()
        transferable = guest.credit_balance - (trial.amount if trial else 0)
        if transferable > 0:
            await grant_credits(
                existing.id,
                transferable,
                CreditReason.GUEST_MERGE,
                f"guest_merge:{guest.id}",
                ref_id=str(guest.id),
                connection=connection,
            )
            # 죽는 행이지만 전 회원 잔액 합계의 이중 계상은 막는다(보안 리뷰 LOW-5)
            guest.credit_balance -= transferable
            update_guest_fields.append("credit_balance")
        await guest.save(update_fields=update_guest_fields, using_db=connection)
        logger.info("auth guest merge: guest=%s -> member=%s via=%s", guest.id, existing.id, id_field)  # L-F
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
    logger.info("auth guest promoted: member=%s via=%s", guest.id, id_field)  # L-F(#11) 보안 이벤트 로깅
    return guest, False


@router.post("/guest", status_code=201, response_model=GuestTokenResponse)
async def issue_guest_token(request: Request) -> GuestTokenResponse:
    _check_guest_rate_limit(request)
    async with in_transaction() as connection:
        member = await Member.create(
            kind=MemberKind.GUEST,
            guest_expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            using_db=connection,
        )
        await grant_credits(
            member.id,
            1,
            CreditReason.GUEST_TRIAL,
            "guest_trial",
            connection=connection,
        )
    return GuestTokenResponse(token=create_token(member.id, "guest", member.token_version), member_id=str(member.id), kind="guest")


# Fixed Cafe24 paths must be registered before the provider parameter routes below.
# 쇼핑몰 계정 연동 = 쇼핑몰 아이디 입력 → 카페24 SMS로 6자리 OTP(수신자를 member_id로 지정하므로
# 우리는 전화번호를 모른다) → 검증 후 연동. 카페24 OAuth는 운영자 로그인이라 고객 인증에 쓸 수 없음.
_CAFE24_LINK_RATE_LIMIT = 3  # 회원당·수신 쇼핑몰 아이디당 시간당 OTP 발송 횟수
_cafe24_link_requests: dict[str, deque[float]] = {}
# 수신자 기준 한도 — 게스트→가입이 자유라 새 회원을 찍어내며 한 사람 폰에 SMS를 퍼붓는 것(비용은 쇼핑몰 부담)을 막는다
_cafe24_link_targets: dict[str, deque[float]] = {}
class Cafe24LinkRequest(BaseModel):
    # 쇼핑몰 아이디(영문/숫자/_ . @ -) 또는 가입 휴대폰 번호(숫자만) 중 하나 — 카카오/네이버로 쇼핑몰에 가입한
    # 고객은 아이디(예: 4993695098@k)를 모르므로 번호가 기본 경로
    shop_member_id: str | None = Field(default=None, min_length=2, max_length=64, pattern=r"^[A-Za-z0-9_.@\-]+$")
    cellphone: str | None = Field(default=None, pattern=r"^01[0-9]{8,9}$")  # \d는 유니코드 숫자도 통과


class Cafe24LinkVerifyRequest(Cafe24LinkRequest):
    code: str = Field(pattern=r"^\d{6}$")


class Cafe24LinkRequestResponse(BaseModel):
    sent: Literal[True]
    expires_in: int


def _link_target(body: Cafe24LinkRequest, *, allow_pick: bool = False) -> tuple[str, str]:
    """('tel', 번호) 또는 ('id', 아이디). verify에서는 번호 + 아이디(후보 선택) 동시 허용."""
    if body.cellphone is not None:
        if body.shop_member_id is not None and not allow_pick:
            raise validation_error("shop_member_id와 cellphone 중 하나만 보내세요")
        return "tel", body.cellphone
    if body.shop_member_id is None:
        raise validation_error("shop_member_id 또는 cellphone이 필요합니다")
    return "id", body.shop_member_id


def _otp_digest(kind: str, value: str, code: str) -> str:
    return hashlib.sha256(f"{kind}:{value}:{code}:{settings.jwt_signing_key}".encode()).hexdigest()


async def _linkable_candidates(member: Member, shop_member_ids: list[str]) -> list[str]:
    """조회된 쇼핑몰 계정 중 이 회원이 연동할 수 있는 것 — 이미 연동된 회원은 그 계정만(재바인딩 금지),
    다른 회원이 선점한 계정 제외."""
    if member.cafe24_member_id is not None:
        return [i for i in shop_member_ids if i == member.cafe24_member_id]
    taken = set(
        await Member.filter(kind=MemberKind.MEMBER, cafe24_member_id__in=shop_member_ids)
        .exclude(id=member.id)
        .values_list("cafe24_member_id", flat=True)
    )
    return [i for i in shop_member_ids if i not in taken]


async def _assert_cafe24_linkable(member: Member, shop_member_id: str) -> None:
    if member.cafe24_member_id is not None and member.cafe24_member_id != shop_member_id:
        raise api_error(409, "CAFE24_ALREADY_LINKED", "Member is already linked to another Cafe24 account")
    taken = await Member.filter(kind=MemberKind.MEMBER, cafe24_member_id=shop_member_id).exclude(id=member.id).exists()
    if taken:
        raise api_error(409, "CAFE24_ALREADY_LINKED", "Cafe24 account is already linked")


async def _find_shop_accounts(kind: str, value: str) -> list[str]:
    if kind == "id":
        return await cafe24.find_customers(member_id=value)
    return await cafe24.find_customers(cellphone=value)


@router.post("/cafe24/link/request", response_model=Cafe24LinkRequestResponse)
async def cafe24_link_request(
    body: Cafe24LinkRequest, member: Member = Depends(get_current_member)
) -> Cafe24LinkRequestResponse:
    if member.kind != MemberKind.MEMBER:
        raise member_only()
    kind, value = _link_target(body)
    # 한도 검사를 404/409보다 먼저 — "가입된 번호인지/이미 연동된 아이디인지"를 무제한으로 캐물을 수 없게
    _check_bucket(_cafe24_link_requests, str(member.id), _CAFE24_LINK_RATE_LIMIT)
    _check_bucket(_cafe24_link_targets, value, _CAFE24_LINK_RATE_LIMIT)
    try:
        found = await _find_shop_accounts(kind, value)
        if not found:
            raise api_error(404, "CAFE24_MEMBER_NOT_FOUND", "쇼핑몰 회원을 찾을 수 없습니다")
        if not await _linkable_candidates(member, found):
            raise api_error(409, "CAFE24_ALREADY_LINKED", "Cafe24 account is already linked")
        if found[0] != value:
            # 실제 수신 계정 기준으로도 — 번호/아이디를 바꿔 가며 한 폰에 퍼붓지 못하게
            _check_bucket(_cafe24_link_targets, found[0], _CAFE24_LINK_RATE_LIMIT)
        code = f"{secrets.randbelow(10**6):06d}"
        # 번호로 찾은 계정이 여러 개여도 같은 폰이라 첫 계정으로 보내면 된다
        await cafe24.send_sms(found[0], f"[누띠 놀이터] 쇼핑몰 계정 연동 인증번호 {code} (5분 유효)")
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise _bad_gateway(exc) from exc
    # ponytail: OTP 해시를 소셜 로그인 state와 같은 nonce 컬럼에 둔다 — 한 회원이 동시에 두 흐름을 타면 서로 덮어씀
    member.oauth_state_nonce = _otp_digest(kind, value, code)
    member.oauth_state_expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    await member.save(update_fields=["oauth_state_nonce", "oauth_state_expires_at"])
    return Cafe24LinkRequestResponse(sent=True, expires_in=300)


@router.post("/cafe24/link/verify", response_model=Cafe24LinkResponse)
async def cafe24_link_verify(
    body: Cafe24LinkVerifyRequest, member: Member = Depends(get_current_member)
) -> Cafe24LinkResponse:
    if member.kind != MemberKind.MEMBER:
        raise member_only()
    kind, value = _link_target(body, allow_pick=True)
    expected = _otp_digest(kind, value, body.code)
    # 1) 오답은 즉시 소비(단일 시도). 정답은 아직 두고 아래 2)에서 잠금 안에서 소비 — 번호 흐름은 후보가
    #    여러 개면 고르기 전까지 코드를 살려 둬야 하므로
    async with in_transaction() as connection:
        locked = await Member.filter(
            id=member.id, kind=MemberKind.MEMBER, merged_into_id__isnull=True
        ).select_for_update().using_db(connection).first()
        if locked is None:
            raise unauthorized()
        pending, expires_at = locked.oauth_state_nonce, locked.oauth_state_expires_at
        matched = (
            pending is not None
            and secrets.compare_digest(pending, expected)
            and expires_at is not None
            and expires_at > datetime.now(timezone.utc)
        )
        if not matched:
            locked.oauth_state_nonce = None
            locked.oauth_state_expires_at = None
            await locked.save(update_fields=["oauth_state_nonce", "oauth_state_expires_at"], using_db=connection)
    if not matched:
        logger.warning("cafe24 link code rejected: member=%s", member.id)  # L-F
        raise api_error(400, "CAFE24_CODE_INVALID", "인증번호가 올바르지 않거나 만료됐습니다")
    if kind == "id":
        chosen = value
    else:
        try:
            found = await _find_shop_accounts(kind, value)
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            raise _bad_gateway(exc) from exc
        candidates = await _linkable_candidates(member, found)
        if not candidates:
            raise api_error(409, "CAFE24_ALREADY_LINKED", "Cafe24 account is already linked")
        if len(candidates) == 1:
            chosen = candidates[0]
        elif body.shop_member_id in candidates:
            chosen = body.shop_member_id
        else:
            # OTP를 통과했으니 이 번호의 계정 목록을 보여줘도 된다(번호→아이디 캐내기는 코드 없인 불가)
            return Cafe24LinkResponse(cafe24_linked=False, credit_balance=member.credit_balance, candidates=candidates)
    # 2) 코드 소비 + 연동 + 최초 1회 +3 — 같은 잠금 안에서
    try:
        async with in_transaction() as connection:
            locked = await Member.filter(id=member.id).select_for_update().using_db(connection).first()
            if locked.oauth_state_nonce is None or not secrets.compare_digest(locked.oauth_state_nonce, expected):
                raise api_error(400, "CAFE24_CODE_INVALID", "인증번호가 올바르지 않거나 만료됐습니다")
            locked.oauth_state_nonce = None
            locked.oauth_state_expires_at = None
            await _assert_cafe24_linkable(locked, chosen)
            locked.cafe24_member_id = chosen
            if locked.order_reward_cutoff is None:
                locked.order_reward_cutoff = datetime.now(timezone.utc)
            await locked.save(
                update_fields=["cafe24_member_id", "order_reward_cutoff", "oauth_state_nonce", "oauth_state_expires_at"],
                using_db=connection,
            )
            if not await CreditLedger.filter(member_id=locked.id, dedupe_key="link_account").using_db(connection).exists():
                await grant_credits(locked.id, 3, CreditReason.LINK_ACCOUNT, "link_account", connection=connection)
    except IntegrityError as exc:  # 두 회원이 같은 아이디를 동시에 verify — UNIQUE(cafe24_member_id)가 마지막 방어선
        raise api_error(409, "CAFE24_ALREADY_LINKED", "Cafe24 account is already linked") from exc

    logger.info("cafe24 linked: member=%s shop=%s***", member.id, chosen[:3])  # L-F — 식별자 최소화(보안 리뷰 LOW-6)
    member = await Member.get(id=member.id)
    return Cafe24LinkResponse(cafe24_linked=True, credit_balance=member.credit_balance)


@router.get("/{provider}/authorize", response_model=AuthorizeResponse)
async def social_authorize(
    provider: Literal["kakao", "naver"],
    authorization: str | None = Header(None, alias="Authorization"),
) -> AuthorizeResponse:
    guest = await _require_guest(authorization)
    state = await _issue_oauth_state(guest, provider)
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
    guest_id, nonce, state_provider = state_identity(state)
    if state_provider != provider:  # L-C(#11): 다른 provider의 authorize로 발급된 state 차단
        raise unauthorized()
    await _consume_oauth_state(guest_id, nonce, MemberKind.GUEST)

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
        raise _bad_gateway(exc) from exc

    for attempt in range(2):
        try:
            async with in_transaction() as connection:
                await _lock_guest(connection, guest_id)
                target, merged = await _merge_or_promote_guest(
                    connection,
                    guest_id,
                    id_field=id_field,
                    id_value=id_value,
                    nickname=nickname,
                )
                # ponytail: concurrent login is last-commit-wins; an earlier refresh gets 401, then the client re-logs in. Use a session table for multi-device support.
                refresh_token = _rotate_refresh_token(target)
                await target.save(
                    update_fields=["refresh_token_hash", "refresh_expires_at"],
                    using_db=connection,
                )
            break
        except IntegrityError:
            if attempt:
                raise

    return await _auth_callback_response(target, refresh_token, merged)


@router.post("/register", status_code=201, response_model=AuthCallbackResponse)
async def register(
    body: RegisterRequest,
    request: Request,
    authorization: str | None = Header(None, alias="Authorization"),
) -> AuthCallbackResponse:
    _check_bucket(_register_requests, _client_ip(request), _REGISTER_IP_RATE_LIMIT)
    guest = await _require_guest(authorization)
    guest_id = guest.id
    # scrypt(~40ms)를 트랜잭션 밖에서 수행 — DB 커넥션·행 잠금 점유 방지
    password_hash = await asyncio.to_thread(hash_password, body.password)
    for attempt in range(2):
        try:
            async with in_transaction() as connection:
                if await Member.filter(email=body.email).using_db(connection).exists():
                    raise api_error(409, "EMAIL_TAKEN", "Email is already registered")
                await _lock_guest(connection, guest_id)
                target, merged = await _merge_or_promote_guest(
                    connection, guest_id, id_field="email", id_value=body.email
                )
                if merged:
                    raise api_error(409, "EMAIL_TAKEN", "Email is already registered")
                target.password_hash = password_hash
                refresh_token = _rotate_refresh_token(target)
                await target.save(
                    update_fields=[
                        "password_hash",
                        "refresh_token_hash",
                        "refresh_expires_at",
                    ],
                    using_db=connection,
                )
            break
        except IntegrityError:
            if attempt:
                raise

    return await _auth_callback_response(target, refresh_token, False)


@router.post("/login", response_model=AuthCallbackResponse)
async def login(
    body: LoginRequest,
    request: Request,
    authorization: str | None = Header(None, alias="Authorization"),
) -> AuthCallbackResponse:
    _check_bucket(_login_requests, f"ip:{_client_ip(request)}", _LOGIN_IP_RATE_LIMIT)
    email_key = f"email:{body.email}"
    _peek_bucket(_login_requests, email_key, _LOGIN_EMAIL_RATE_LIMIT)
    guest = await _require_guest(authorization)
    guest_id = guest.id
    member = await Member.filter(email=body.email, kind=MemberKind.MEMBER).first()
    if member is None:
        await asyncio.to_thread(verify_password, body.password, DUMMY_PASSWORD_HASH)
        _record_failure(_login_requests, email_key)
        logger.warning("auth login failed (unknown email): ip=%s", _client_ip(request))  # L2 — 이메일은 PII, 미기록
        raise _invalid_credentials()
    if not await asyncio.to_thread(verify_password, body.password, member.password_hash):
        _record_failure(_login_requests, email_key)
        logger.warning("auth login failed (bad password): member=%s ip=%s", member.id, _client_ip(request))  # L2
        raise _invalid_credentials()
    _login_requests.pop(email_key, None)

    async with in_transaction() as connection:
        await _lock_guest(connection, guest_id)
        target, merged = await _merge_or_promote_guest(
            connection, guest_id, id_field="email", id_value=body.email
        )
        refresh_token = _rotate_refresh_token(target)
        await target.save(
            update_fields=["refresh_token_hash", "refresh_expires_at"],
            using_db=connection,
        )

    return await _auth_callback_response(target, refresh_token, merged)


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
            logger.warning("auth refresh rejected: ip=%s", client_ip)  # L2 — 재사용/위조/만료 갱신 시도 흔적
            raise unauthorized()
        refresh_token = _rotate_refresh_token(member)
        await member.save(
            update_fields=["refresh_token_hash", "refresh_expires_at"],
            using_db=connection,
        )
    return RefreshResponse(
        token=create_token(member.id, "member", member.token_version),
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
        # ponytail: 게스트는 서버측 무효화 없음(30일 만료 수용) — issue #11 결정 유지.
        return None
    # token_version 원자 증가로 발급된 액세스 토큰 전부 즉시 무효화 (#11 M6).
    # 진행 중이던 OAuth state도 함께 정리.
    await Member.filter(id=member.id).update(
        refresh_token_hash=None,
        refresh_expires_at=None,
        oauth_state_nonce=None,
        oauth_state_expires_at=None,
        token_version=F("token_version") + 1,
    )
    return None


@router.delete("/me", status_code=204)
async def withdraw(member: Member = Depends(get_current_member)) -> None:
    """회원 탈퇴 (#22): 자산 논리삭제 + 크레딧 소멸(원장 보존) + member 익명화.

    스토리지 실파기(R2 삭제·CDN 퍼지)는 06-architecture §4 삭제 파이프라인의
    배치가 deleted_at 기준으로 수행한다. 카페24 쇼핑몰 회원에는 무영향.
    """
    if member.kind != MemberKind.MEMBER:
        raise member_only()
    now = datetime.now(timezone.utc)
    async with in_transaction() as connection:
        locked = await Member.filter(
            id=member.id, withdrawn_at__isnull=True
        ).select_for_update().using_db(connection).first()
        if locked is None:
            return None
        await SourceImage.filter(
            member_id=member.id, deleted_at__isnull=True
        ).using_db(connection).update(deleted_at=now)
        job_ids = await GenerationJob.filter(member_id=member.id).using_db(
            connection
        ).values_list("id", flat=True)
        if job_ids:
            await GenerationResult.filter(
                job_id__in=job_ids, deleted_at__isnull=True
            ).using_db(connection).update(deleted_at=now)
        # 대기·진행 중 job 취소 — 워커가 탈퇴 후 신규 결과물을 만들지 못하게
        await GenerationJob.filter(
            member_id=member.id,
            status__in=[JobStatus.QUEUED, JobStatus.PROCESSING],
        ).using_db(connection).update(
            status=JobStatus.FAILED, error_code="WITHDRAWN", finished_at=now
        )
        # 사용자 자유 입력 텍스트 파기(커스텀 프롬프트 원문·스타일 입력값)
        await CustomPromptLog.filter(member_id=member.id).using_db(connection).update(
            raw_text="", normalized_text=""
        )
        await GenerationJob.filter(
            member_id=member.id, input_values__isnull=False
        ).using_db(connection).update(input_values=None)
        await PetProfile.filter(member_id=member.id).using_db(connection).delete()
        if locked.credit_balance > 0:
            await grant_credits(
                member.id,
                -locked.credit_balance,
                CreditReason.WITHDRAWAL_FORFEIT,
                "withdrawal_forfeit",
                connection=connection,
            )
        await Member.filter(id=member.id).using_db(connection).update(
            email=None,
            password_hash=None,
            kakao_id=None,
            naver_id=None,
            cafe24_member_id=None,
            nickname=None,
            refresh_token_hash=None,
            refresh_expires_at=None,
            oauth_state_nonce=None,
            oauth_state_expires_at=None,
            credit_balance=0,
            token_version=F("token_version") + 1,
            withdrawn_at=now,
        )
    return None
