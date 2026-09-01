import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from tortoise import Tortoise

from app.routers import admin, auth, credits, events, jobs, library, pets, results, styles, uploads, webhooks
from app.settings import settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await Tortoise.init(
        db_url=settings.database_url,
        modules={"models": ["app.models"]},
        _enable_global_fallback=True,
    )
    logger.info("trust_proxy=%s guest_rate_limit_per_hour=%s", settings.trust_proxy, settings.guest_rate_limit_per_hour)
    yield
    await Tortoise.close_connections()


app = FastAPI(title="Nutti Photo Playground API", lifespan=lifespan)
if not settings.r2_endpoint_url:
    os.makedirs("var/media", exist_ok=True)
    app.mount("/media", StaticFiles(directory="var/media"), name="media")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_allowed_origins.split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    expose_headers=["ETag"],
)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """docs/05-api-spec.md §1 공통 에러 포맷으로 변환.

    ponytail: fastapi.HTTPException은 starlette.exceptions.HTTPException의 서브클래스이므로
    베이스 클래스로 등록해야 라우팅 자체가 던지는 404(경로 불일치) 같은 케이스도 잡힌다.
    """
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail:
        code, message, extra = detail["code"], detail.get("message", ""), detail.get("detail", {})
    else:
        code, message, extra = "HTTP_ERROR", str(detail), {}
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": message, "detail": extra}},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"error": {"code": "VALIDATION_ERROR", "message": "요청 형식이 올바르지 않습니다", "detail": exc.errors()}},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled application exception", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "내부 오류가 발생했습니다", "detail": {}}},
    )


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}


for router in (
    auth.router,
    styles.router,
    uploads.router,
    pets.router,
    jobs.router,
    results.router,
    library.router,
    credits.router,
    events.router,
    admin.router,
    webhooks.router,
):
    app.include_router(router, prefix="/v1")
