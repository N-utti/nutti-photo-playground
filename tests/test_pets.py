import os
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.main import app
from app.models import PetProfile, SourceImage
from app.routers import auth as auth_router
from app.settings import settings


@pytest.fixture
def client():
    for buckets in (
        auth_router._guest_requests,
        auth_router._login_requests,
        auth_router._register_requests,
    ):
        buckets.clear()
    with TestClient(app) as test_client:
        test_client.portal.call(Tortoise.generate_schemas)
        yield test_client


def _guest(client: TestClient) -> dict:
    response = client.post("/v1/auth/guest")
    assert response.status_code == 201
    return response.json()


def _headers(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['token']}"}


async def _create_source(member_id: str, storage_key: str) -> SourceImage:
    return await SourceImage.create(
        member_id=member_id,
        storage_key=storage_key,
        quality_check={},
    )


async def _pet_and_source(pet_id: str, source_id: str):
    return await PetProfile.get_or_none(id=pet_id), await SourceImage.get(id=source_id)


async def _latest_upload_fixtures(member_id: str):
    now = datetime.now(timezone.utc)
    current_pet = await PetProfile.create(member_id=member_id, name="콩이")
    expired_pet = await PetProfile.create(member_id=member_id, name="두부")

    current_old = await SourceImage.create(
        member_id=member_id,
        pet_profile=current_pet,
        storage_key=f"uploads/{uuid.uuid4()}",
        quality_check={},
    )
    current_latest = await SourceImage.create(
        member_id=member_id,
        pet_profile=current_pet,
        storage_key=f"uploads/{uuid.uuid4()}",
        quality_check={},
        expires_at=now + timedelta(days=1),
    )
    expired_old = await SourceImage.create(
        member_id=member_id,
        pet_profile=expired_pet,
        storage_key=f"uploads/{uuid.uuid4()}",
        quality_check={},
    )
    expired_latest = await SourceImage.create(
        member_id=member_id,
        pet_profile=expired_pet,
        storage_key=f"uploads/{uuid.uuid4()}",
        quality_check={},
        expires_at=now - timedelta(days=1),
    )
    timestamps = {
        current_old.id: now - timedelta(days=4),
        current_latest.id: now - timedelta(days=3),
        expired_old.id: now - timedelta(days=2),
        expired_latest.id: now - timedelta(days=1),
    }
    for source_id, created_at in timestamps.items():
        await SourceImage.filter(id=source_id).update(created_at=created_at)
    return str(current_pet.id), str(current_latest.id), str(expired_pet.id)


def test_pet_crud_links_upload_and_returns_thumbnail(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "cdn_base_url", "https://cdn.nutti.test")
    session = _guest(client)
    source = client.portal.call(
        _create_source,
        session["member_id"],
        "uploads/source.jpg",
    )

    created = client.post(
        "/v1/pets",
        headers=_headers(session),
        json={"name": "콩이", "upload_id": str(source.id)},
    )

    assert created.status_code == 201
    assert created.json() == {
        "id": created.json()["id"],
        "name": "콩이",
        "thumbnail_url": "https://cdn.nutti.test/uploads/source.jpg",
        "breed": None,
    }
    pet, linked_source = client.portal.call(_pet_and_source, created.json()["id"], str(source.id))
    assert pet is not None
    assert linked_source.pet_profile_id == pet.id
    assert pet.thumbnail_key == "uploads/source.jpg"

    listed = client.get("/v1/pets", headers=_headers(session))
    assert listed.status_code == 200
    assert listed.json() == {
        "items": [
            {
                **created.json(),
                "latest_upload_id": str(source.id),
            }
        ]
    }

    updated = client.patch(
        f"/v1/pets/{pet.id}",
        headers=_headers(session),
        json={"name": "두부"},
    )
    assert updated.status_code == 200
    assert updated.json() == {**created.json(), "name": "두부"}

    deleted = client.delete(f"/v1/pets/{pet.id}", headers=_headers(session))
    assert deleted.status_code == 204
    assert deleted.content == b""
    deleted_pet, detached_source = client.portal.call(_pet_and_source, str(pet.id), str(source.id))
    assert deleted_pet is None
    assert detached_source.pet_profile_id is None


def test_other_member_cannot_use_upload_or_modify_pet(client: TestClient):
    owner = _guest(client)
    other = _guest(client)
    source = client.portal.call(
        _create_source,
        owner["member_id"],
        f"uploads/{uuid.uuid4()}",
    )

    foreign_upload = client.post(
        "/v1/pets",
        headers=_headers(other),
        json={"name": "가로채기", "upload_id": str(source.id)},
    )
    assert foreign_upload.status_code == 404
    assert foreign_upload.json()["error"]["code"] == "NOT_FOUND"

    created = client.post(
        "/v1/pets",
        headers=_headers(owner),
        json={"name": "콩이", "upload_id": str(source.id)},
    )
    pet_id = created.json()["id"]
    patched = client.patch(
        f"/v1/pets/{pet_id}",
        headers=_headers(other),
        json={"name": "가로채기"},
    )
    deleted = client.delete(f"/v1/pets/{pet_id}", headers=_headers(other))

    assert patched.status_code == deleted.status_code == 404
    assert patched.json()["error"]["code"] == "NOT_FOUND"
    assert deleted.json()["error"]["code"] == "NOT_FOUND"
    assert client.get("/v1/pets", headers=_headers(owner)).json()["items"][0]["name"] == "콩이"


def test_latest_upload_uses_newest_and_expired_newest_returns_null(client: TestClient):
    session = _guest(client)
    current_pet_id, current_upload_id, expired_pet_id = client.portal.call(
        _latest_upload_fixtures,
        session["member_id"],
    )

    response = client.get("/v1/pets", headers=_headers(session))

    assert response.status_code == 200
    items = {item["id"]: item for item in response.json()["items"]}
    assert items[current_pet_id]["latest_upload_id"] == current_upload_id
    assert items[expired_pet_id]["latest_upload_id"] is None
    assert items[current_pet_id]["thumbnail_url"] is None
    assert items[expired_pet_id]["thumbnail_url"] is None


@pytest.mark.parametrize(
    ("method", "path", "json"),
    [
        ("get", "/v1/pets", None),
        ("post", "/v1/pets", {"name": "콩이", "upload_id": str(uuid.uuid4())}),
        ("patch", f"/v1/pets/{uuid.uuid4()}", {"name": "콩이"}),
        ("delete", f"/v1/pets/{uuid.uuid4()}", None),
    ],
)
def test_all_pet_endpoints_require_authentication(
    client: TestClient,
    method: str,
    path: str,
    json: dict | None,
):
    response = client.request(method, path, json=json)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.parametrize("name", ["", "   ", "x" * 51])
@pytest.mark.parametrize("method", ["post", "patch"])
def test_pet_name_must_be_between_1_and_50_trimmed_characters(
    client: TestClient,
    method: str,
    name: str,
):
    session = _guest(client)
    response = client.request(
        method,
        "/v1/pets" if method == "post" else f"/v1/pets/{uuid.uuid4()}",
        headers=_headers(session),
        json={"name": name, "upload_id": str(uuid.uuid4())}
        if method == "post"
        else {"name": name},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    ("method", "path", "json"),
    [
        ("post", "/v1/pets", {"name": "Coco", "upload_id": "not-a-uuid"}),
        ("patch", "/v1/pets/not-a-uuid", {"name": "Coco"}),
        ("delete", "/v1/pets/not-a-uuid", None),
    ],
)
def test_pet_ids_must_be_uuids(
    client: TestClient,
    method: str,
    path: str,
    json: dict | None,
):
    session = _guest(client)
    response = client.request(method, path, headers=_headers(session), json=json)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
