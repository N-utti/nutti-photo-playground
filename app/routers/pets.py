import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from tortoise.transactions import in_transaction

from app.auth import get_current_member
from app.common import not_found
from app.models import Member, PetProfile, SourceImage
from app.storage import public_url

router = APIRouter(prefix="/pets", tags=["pets"])


class CreatePetRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=50)
    upload_id: uuid.UUID


class UpdatePetRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=50)


class PetResponse(BaseModel):
    id: str
    name: str
    thumbnail_url: str | None
    # W-04 에서 이 강아지로 만들 때 마지막으로 입력한 견종(POST /v1/jobs breed) — 다음 선택 시 미리 채운다.
    breed: str | None


class PetListItem(PetResponse):
    latest_upload_id: str | None


class PetListResponse(BaseModel):
    items: list[PetListItem]


def _not_found() -> HTTPException:
    return not_found("Pet or upload not found")


def _thumbnail_url(pet: PetProfile) -> str | None:
    return public_url(pet.thumbnail_key) if pet.thumbnail_key else None


def _pet_response(pet: PetProfile) -> dict:
    return {
        "id": str(pet.id),
        "name": pet.name,
        "thumbnail_url": _thumbnail_url(pet),
        "breed": pet.breed_label,
    }


@router.get("", response_model=PetListResponse)
async def list_pets(member: Member = Depends(get_current_member)):
    pets = await PetProfile.filter(member_id=member.id).order_by("created_at", "id")
    uploads = (
        await SourceImage.filter(pet_profile_id__in=[pet.id for pet in pets])
        .order_by("-created_at", "-id")
        .all()
        if pets
        else []
    )
    latest_by_pet = {}
    for upload in uploads:
        latest_by_pet.setdefault(upload.pet_profile_id, upload)

    now = datetime.now(timezone.utc)
    items = []
    for pet in pets:
        latest = latest_by_pet.get(pet.id)
        latest_upload_id = (
            str(latest.id)
            if latest is not None and (latest.expires_at is None or latest.expires_at >= now)
            else None
        )
        items.append({**_pet_response(pet), "latest_upload_id": latest_upload_id})
    return {"items": items}


@router.post("", status_code=201, response_model=PetResponse)
async def create_pet(body: CreatePetRequest, member: Member = Depends(get_current_member)):
    async with in_transaction() as connection:
        source = (
            await SourceImage.filter(id=body.upload_id, member_id=member.id)
            .using_db(connection)
            .first()
        )
        if source is None:
            raise _not_found()
        pet = await PetProfile.create(
            member_id=member.id,
            name=body.name,
            thumbnail_key=source.storage_key,
            using_db=connection,
        )
        source.pet_profile_id = pet.id
        await source.save(using_db=connection, update_fields=["pet_profile_id"])
    return _pet_response(pet)


@router.patch("/{pet_id}", response_model=PetResponse)
async def update_pet(
    pet_id: uuid.UUID,
    body: UpdatePetRequest,
    member: Member = Depends(get_current_member),
):
    pet = await PetProfile.get_or_none(id=pet_id, member_id=member.id)
    if pet is None:
        raise _not_found()
    pet.name = body.name
    await pet.save(update_fields=["name"])
    return _pet_response(pet)


@router.delete("/{pet_id}", status_code=204)
async def delete_pet(pet_id: uuid.UUID, member: Member = Depends(get_current_member)):
    pet = await PetProfile.get_or_none(id=pet_id, member_id=member.id)
    if pet is None:
        raise _not_found()
    await pet.delete()
    return Response(status_code=204)
