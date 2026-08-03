"""라우터 전반에서 재사용하는 스캐폴딩 헬퍼."""

from fastapi import HTTPException


def not_implemented() -> None:
    """ponytail: 스캐폴딩 스텁 — 비즈니스 로직이 들어오기 전까지 모든 엔드포인트가 이걸 던집니다."""
    raise HTTPException(
        status_code=501,
        detail={"code": "NOT_IMPLEMENTED", "message": "Not implemented yet", "detail": {}},
    )
