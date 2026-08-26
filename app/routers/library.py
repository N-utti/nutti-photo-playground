import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from tortoise.expressions import Q

from app.auth import get_current_member
from app.common import KST, member_only, validation_error
from app.models import GenerationResult, JobStatus, Member, MemberKind
from app.storage import public_url

router = APIRouter(tags=["library"])

class DeleteLibraryRequest(BaseModel):
    # uuid 파싱·개수 상한은 pydantic이 → 400 VALIDATION_ERROR(main.py 핸들러)
    ids: list[uuid.UUID] = Field(max_length=100)


class LibraryItemResponse(BaseModel):
    job_id: str
    result_id: str
    image_url: str
    pet_id: str | None
    created_at: datetime


class LibraryMonthResponse(BaseModel):
    label: str
    items: list[LibraryItemResponse]


class LibraryResponse(BaseModel):
    months: list[LibraryMonthResponse]
    next_cursor: str | None


@router.get("/library", response_model=LibraryResponse)
async def list_library(
    pet_id: str | None = None,
    cursor: str | None = None,
    member: Member = Depends(get_current_member),
):
    if member.kind != MemberKind.MEMBER:
        raise member_only()

    # 커서 검증도 같은 스코프(소유·pet)로 — 다른 pet의 result를 커서로 주면 400.
    # deleted_at·status는 스코프에서 뺀다: 1페이지 마지막 항목을 지운 뒤 2페이지를
    # 요청해도 커서가 계속 유효해야 하므로.
    scope: dict = {"job__member_id": member.id}
    if pet_id is not None:
        try:
            scope["job__source_image__pet_profile_id"] = uuid.UUID(pet_id)
        except ValueError as exc:
            raise validation_error() from exc

    query = GenerationResult.filter(
        job__status=JobStatus.SUCCEEDED, deleted_at__isnull=True, **scope
    )

    if cursor is not None:
        try:
            cursor_id = uuid.UUID(cursor)
        except ValueError as exc:
            raise validation_error() from exc
        cursor_result = await GenerationResult.get_or_none(id=cursor_id, **scope)
        if cursor_result is None:
            raise validation_error()
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
        created_at = result.created_at.astimezone(KST)
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
async def delete_library_items(
    body: DeleteLibraryRequest, member: Member = Depends(get_current_member)
):
    if member.kind != MemberKind.MEMBER:
        raise member_only()
    if body.ids:
        owned_ids = await GenerationResult.filter(
            id__in=body.ids,
            job__member_id=member.id,
            deleted_at__isnull=True,
        ).values_list("id", flat=True)
        if owned_ids:
            await GenerationResult.filter(id__in=owned_ids).update(
                deleted_at=datetime.now(timezone.utc)
            )
    return None
