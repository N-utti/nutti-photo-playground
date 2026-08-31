"""라우터 전반에서 재사용하는 스캐폴딩 헬퍼."""

from datetime import timedelta, timezone

from fastapi import HTTPException

KST = timezone(timedelta(hours=9))


def api_error(
    status_code: int,
    code: str,
    message: str,
    detail: dict | None = None,
    headers: dict | None = None,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, "detail": detail or {}},
        headers=headers,
    )


def unauthorized(code: str = "UNAUTHORIZED") -> HTTPException:
    message = (
        "Token has expired"
        if code == "TOKEN_EXPIRED"
        else "Invalid or missing authentication token"
    )
    return api_error(401, code, message)


def member_only() -> HTTPException:
    return api_error(403, "MEMBER_ONLY", "로그인이 필요합니다")


def validation_error(
    message: str = "요청 형식이 올바르지 않습니다",
    detail: dict | None = None,
) -> HTTPException:
    return api_error(400, "VALIDATION_ERROR", message, detail)


def not_found(message: str) -> HTTPException:
    return api_error(404, "NOT_FOUND", message)
