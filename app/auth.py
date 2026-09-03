"""JWT 발급과 인증 의존성."""

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Header, HTTPException

from app.common import unauthorized
from app.models import AdminUser, Member
from app.settings import settings


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    # ponytail: scrypt n=2^14 — VPS 메모리 상한, 필요 시 n 상향/argon2 승격
    derived = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored_hash: str | None) -> bool:
    try:
        _, n, r, p, salt_hex, hash_hex = stored_hash.split("$")
        salt = bytes.fromhex(salt_hex)
        derived = hashlib.scrypt(
            password.encode(), salt=salt, n=int(n), r=int(r), p=int(p), dklen=32
        )
        return hmac.compare_digest(derived.hex(), hash_hex)
    except (AttributeError, ValueError, TypeError):
        return False


DUMMY_PASSWORD_HASH = (
    "scrypt$16384$8$1$000102030405060708090a0b0c0d0e0f$"
    "6ff0724275ec81a23988ba3fffa6d60911e8b2ef48618d692c114ce55f485590"
)


def create_token(member_id: uuid.UUID, kind: str, version: int) -> str:
    expires_in = settings.jwt_guest_expires_in if kind == "guest" else settings.jwt_expires_in
    return jwt.encode(
        {
            "sub": str(member_id),
            "kind": kind,
            "ver": version,
            "exp": datetime.now(timezone.utc) + timedelta(seconds=expires_in),
        },
        settings.jwt_signing_key,
        algorithm="HS256",
    )


HANDOFF_TTL_SECONDS = 120


def create_handoff_code(member_id: uuid.UUID, version: int) -> str:
    """세션을 다른 브라우저로 **한 번** 옮기는 코드 — 인앱 웹뷰 → 크롬.

    Android 웹뷰에는 OS 공유 시트가 없어(크로미움이 WebView 에선 Web Share 를 안 켬)
    「공유」가 크롬으로 나가야 하는데, 게스트 세션이 웹뷰 localStorage 에 갇혀 크롬에서는
    결과가 안 열린다. 그래서 짧은 서명 코드를 URL 에 실어 나가고 크롬이 소진해 같은
    세션의 토큰을 받는다. 120초·1회용(jti, 소진 기록은 라우터). `ver` 는 액세스 토큰과 같은
    token_version 이라 로그아웃 뒤엔 코드도 죽는다.
    """
    return jwt.encode(
        {
            "sub": str(member_id),
            "kind": "handoff",
            "ver": version,
            "jti": secrets.token_urlsafe(16),
            "exp": datetime.now(timezone.utc) + timedelta(seconds=HANDOFF_TTL_SECONDS),
        },
        settings.jwt_signing_key,
        algorithm="HS256",
    )


def decode_handoff_code(code: str) -> dict:
    """위조·만료·다른 종류의 토큰은 전부 401 — 액세스 토큰을 코드 자리에 넣어도 안 통한다."""
    try:
        payload = jwt.decode(
            code,
            settings.jwt_signing_key,
            algorithms=["HS256"],
            options={"require": ["sub", "kind", "exp", "jti", "ver"]},
        )
    except jwt.InvalidTokenError as exc:
        raise unauthorized() from exc
    if payload["kind"] != "handoff":
        raise unauthorized()
    return payload


def create_admin_token(admin_id: int) -> str:
    return jwt.encode(
        {
            "sub": str(admin_id),
            "kind": "admin",
            "exp": datetime.now(timezone.utc) + timedelta(seconds=settings.jwt_expires_in),
        },
        settings.jwt_signing_key,
        algorithm="HS256",
    )


def create_state(member_id: uuid.UUID, nonce: str, expires_at: datetime, provider: str) -> str:
    return jwt.encode(
        {
            "sub": str(member_id),
            "kind": "state",
            # L-C(#11): kakao authorize로 받은 state를 naver 콜백에 못 쓰게 — 콜백에서 대조(심층 방어)
            "provider": provider,
            "nonce": nonce,
            "exp": expires_at,
        },
        settings.jwt_signing_key,
        algorithm="HS256",
    )


def state_identity(state: str) -> tuple[uuid.UUID, str, str]:
    try:
        payload = jwt.decode(
            state,
            settings.jwt_signing_key,
            algorithms=["HS256"],
            options={"require": ["sub", "kind", "nonce", "exp", "provider"]},
        )
        if (
            payload["kind"] != "state"
            or not isinstance(payload["nonce"], str)
            or not isinstance(payload["provider"], str)
        ):
            raise ValueError
        return uuid.UUID(payload["sub"]), payload["nonce"], payload["provider"]
    except (jwt.InvalidTokenError, TypeError, ValueError) as exc:
        raise unauthorized() from exc


def _decode_authorization(authorization: str | None) -> dict:
    if not authorization:
        raise unauthorized()
    scheme, separator, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not separator or not token.strip():
        raise unauthorized()
    try:
        return jwt.decode(
            token.strip(),
            settings.jwt_signing_key,
            algorithms=["HS256"],
            options={"require": ["sub", "kind", "exp"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise unauthorized("TOKEN_EXPIRED") from exc
    except jwt.InvalidTokenError as exc:
        raise unauthorized() from exc


def identity_from_authorization(authorization: str | None) -> tuple[uuid.UUID, str] | None:
    try:
        payload = _decode_authorization(authorization)
        return uuid.UUID(payload["sub"]), payload["kind"]
    except HTTPException as exc:
        if exc.detail.get("code") == "TOKEN_EXPIRED":
            raise
        return None
    except (TypeError, ValueError):
        return None


async def get_current_member(authorization: str | None = Header(None, alias="Authorization")) -> Member:
    payload = _decode_authorization(authorization)
    try:
        member_id = uuid.UUID(payload["sub"])
    except (TypeError, ValueError) as exc:
        raise unauthorized() from exc

    member = await Member.get_or_none(id=member_id)
    if (
        member is None
        or member.merged_into_id is not None
        or member.withdrawn_at is not None
        or payload["kind"] != member.kind.value
        # ponytail: 구버전 토큰(ver 클레임 없음)은 0으로 간주 — 초기 token_version과 일치
        or payload.get("ver", 0) != member.token_version
    ):
        raise unauthorized()
    return member


async def get_current_admin(
    authorization: str | None = Header(None, alias="Authorization"),
) -> AdminUser:
    payload = _decode_authorization(authorization)
    if payload["kind"] != "admin":
        raise unauthorized()
    try:
        admin_id = int(payload["sub"])
    except (TypeError, ValueError) as exc:
        raise unauthorized() from exc

    admin = await AdminUser.get_or_none(id=admin_id)
    if admin is None:
        raise unauthorized()
    return admin
