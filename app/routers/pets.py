from fastapi import APIRouter
from pydantic import BaseModel

from app.common import not_implemented

router = APIRouter(prefix="/pets", tags=["pets"])


class CreatePetRequest(BaseModel):
    name: str
    upload_id: str


class UpdatePetRequest(BaseModel):
    name: str


@router.get("")
async def list_pets():
    not_implemented()


@router.post("", status_code=201)
async def create_pet(body: CreatePetRequest):
    not_implemented()


@router.patch("/{pet_id}")
async def update_pet(pet_id: str, body: UpdatePetRequest):
    not_implemented()


@router.delete("/{pet_id}", status_code=204)
async def delete_pet(pet_id: str):
    not_implemented()
