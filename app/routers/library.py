import uuid
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from tortoise.expressions import Q

from app.auth import get_current_member
from app.common import not_implemented
from app.models import GenerationResult, JobStatus, Member, MemberKind
from app.storage import public_url

router = APIRouter(tags=["library"])

_KST = ZoneInfo("Asia/Seoul")


class DeleteLibraryRequest(BaseModel):
    ids: list[str]


def _validation_error() -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={
            "code": "VALIDATION_ERROR",
            "message": "요청 형식이 올바르지 않습니다",
            "detail": {},
        },
    )


@router.get("/library")
async def list_library(
    pet_id: str | None = None,
    cursor: str | None = None,
    member: Member = Depends(get_current_member),
):
    if member.kind != MemberKind.MEMBER:
        raise HTTPException(
            status_code=403,
            detail={"code": "MEMBER_ONLY", "message": "로그인이 필요합니다", "detail": {}},
        )

    query = GenerationResult.filter(
        job__member_id=member.id,
        job__status=JobStatus.SUCCEEDED,
        deleted_at__isnull=True,
    )
    if pet_id is not None:
        try:
            parsed_pet_id = uuid.UUID(pet_id)
        except ValueError as exc:
            raise _validation_error() from exc
        query = query.filter(job__source_image__pet_profile_id=parsed_pet_id)

    if cursor is not None:
        try:
            cursor_id = uuid.UUID(cursor)
        except ValueError as exc:
            raise _validation_error() from exc
        cursor_result = await GenerationResult.get_or_none(
            id=cursor_id, job__member_id=member.id
        )
        if cursor_result is None:
            raise _validation_error()
        query = query.filter(
            Q(created_at__lt=cursor_result.created_at)
            | Q(created_at=cursor_result.created_at, id__lt=cursor_result.id)
        )

    results = await (
        query.order_by("-created_at", "-id")
        .limit(21)
        .prefetch_related("job__source_image")
    )
    page = results[:20]
    months = []
    for result in page:
        created_at = result.created_at.astimezone(_KST)
        key = (created_at.year, created_at.month)
        if not months or months[-1]["key"] != key:
            months.append(
                {"key": key, "label": f"{key[0]}년 {key[1]}월", "items": []}
            )
        months[-1]["items"].append(
            {
                "job_id": str(result.job_id),
                "result_id": str(result.id),
                "image_url": public_url(result.storage_key),
                "pet_id": (
                    str(result.job.source_image.pet_profile_id)
                    if result.job.source_image.pet_profile_id
                    else None
                ),
                "created_at": created_at,
            }
        )

    return {
        "months": [{"label": month["label"], "items": month["items"]} for month in months],
        "next_cursor": str(page[-1].id) if len(results) > 20 else None,
    }


@router.delete("/library", status_code=204)
async def delete_library_items(body: DeleteLibraryRequest):
    not_implemented()
