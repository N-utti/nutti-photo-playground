import uuid
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_member
from app.breeds import BREED_SIZES, MIX_BREED
from app.common import not_found, validation_error
from app.models import GenerationJob, Member, PetProfile, SourceImage

router = APIRouter(tags=["results"])

# ponytail: 계산기 URL은 쇼핑몰 고정 자산 — 도메인 이전 시 여기만 바꾼다.
_CALCULATOR_BASE = "https://nutti.co.kr/calculator.html"
_UTM = {
    "utm_source": "nutti_playground",
    "utm_medium": "referral",
    "utm_campaign": "calculator_handoff",
}


def _not_found() -> HTTPException:
    return not_found("Pet or job not found")


async def _resolve_pet_and_estimate(
    member_id, pet_id: str | None, job_id: str | None
) -> tuple[PetProfile | None, dict | None]:
    if job_id is not None:
        try:
            job_uuid = uuid.UUID(job_id)
        except ValueError as exc:
            raise _not_found() from exc
        job = await GenerationJob.filter(id=job_uuid, member_id=member_id).first()
        if job is None:
            raise _not_found()
        source = await SourceImage.get(id=job.source_image_id)
        pet = (
            await PetProfile.get_or_none(id=source.pet_profile_id)
            if source.pet_profile_id
            else None
        )
        return pet, source.breed_estimate
    try:
        pet_uuid = uuid.UUID(pet_id)
    except (TypeError, ValueError) as exc:
        raise _not_found() from exc
    pet = await PetProfile.filter(id=pet_uuid, member_id=member_id).first()
    if pet is None:
        raise _not_found()
    latest = (
        await SourceImage.filter(pet_profile_id=pet.id)
        .order_by("-created_at")
        .first()
    )
    return pet, latest.breed_estimate if latest else None


@router.get("/calculator-link")
async def get_calculator_link(
    pet_id: str | None = None,
    job_id: str | None = None,
    member: Member = Depends(get_current_member),
):
    if pet_id is None and job_id is None:
        raise validation_error("pet_id 또는 job_id가 필요합니다")
    pet, estimate = await _resolve_pet_and_estimate(member.id, pet_id, job_id)

    # 견종 후보: 펫 프로필 기입값 → 비전 추정 라벨 (FR-EDGE-10: 없으면 breed 생략)
    candidate = None
    if pet is not None:
        candidate = pet.breed_label or pet.breed_code
    if not candidate and isinstance(estimate, dict):
        candidate = estimate.get("label")

    if not candidate:
        breed_code = breed_label = size_label = None
    elif candidate in BREED_SIZES:
        breed_code = breed_label = candidate
        size_label = BREED_SIZES[candidate]
    else:
        # FR-EDGE-11: 계산기 40종 목록에 없으면 믹스견 폴백
        breed_code = breed_label = MIX_BREED
        size_label = BREED_SIZES[MIX_BREED]

    params: dict[str, str] = {}
    if pet is not None and pet.name:
        params["name"] = pet.name
    if breed_code is not None:
        params["breed"] = breed_code
        params["size"] = size_label
    params.update(_UTM)

    return {
        "breed_code": breed_code,
        "breed_label": breed_label,
        "size_label": size_label,
        "calculator_url": f"{_CALCULATOR_BASE}?{urlencode(params)}",
    }
