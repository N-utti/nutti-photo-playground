import os
import uuid
from functools import partial

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.main import app
from app.models import GenerationJob, PetProfile, SourceImage
from app.routers import auth as auth_router


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


def _guest(client: TestClient) -> tuple[str, dict]:
    response = client.post("/v1/auth/guest")
    assert response.status_code == 201
    body = response.json()
    return body["member_id"], {"Authorization": f"Bearer {body['token']}"}


async def _pet(member_id: str, **kwargs) -> PetProfile:
    return await PetProfile.create(member_id=member_id, name="콩이", **kwargs)


async def _job_with_estimate(member_id: str, estimate: dict | None) -> GenerationJob:
    source = await SourceImage.create(
        member_id=member_id,
        storage_key=f"uploads/{uuid.uuid4()}.jpg",
        quality_check={},
        breed_estimate=estimate,
    )
    return await GenerationJob.create(
        member_id=member_id,
        source_image=source,
        idempotency_key=uuid.uuid4(),
        credit_cost=1,
    )


def test_matched_breed_builds_prefill_url(client: TestClient):
    member_id, headers = _guest(client)
    pet = client.portal.call(partial(_pet, member_id, breed_label="말티즈"))

    response = client.get(
        "/v1/calculator-link", params={"pet_id": str(pet.id)}, headers=headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["breed_code"] == body["breed_label"] == "말티즈"
    assert body["size_label"] == "소형"
    url = body["calculator_url"]
    assert url.startswith("https://nutti.co.kr/calculator.html?")
    assert "utm_campaign=calculator_handoff" in url


def test_unknown_breed_falls_back_to_mix(client: TestClient):
    member_id, headers = _guest(client)
    pet = client.portal.call(partial(_pet, member_id, breed_label="시고르자브종"))

    body = client.get(
        "/v1/calculator-link", params={"pet_id": str(pet.id)}, headers=headers
    ).json()

    # FR-EDGE-11: 계산기 목록에 없으면 믹스견
    assert body["breed_code"] == "믹스견"
    assert body["size_label"] == "중형"


def test_no_breed_info_omits_breed_param(client: TestClient):
    member_id, headers = _guest(client)
    pet = client.portal.call(_pet, member_id)

    body = client.get(
        "/v1/calculator-link", params={"pet_id": str(pet.id)}, headers=headers
    ).json()

    # FR-EDGE-10: 추정 실패 → breed 생략, 계산기 1단계부터
    assert body["breed_code"] is None
    assert "breed=" not in body["calculator_url"]
    assert "name=" in body["calculator_url"]


def test_job_path_uses_vision_estimate(client: TestClient):
    member_id, headers = _guest(client)
    job = client.portal.call(
        _job_with_estimate,
        member_id,
        {"code": None, "label": "진돗개", "confidence": 0.9},
    )

    body = client.get(
        "/v1/calculator-link", params={"job_id": str(job.id)}, headers=headers
    ).json()

    assert body["breed_code"] == "진돗개"
    assert body["size_label"] == "대형"


def test_ownership_and_param_validation(client: TestClient):
    member_id, _ = _guest(client)
    job = client.portal.call(_job_with_estimate, member_id, None)
    _, other_headers = _guest(client)

    stolen = client.get(
        "/v1/calculator-link", params={"job_id": str(job.id)}, headers=other_headers
    )
    missing = client.get("/v1/calculator-link", headers=other_headers)

    assert stolen.status_code == 404
    assert missing.status_code == 400
    assert missing.json()["error"]["code"] == "VALIDATION_ERROR"
