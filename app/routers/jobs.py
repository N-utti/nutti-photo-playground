import random
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from tortoise.transactions import in_transaction

from app.auth import get_current_member
from app.credits import charge_credits
from app.models import (
    AppSetting,
    CustomPromptLog,
    GenerationJob,
    GenerationResult,
    JobStatus,
    Member,
    SourceImage,
    Style,
    StylePromptVersion,
)
from app.storage import public_url

router = APIRouter(prefix="/jobs", tags=["jobs"])

# ponytail: v1 하드코딩 키워드, 운영 데이터로 확장 예정.
_CUSTOM_PROMPT_BLOCKLIST = (
    "품종",
    "털색",
    "색깔",
    "색으로",
    "종으로",
    "푸들로",
    "말티즈로",
    "치와와로",
    "골든리트리버로",
    "리트리버로",
    "포메라니안으로",
    "흰둥이로",
    "검은둥이로",
    "갈색으로",
    "하얀색으로",
    "검은색으로",
)


class CreateJobRequest(BaseModel):
    style_id: int | None = None
    upload_id: str
    pet_id: str | None = None
    custom_prompt: str | None = None


class CreateJobResponse(BaseModel):
    job_id: str
    status: str


class JobResultResponse(BaseModel):
    index: int
    image_url: str


class JobResponse(BaseModel):
    job_id: str
    status: str
    style_id: int | None
    upload_id: str
    progress: int | None
    eta_seconds: int | None
    status_message: str | None
    source_image_url: str
    results: list[JobResultResponse] | None
    error_code: str | None
    queued_at: datetime
    started_at: datetime | None


class ShareRequest(BaseModel):
    channel: str


def _validation_error(detail: dict | None = None) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={
            "code": "VALIDATION_ERROR",
            "message": "요청 형식이 올바르지 않습니다",
            "detail": detail or {},
        },
    )


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "NOT_FOUND", "message": "Job, upload, or style not found", "detail": {}},
    )


@router.post("", status_code=202, response_model=CreateJobResponse)
async def create_job(
    body: CreateJobRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    member: Member = Depends(get_current_member),
):
    try:
        key = uuid.UUID(idempotency_key)
    except ValueError as exc:
        raise _validation_error() from exc

    existing = await GenerationJob.filter(
        member_id=member.id, idempotency_key=key
    ).first()
    if existing is not None:
        return {"job_id": str(existing.id), "status": existing.status.value}

    try:
        upload_id = uuid.UUID(body.upload_id)
    except ValueError as exc:
        raise _not_found() from exc
    source = await SourceImage.filter(id=upload_id, member_id=member.id).first()
    if source is None:
        raise _not_found()

    # ponytail: pet_id는 source_image.pet_profile_id로 연결되어 있어 현재 저장하지 않는다.
    _ = body.pet_id
    log_values = None
    if body.style_id is not None:
        style = await Style.filter(id=body.style_id, status__in=["public", "ab"]).first()
        if style is None:
            raise _not_found()
        cost = style.credit_cost
        versions = await StylePromptVersion.filter(style_id=style.id, status="active").all()
        weights = [version.traffic_weight for version in versions]
        prompt_version = (
            random.choices(versions, weights=weights)[0]
            if versions and sum(weights) > 0
            else random.choice(versions)
            if versions
            else None
        )
        # ponytail: 워커가 실제 생성 시점에 재검증한다(그 사이 버전이 retired될 수 있음).
    else:
        if body.custom_prompt is None:
            raise _validation_error()
        style = prompt_version = None
        setting = await AppSetting.get_or_none(key="custom_prompt_credit_cost")
        cost = int(setting.value) if setting is not None else 2
        # ponytail: 과한 정규화 없이 원문의 앞뒤 공백 제거와 소문자화만 한다.
        normalized_text = body.custom_prompt.strip().lower()
        log_values = {
            "member_id": member.id,
            "raw_text": body.custom_prompt,
            "normalized_text": normalized_text,
        }
        if any(keyword in normalized_text for keyword in _CUSTOM_PROMPT_BLOCKLIST):
            await CustomPromptLog.create(
                **log_values,
                moderation={"input_filter_blocked": True, "reason": "breed_color_change"},
                job=None,
            )
            raise _validation_error({"reason": "input_filter_blocked"})

    async with in_transaction() as connection:
        log = (
            await CustomPromptLog.create(
                **log_values, moderation={}, job=None, using_db=connection
            )
            if log_values is not None
            else None
        )
        job = await GenerationJob.create(
            member_id=member.id,
            source_image_id=source.id,
            style_id=style.id if style is not None else None,
            prompt_version_id=prompt_version.id if prompt_version is not None else None,
            custom_prompt_id=log.id if log is not None else None,
            idempotency_key=key,
            credit_cost=cost,
            using_db=connection,
        )
        if log is not None:
            # ponytail: job.custom_prompt_id는 UUID 컬럼, log.job은 실제 FK라 양방향 저장 방식이 다르다.
            log.job_id = job.id
            await log.save(using_db=connection, update_fields=["job_id"])
        charged, balance = await charge_credits(
            member.id,
            cost,
            "generation_charge",
            f"job:{job.id}",
            ref_id=str(job.id),
            connection=connection,
        )
        if not charged:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "INSUFFICIENT_CREDIT",
                    "message": "크레딧이 부족합니다",
                    "detail": {"required": cost, "balance": balance},
                },
            )
    return {"job_id": str(job.id), "status": "queued"}


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: str, member: Member = Depends(get_current_member)):
    try:
        parsed_job_id = uuid.UUID(job_id)
    except ValueError as exc:
        raise _not_found() from exc
    job = await GenerationJob.get_or_none(id=parsed_job_id, member_id=member.id)
    if job is None:
        raise _not_found()
    await job.fetch_related("source_image", "style")

    progress = eta_seconds = status_message = results = error_code = None
    if job.status == JobStatus.QUEUED:
        progress = 0
        eta_seconds = job.style.avg_seconds if job.style is not None else 24
    elif job.status == JobStatus.PROCESSING:
        avg = job.style.avg_seconds if job.style is not None else 24
        elapsed = (
            max(0, (datetime.now(timezone.utc) - job.started_at).total_seconds())
            if job.started_at is not None
            else 0
        )
        # ponytail: processing progress는 경과/avg 단순 비례식 — 큐 길이 기반 정교화는 워커 붙일 때.
        progress = min(95, max(0, int(elapsed / avg * 100)))
        eta_seconds = max(0, avg - int(elapsed))
        status_message = job.style.progress_message if job.style is not None else None
    elif job.status == JobStatus.SUCCEEDED:
        progress = 100
        eta_seconds = 0
        rows = await GenerationResult.filter(job_id=job.id).order_by("seq")
        results = [
            {"index": result.seq - 1, "image_url": public_url(result.storage_key)}
            for result in rows
        ]
    else:
        error_code = job.error_code

    return {
        "job_id": str(job.id),
        "status": job.status.value,
        "style_id": job.style_id,
        "upload_id": str(job.source_image.id),
        "progress": progress,
        "eta_seconds": eta_seconds,
        "status_message": status_message,
        "source_image_url": public_url(job.source_image.storage_key),
        "results": results,
        "error_code": error_code,
        "queued_at": job.queued_at,
        "started_at": job.started_at,
    }


@router.post("/{job_id}/share")
async def share_result(
    job_id: str,
    body: ShareRequest,
    member: Member = Depends(get_current_member),
):
    try:
        parsed_job_id = uuid.UUID(job_id)
    except ValueError as exc:
        raise _not_found() from exc
    job = await GenerationJob.get_or_none(id=parsed_job_id, member_id=member.id)
    if job is None:
        raise _not_found()
    result = await GenerationResult.filter(job_id=job.id).order_by("seq").first()
    if result is None:
        raise _not_found()
    return {"share_image_url": public_url(result.storage_key)}
