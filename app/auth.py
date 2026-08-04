"""JWT 발급과 인증 의존성."""

import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Header, HTTPException

from app.models import Member
from app.settings import settings


def _unauthorized(code: str = "UNAUTHORIZED") -> HTTPException:
    message = "Token has expired" if code == "TOKEN_EXPIRED" else "Invalid or missing authentication token"
    return HTTPException(status_code=401, detail={"code": code, "message": message, "detail": {}})


def create_token(member_id: uuid.UUID, kind: str) -> str:
    expires_in = settings.jwt_guest_expires_in if kind == "guest" else settings.jwt_expires_in
    return jwt.encode(
        {"sub": str(member_id), "kind": kind, "exp": datetime.now(timezone.utc) + timedelta(seconds=expires_in)},
        settings.jwt_signing_key,
        algorithm="HS256",
    )


def create_state(member_id: uuid.UUID, nonce: str, expires_at: datetime) -> str:
    return jwt.encode(
        {
            "sub": str(member_id),
            "kind": "state",
            "nonce": nonce,
            "exp": expires_at,
        },
        settings.jwt_signing_key,
        algorithm="HS256",
    )


def state_identity(state: str) -> tuple[uuid.UUID, str]:
    try:
        payload = jwt.decode(
            state,
            settings.jwt_signing_key,
            algorithms=["HS256"],
            options={"require": ["sub", "kind", "nonce", "exp"]},
        )
        if payload["kind"] != "state" or not isinstance(payload["nonce"], str):
            raise ValueError
        return uuid.UUID(payload["sub"]), payload["nonce"]
    except (jwt.InvalidTokenError, TypeError, ValueError) as exc:
        raise _unauthorized() from exc


def _decode_authorization(authorization: str | None) -> dict:
    if not authorization:
        raise _unauthorized()
    scheme, separator, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not separator or not token.strip():
        raise _unauthorized()
    try:
        return jwt.decode(
            token.strip(),
            settings.jwt_signing_key,
            algorithms=["HS256"],
            options={"require": ["sub", "kind", "exp"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise _unauthorized("TOKEN_EXPIRED") from exc
    except jwt.InvalidTokenError as exc:
        raise _unauthorized() from exc


def guest_member_id_from_authorization(authorization: str | None) -> uuid.UUID | None:
    try:
        payload = _decode_authorization(authorization)
        return uuid.UUID(payload["sub"]) if payload["kind"] == "guest" else None
    except (HTTPException, TypeError, ValueError):
        return None


async def get_current_member(authorization: str | None = Header(None, alias="Authorization")) -> Member:
    payload = _decode_authorization(authorization)
    try:
        member_id = uuid.UUID(payload["sub"])
    except (TypeError, ValueError) as exc:
        raise _unauthorized() from exc

    member = await Member.get_or_none(id=member_id)
    if member is None or member.merged_into_id is not None or payload["kind"] != member.kind.value:
        raise _unauthorized()
    return member
