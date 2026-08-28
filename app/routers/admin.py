import asyncio
import logging
from collections import deque
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from tortoise.exceptions import IntegrityError
from tortoise.functions import Count

from app.auth import DUMMY_PASSWORD_HASH, create_admin_token, get_current_admin, verify_password
from app.common import not_found, not_implemented, validation_error
from app.models import AdminUser, GenerationJob, MetricEvent, Style, StyleStatus
from app.routers.auth import (
    _check_bucket,
    _client_ip,
    _invalid_credentials,
    _peek_bucket,
    _record_failure,
)

router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger(__name__)

_admin_login_requests: dict[str, deque[float]] = {}
_ADMIN_LOGIN_IP_RATE_LIMIT = 10
_ADMIN_LOGIN_EMAIL_RATE_LIMIT = 5


class AdminLoginRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


# ponytail: jobs.py의 _resolve_input_values가 field["label"]을 무방비로 읽으므로 여기서 400으로 막는다.
class InputFieldSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    label: str = Field(min_length=1)


class CreateStyleRequest(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1)
    section: str = Field(min_length=1, max_length=50)
    credit_cost: int = Field(1, ge=0)
    output_count: int = Field(1, ge=1)
    avg_seconds: int = Field(24, ge=1)
    progress_message: str | None = None
    fit_tags: list = []
    example_keys: list = []
    input_fields: list[InputFieldSpec] = []


class UpdateStyleRequest(BaseModel):
    status: StyleStatus | None = None
    name: str | None = Field(default=None, min_length=1)
    section: str | None = Field(default=None, min_length=1, max_length=50)
    credit_cost: int | None = Field(default=None, ge=0)
    sort_order: int | None = None
    avg_seconds: int | None = Field(default=None, ge=1)
    progress_message: str | None = None
    fit_tags: list | None = None
    example_keys: list | None = None
    input_fields: list[InputFieldSpec] | None = None


class AdminStyleResponse(BaseModel):
    id: int
    code: str
    name: str
    section: str
    status: str
    sort_order: int
    credit_cost: int
    output_count: int
    avg_seconds: int
    progress_message: str | None
    fit_tags: list
    example_keys: list
    input_fields: list
    created_at: datetime
    updated_at: datetime


def _style_response(style: Style) -> AdminStyleResponse:
    return AdminStyleResponse(
        id=style.id,
        code=style.code,
        name=style.name,
        section=style.section,
        status=style.status.value,
        sort_order=style.sort_order,
        credit_cost=style.credit_cost,
        output_count=style.output_count,
        avg_seconds=style.avg_seconds,
        progress_message=style.progress_message,
        fit_tags=style.fit_tags,
        example_keys=style.example_keys,
        input_fields=style.input_fields,
        created_at=style.created_at,
        updated_at=style.updated_at,
    )


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
    email_key = f"email:{body.email}"
    _peek_bucket(_admin_login_requests, email_key, _ADMIN_LOGIN_EMAIL_RATE_LIMIT)
    admin = await AdminUser.get_or_none(email=body.email)
    if admin is None:
        await asyncio.to_thread(verify_password, body.password, DUMMY_PASSWORD_HASH)
    if admin is None or not await asyncio.to_thread(
        verify_password, body.password, admin.password_hash
    ):
        _record_failure(_admin_login_requests, email_key)
        logger.warning("admin_login_failed ip=%s", _client_ip(request))
        raise _invalid_credentials()
    _admin_login_requests.pop(email_key, None)
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
async def admin_create_style(
    body: CreateStyleRequest, _: AdminUser = Depends(get_current_admin)
):
    try:
        style = await Style.create(
            **body.model_dump(exclude={"input_fields"}),
            status=StyleStatus.DRAFT,
            input_fields=[field.model_dump() for field in body.input_fields],
        )
    except IntegrityError:
        raise validation_error("code가 이미 존재합니다", {"field": "code"}) from None
    return _style_response(style)


@router.patch("/styles/{style_id}")
async def admin_update_style(
    style_id: int,
    body: UpdateStyleRequest,
    _: AdminUser = Depends(get_current_admin),
):
    style = await Style.get_or_none(id=style_id)
    if style is None:
        raise not_found("스타일을 찾을 수 없습니다")

    updates = body.model_dump(exclude_unset=True, exclude={"input_fields"})
    if body.input_fields is not None:
        updates["input_fields"] = [field.model_dump() for field in body.input_fields]
    for field, value in updates.items():
        setattr(style, field, value)
    if updates:
        await style.save(update_fields=list(updates))
    return _style_response(style)


@router.delete("/styles/{style_id}")
async def admin_retire_style(
    style_id: int, _: AdminUser = Depends(get_current_admin)
):
    style = await Style.get_or_none(id=style_id)
    if style is None:
        raise not_found("스타일을 찾을 수 없습니다")
    style.status = StyleStatus.RETIRED
    await style.save(update_fields=["status"])
    return _style_response(style)


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
