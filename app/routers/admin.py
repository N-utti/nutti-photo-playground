import asyncio
import json
import logging
import uuid
from collections import deque
from datetime import datetime

from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from tortoise.exceptions import IntegrityError
from tortoise.functions import Count
from tortoise.transactions import in_transaction

from app.auth import DUMMY_PASSWORD_HASH, create_admin_token, get_current_admin, verify_password
from app.common import api_error, not_found, validation_error
from app.credits import grant_credits
from app.models import (
    AdminUser,
    AppSetting,
    Cafe24OauthToken,
    CreditLedger,
    CreditReason,
    CustomPromptLog,
    GenerationJob,
    InstagramDmCode,
    Member,
    MetricEvent,
    PromptVersionStatus,
    Style,
    StylePromptVersion,
    StyleStatus,
)
from app.routers.auth import (
    _check_bucket,
    _client_ip,
    _invalid_credentials,
    _peek_bucket,
    _record_failure,
)
from app.routers.credits import _AMOUNT_DEFAULTS
from app.routers.uploads import _POLICY_DEFAULTS

router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger(__name__)

_ADMIN_UI_PATH = Path(__file__).resolve().parent.parent / "static" / "admin.html"


@router.get("/ui", include_in_schema=False)
async def admin_ui() -> FileResponse:
    """운영 콘솔(스탑갭) — W-11 정식 화면(web/ SPA) 배선 전까지 쓰는 단일 파일.

    페이지 자체는 정적 HTML이라 비인증 서빙이고, 데이터는 전부 /v1/admin/* API가
    관리자 JWT로 지킨다. 같은 오리진이므로 CORS 설정 불필요.
    """
    return FileResponse(_ADMIN_UI_PATH, media_type="text/html")


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

    prompt_text: str = Field(min_length=1)
    prompt_model_config: dict = Field(default_factory=dict, alias="model_config")
    traffic_weight: int = Field(100, ge=0)


class UpdatePromptVersionRequest(BaseModel):
    status: PromptVersionStatus | None = None
    traffic_weight: int | None = Field(default=None, ge=0)


def _prompt_version_response(version: StylePromptVersion) -> dict:
    return {
        "id": version.id,
        "style_id": version.style_id,
        "version": version.version,
        "prompt_text": version.prompt_text,
        "model_config": version.model_config,
        "traffic_weight": version.traffic_weight,
        "status": version.status.value,
        "created_at": version.created_at,
    }


class PromoteCustomPromptRequest(BaseModel):
    section: str = Field(min_length=1, max_length=50)
    credit_cost: int = Field(1, ge=0)


class AdjustCreditsRequest(BaseModel):
    member_id: uuid.UUID
    amount: int = Field(ge=-100_000, le=100_000)  # int32 안쪽 + 오타 방지
    dedupe_key: str = Field(min_length=1, max_length=255)
    reason: CreditReason = CreditReason.CS_ADJUSTMENT


class UpdateSettingRequest(BaseModel):
    value: StrictInt | str


_HUMAN_FACE_POLICIES = ("block", "warn", "allow")
# ponytail: 기본값 출처는 각 라우터 상수 — 단일 설정 모듈로 합치는 건 키가 더 늘 때
_SETTING_DEFAULTS = {
    **_AMOUNT_DEFAULTS,
    **_POLICY_DEFAULTS,
    "custom_prompt_credit_cost": 2,
    "catalog_search_threshold": 100,
}


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
async def admin_list_prompt_versions(
    style_id: int, _: AdminUser = Depends(get_current_admin)
):
    if not await Style.exists(id=style_id):
        raise not_found("스타일을 찾을 수 없습니다")
    versions = await StylePromptVersion.filter(style_id=style_id).order_by("-version")
    return {"items": [_prompt_version_response(version) for version in versions]}


@router.post("/styles/{style_id}/prompt-versions", status_code=201)
async def admin_create_prompt_version(
    style_id: int,
    body: CreatePromptVersionRequest,
    _: AdminUser = Depends(get_current_admin),
):
    style = await Style.get_or_none(id=style_id)
    if style is None:
        raise not_found("스타일을 찾을 수 없습니다")
    latest = await StylePromptVersion.filter(style_id=style_id).order_by("-version").first()
    # ponytail: 관리자 1인 운영을 가정해 동시 생성 충돌은 재시도하지 않는다.
    try:
        version = await StylePromptVersion.create(
            style=style,
            version=(latest.version if latest else 0) + 1,
            prompt_text=body.prompt_text,
            model_config=body.prompt_model_config,
            traffic_weight=body.traffic_weight,
            status=PromptVersionStatus.DRAFT,
        )
    except IntegrityError:
        raise validation_error("프롬프트 버전이 이미 존재합니다") from None
    return _prompt_version_response(version)


@router.patch("/styles/{style_id}/prompt-versions/{version_id}")
async def admin_update_prompt_version(
    style_id: int,
    version_id: int,
    body: UpdatePromptVersionRequest,
    _: AdminUser = Depends(get_current_admin),
):
    version = await StylePromptVersion.get_or_none(id=version_id, style_id=style_id)
    if version is None:
        raise not_found("프롬프트 버전을 찾을 수 없습니다")
    updates = body.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(version, field, value)
    if updates:
        await version.save(update_fields=list(updates))
    return _prompt_version_response(version)


@router.get("/custom-prompts/top")
async def admin_top_custom_prompts(
    limit: int = Query(20, ge=1, le=100),
    _: AdminUser = Depends(get_current_admin),
):
    # ponytail: 로그 테이블 전체를 집계 스캔하며, 데이터량이 커지면 별도 집계 배치로 대체한다.
    groups = (
        await CustomPromptLog.exclude(normalized_text="")
        .annotate(frequency=Count("id"))
        .group_by("normalized_text")
        .order_by("-frequency", "normalized_text")
        .limit(limit)
        .values("normalized_text", "frequency")
    )
    texts = [group["normalized_text"] for group in groups]
    logs = (
        await CustomPromptLog.filter(normalized_text__in=texts)
        .order_by("created_at", "id")
        .values("id", "normalized_text", "promoted_style_id")
    )
    details = {}
    for log in logs:
        detail = details.setdefault(
            log["normalized_text"],
            {"id": str(log["id"]), "promotable": True},
        )
        if log["promoted_style_id"] is not None:
            detail["promotable"] = False
    return {
        "items": [
            {
                "id": details[group["normalized_text"]]["id"],
                **group,
                "promotable": details[group["normalized_text"]]["promotable"],
            }
            for group in groups
        ]
    }


@router.post("/custom-prompts/{prompt_id}/promote", status_code=201)
async def admin_promote_custom_prompt(
    prompt_id: str,
    body: PromoteCustomPromptRequest,
    _: AdminUser = Depends(get_current_admin),
):
    try:
        parsed_prompt_id = uuid.UUID(prompt_id)
    except ValueError:
        raise not_found("커스텀 프롬프트를 찾을 수 없습니다") from None
    log = await CustomPromptLog.get_or_none(id=parsed_prompt_id)
    if log is None:
        raise not_found("커스텀 프롬프트를 찾을 수 없습니다")
    if log.normalized_text == "":
        raise validation_error("승격할 수 없는 문구입니다", {"field": "prompt_id"})
    promoted = await CustomPromptLog.filter(
        normalized_text=log.normalized_text,
        promoted_style_id__isnull=False,
    ).first()
    if promoted is not None:
        raise api_error(
            409,
            "ALREADY_CLAIMED",
            "이미 승격된 문구입니다",
            {"style_id": promoted.promoted_style_id},
        )

    # ponytail: 관리자 1인 운영을 가정해 동시 승격 요청의 중복 Style 생성 레이스는 막지 않는다.
    async with in_transaction() as connection:
        style = await Style.create(
            # ponytail: 한글→슬러그 변환 불가하므로 uuid 접두 8자리 사용; 관리자가 PATCH /styles로 code 수정 가능
            code=f"custom-{log.id.hex[:8]}",
            name=log.normalized_text,
            section=body.section,
            credit_cost=body.credit_cost,
            status=StyleStatus.DRAFT,
            using_db=connection,
        )
        await CustomPromptLog.filter(normalized_text=log.normalized_text).using_db(
            connection
        ).update(promoted_style=style)
    return _style_response(style)


@router.get("/follow-ig/claims")
async def admin_follow_ig_claims(
    limit: int = Query(50, ge=1, le=200),
    cursor: int | None = Query(None, ge=1),
    _: AdminUser = Depends(get_current_admin),
):
    """인스타 팔로우 +2 수령 목록 — 인스타는 팔로우 조회 API가 없어 운영자가 실제 팔로워 목록과 대조하는 자리.
    허위면 `POST /credits/adjust`(음수)로 회수. cursor = 마지막 항목의 ledger id(내림차순).

    ref_id는 경로별로 다르다(#226): 아이디 입력 경로는 "ig:<username>", DM 코드 경로는 불변 감사 키인
    "ig:<igsid>". igsid 그대로는 팔로워 목록과 대조가 안 되므로 코드 발급 때 저장한 ig_username으로 풀어 준다."""
    query = CreditLedger.filter(reason=CreditReason.FOLLOW_IG.value, ref_id__startswith="ig:")
    if cursor is not None:
        query = query.filter(id__lt=cursor)
    rows = await query.order_by("-id").limit(limit + 1).values("id", "member_id", "ref_id", "amount", "created_at")
    page = rows[:limit]
    refs = {row["ref_id"].removeprefix("ig:") for row in page}
    # DM 행 판별은 값 충돌이 아니라 (소진 회원, igsid) 쌍으로 — 입력 경로 username은 사용자 주장값이라
    # igsid 형태(순수 숫자)를 넣어 dm 행으로 위장(대조 면제)하는 것을 막는다(보안 리뷰 #232).
    dm_usernames: dict[tuple, str | None] = {}
    if refs:
        dm_rows = await InstagramDmCode.filter(
            igsid__in=refs, redeemed_member_id__in=[row["member_id"] for row in page]
        ).order_by("id").values("igsid", "ig_username", "redeemed_member_id")
        for code in dm_rows:
            key = (code["redeemed_member_id"], code["igsid"])
            # 같은 igsid의 형제 행 중 username이 남은 행 우선(발급 시점 username null 가능)
            if dm_usernames.get(key) is None:
                dm_usernames[key] = code["ig_username"]
    items = []
    for row in page:
        ref = row["ref_id"].removeprefix("ig:")
        dm_key = (row["member_id"], ref)
        is_dm = dm_key in dm_usernames
        items.append(
            {
                "ledger_id": row["id"],
                "member_id": str(row["member_id"]),
                # DM 행에서 username이 못 남았으면(null) igsid 칸으로 추적한다
                "instagram_username": dm_usernames[dm_key] if is_dm else ref,
                "source": "dm" if is_dm else "input",
                "igsid": ref if is_dm else None,
                "amount": row["amount"],
                "claimed_at": row["created_at"],
            }
        )
    return {"items": items, "next_cursor": page[-1]["id"] if len(rows) > limit else None}


@router.post("/credits/adjust")
async def admin_adjust_credits(
    body: AdjustCreditsRequest, admin: AdminUser = Depends(get_current_admin)
):
    if body.amount == 0:
        raise validation_error("amount는 0이 될 수 없습니다", {"field": "amount"})
    member = await Member.get_or_none(
        id=body.member_id, withdrawn_at=None, merged_into_id__isnull=True
    )
    if member is None:
        raise not_found("회원을 찾을 수 없습니다")
    # ponytail: 잔액 사전검사는 락 밖 — 회원 charge_credits와의 동시 경합은 음수 잔액 기록으로만 남음, 관측되면 락 안으로
    if member.credit_balance + body.amount < 0:
        raise validation_error(
            "잔액이 음수가 될 수 없습니다",
            {"field": "amount", "balance": member.credit_balance},
        )
    granted = await grant_credits(
        body.member_id,
        body.amount,
        body.reason.value,
        body.dedupe_key,
        ref_id=f"admin:{admin.id}",
    )
    if not granted:
        raise api_error(
            409,
            "ALREADY_CLAIMED",
            "이미 처리된 dedupe_key입니다",
            {"dedupe_key": body.dedupe_key},
        )
    await member.refresh_from_db(fields=["credit_balance"])
    return {
        "member_id": str(member.id),
        "balance": member.credit_balance,
        "amount_granted": body.amount,
    }


@router.get("/cafe24/status")
async def admin_cafe24_status(_: AdminUser = Depends(get_current_admin)):
    # ponytail: 몰 1개 전제 — 다몰 지원 시 settings.cafe24_mall_id로 필터
    token = await Cafe24OauthToken.first()
    if token is None:
        raise not_found("카페24 토큰이 없습니다")
    return {
        "mall_id": token.mall_id,
        "expires_at": token.expires_at,
        "last_synced_at": token.last_synced_at,
        "last_refresh_error": token.last_refresh_error,
    }


@router.get("/settings")
async def admin_get_settings(_: AdminUser = Depends(get_current_admin)):
    rows = {row.key: row for row in await AppSetting.filter(key__in=list(_SETTING_DEFAULTS))}
    return {
        "items": [
            {
                "key": key,
                "value": rows[key].value if key in rows else _SETTING_DEFAULTS[key],
                "updated_at": rows[key].updated_at if key in rows else None,
            }
            for key in sorted(_SETTING_DEFAULTS)
        ]
    }


@router.patch("/settings/{key}")
async def admin_update_setting(
    key: str, body: UpdateSettingRequest, _: AdminUser = Depends(get_current_admin)
):
    if key not in _SETTING_DEFAULTS:
        raise not_found("존재하지 않는 설정 키입니다")
    value = body.value
    if key == "human_face_policy":
        if value not in _HUMAN_FACE_POLICIES:
            raise validation_error(
                "허용되지 않는 값입니다", {"field": "value", "allowed": list(_HUMAN_FACE_POLICIES)}
            )
    elif not isinstance(value, int) or value < 0:
        raise validation_error("0 이상의 정수여야 합니다", {"field": "value"})
    # ponytail: Tortoise JSONField는 str을 JSON 텍스트로 해석하고 Model.__init__이 그걸 도로 디코딩해
    # create()로는 문자열 값을 저장할 수 없다 — 인스턴스 생성 후 setattr→save()가 유일하게 통하는 경로.
    setting = await AppSetting.get_or_none(key=key) or AppSetting(key=key, value=0)
    setting.value = json.dumps(value) if isinstance(value, str) else value
    await setting.save()
    await setting.refresh_from_db(fields=["value", "updated_at"])
    return {"key": setting.key, "value": setting.value, "updated_at": setting.updated_at}
