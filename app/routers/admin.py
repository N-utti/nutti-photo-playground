import asyncio
from collections import deque

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from tortoise.functions import Count

from app.auth import DUMMY_PASSWORD_HASH, create_admin_token, get_current_admin, verify_password
from app.common import not_implemented
from app.models import AdminUser, GenerationJob, MetricEvent, Style
from app.routers.auth import _check_bucket, _client_ip, _invalid_credentials

router = APIRouter(prefix="/admin", tags=["admin"])

_admin_login_requests: dict[str, deque[float]] = {}
_ADMIN_LOGIN_IP_RATE_LIMIT = 10


class AdminLoginRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=128)


class CreateStyleRequest(BaseModel):
    code: str
    name: str
    section: str
    credit_cost: int = 1
    output_count: int = 1
    avg_seconds: int = 24
    progress_message: str | None = None
    fit_tags: list = []
    example_keys: list = []


class UpdateStyleRequest(BaseModel):
    status: str | None = None
    name: str | None = None
    section: str | None = None
    credit_cost: int | None = None
    sort_order: int | None = None
    progress_message: str | None = None
    fit_tags: list | None = None
    example_keys: list | None = None


class CreatePromptVersionRequest(BaseModel):
    # ponytail: pydantic reserves `model_config` as a BaseModel ClassVar, so the field
    # is declared under a different name and aliased back to the API spec's JSON key.
    model_config = ConfigDict(populate_by_name=True)

    prompt_text: str
    prompt_model_config: dict = Field(default_factory=dict, alias="model_config")
    traffic_weight: int = 100


class UpdatePromptVersionRequest(BaseModel):
    status: str | None = None
    traffic_weight: int | None = None


class PromoteCustomPromptRequest(BaseModel):
    section: str
    credit_cost: int = 1


class AdjustCreditsRequest(BaseModel):
    member_id: str
    amount: int
    dedupe_key: str
    reason: str


class UpdateSettingRequest(BaseModel):
    value: object


@router.post("/login")
async def admin_login(body: AdminLoginRequest, request: Request):
    _check_bucket(
        _admin_login_requests,
        f"ip:{_client_ip(request)}",
        _ADMIN_LOGIN_IP_RATE_LIMIT,
    )
    # ponytail: 관리자 계정은 소수라 이메일별 버킷은 과하며 IP 레이트리밋이면 충분하다.
    admin = await AdminUser.get_or_none(email=body.email)
    if admin is None:
        await asyncio.to_thread(verify_password, body.password, DUMMY_PASSWORD_HASH)
        raise _invalid_credentials()
    if not await asyncio.to_thread(verify_password, body.password, admin.password_hash):
        raise _invalid_credentials()
    return {
        "token": create_admin_token(admin.id),
        "admin_id": admin.id,
        "email": admin.email,
    }


@router.get("/styles")
async def admin_list_styles(admin: AdminUser = Depends(get_current_admin)):
    styles = await Style.all().order_by("section", "sort_order", "id")
    job_counts = (
        await GenerationJob.filter(style_id__isnull=False)
        .annotate(n=Count("id"))
        .group_by("style_id")
        .values("style_id", "n")
    )
    event_counts = (
        await MetricEvent.filter(
            style_id__isnull=False,
            event_type__in=["result_view", "share_click", "shop_exit_click"],
        )
        .annotate(n=Count("id"))
        .group_by("style_id", "event_type")
        .values("style_id", "event_type", "n")
    )
    jobs_by_style = {row["style_id"]: row["n"] for row in job_counts}
    total_jobs = sum(jobs_by_style.values())
    events_by_style = {
        (row["style_id"], row["event_type"]): row["n"] for row in event_counts
    }

    items = []
    for style in styles:
        selected = jobs_by_style.get(style.id, 0)
        result_views = events_by_style.get((style.id, "result_view"), 0)
        shares = events_by_style.get((style.id, "share_click"), 0)
        shop_clicks = events_by_style.get((style.id, "shop_exit_click"), 0)
        # ponytail: calculator_exit_click은 상점 전환 집계가 아니므로 포함하지 않는다.
        items.append(
            {
                "id": style.id,
                "code": style.code,
                "name": style.name,
                "section": style.section,
                "status": style.status.value,
                "sort_order": style.sort_order,
                "credit_cost": style.credit_cost,
                "output_count": style.output_count,
                "avg_seconds": style.avg_seconds,
                "selection_rate": round(selected / total_jobs, 3) if total_jobs else 0.0,
                "share_rate": round(shares / result_views, 3) if result_views else 0.0,
                "shop_click_rate": (
                    round(shop_clicks / result_views, 3) if result_views else 0.0
                ),
            }
        )
    return {"items": items}


@router.post("/styles", status_code=201)
async def admin_create_style(body: CreateStyleRequest):
    not_implemented()


@router.patch("/styles/{style_id}")
async def admin_update_style(style_id: int, body: UpdateStyleRequest):
    not_implemented()


@router.delete("/styles/{style_id}")
async def admin_retire_style(style_id: int):
    not_implemented()


@router.get("/styles/{style_id}/prompt-versions")
async def admin_list_prompt_versions(style_id: int):
    not_implemented()


@router.post("/styles/{style_id}/prompt-versions", status_code=201)
async def admin_create_prompt_version(style_id: int, body: CreatePromptVersionRequest):
    not_implemented()


@router.patch("/styles/{style_id}/prompt-versions/{version_id}")
async def admin_update_prompt_version(style_id: int, version_id: int, body: UpdatePromptVersionRequest):
    not_implemented()


@router.get("/custom-prompts/top")
async def admin_top_custom_prompts():
    not_implemented()


@router.post("/custom-prompts/{prompt_id}/promote", status_code=201)
async def admin_promote_custom_prompt(prompt_id: str, body: PromoteCustomPromptRequest):
    not_implemented()


@router.post("/credits/adjust")
async def admin_adjust_credits(body: AdjustCreditsRequest):
    not_implemented()


@router.get("/cafe24/status")
async def admin_cafe24_status():
    not_implemented()


@router.get("/settings")
async def admin_get_settings():
    not_implemented()


@router.patch("/settings/{key}")
async def admin_update_setting(key: str, body: UpdateSettingRequest):
    not_implemented()
