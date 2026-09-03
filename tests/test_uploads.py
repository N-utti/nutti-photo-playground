import io
import json
import os

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from tortoise import Tortoise

from app import storage
from app.main import app
from app.models import AppSetting, Member, PetProfile, SourceImage
from app.routers import auth as auth_router
from app.routers import uploads as uploads_router
from app.settings import settings


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, tmp_path):
    for buckets in (
        auth_router._guest_requests,
        auth_router._login_requests,
        auth_router._register_requests,
    ):
        buckets.clear()
    monkeypatch.setattr(settings, "r2_endpoint_url", "")
    monkeypatch.setattr(settings, "cdn_base_url", "")
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(storage, "MEDIA_ROOT", str(tmp_path))
    with TestClient(app) as test_client:
        test_client.portal.call(Tortoise.generate_schemas)
        yield test_client


def _guest(client: TestClient) -> dict:
    response = client.post("/v1/auth/guest")
    assert response.status_code == 201
    return response.json()


def _headers(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['token']}"}


def _image_bytes(color: tuple[int, int, int] | None = None) -> bytes:
    if color is None:
        image = Image.new("RGB", (64, 64))
        image.putdata(
            [
                (240, 240, 240) if (x // 4 + y // 4) % 2 else (80, 80, 80)
                for y in range(64)
                for x in range(64)
            ]
        )
    else:
        image = Image.new("RGB", (64, 64), color)
    output = io.BytesIO()
    image.save(output, format="JPEG")
    return output.getvalue()


def _files(data: bytes | None = None, content_type: str = "image/jpeg") -> dict:
    return {"file": ("dog.jpg", data or _image_bytes(), content_type)}


def _vision(**overrides) -> uploads_router._VisionResult:
    values = {
        "is_dog": True,
        "is_cat": False,
        "multi_subject": False,
        "human_face": False,
    }
    values.update(overrides)
    return uploads_router._VisionResult(**values)


def _mock_vision(monkeypatch: pytest.MonkeyPatch, result: uploads_router._VisionResult):
    async def analyze(_jpeg_bytes: bytes):
        return result

    monkeypatch.setattr(uploads_router, "_analyze_vision", analyze)


async def _source_count() -> int:
    return await SourceImage.all().count()


async def _source(upload_id: str) -> SourceImage:
    return await SourceImage.get(id=upload_id)


async def _create_pet(member_id: str) -> PetProfile:
    return await PetProfile.create(member_id=member_id, name="콩이")


async def _set_policy(policy: str, key: str = "human_face_policy") -> None:
    await AppSetting.create(key=key, value={"seed": True})
    await Tortoise.get_connection("default").execute_query(
        "UPDATE app_setting SET value = ? WHERE key = ?",
        [json.dumps(policy), key],
    )


async def _expiry_values(upload_id: str, member_id: str):
    source = await SourceImage.get(id=upload_id)
    member = await Member.get(id=member_id)
    return source.expires_at, member.guest_expires_at


def test_normal_upload_saves_image(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path
):
    _mock_vision(monkeypatch, _vision())
    session = _guest(client)

    response = client.post("/v1/uploads", headers=_headers(session), files=_files())

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "upload_id": body["upload_id"],
        "image_url": body["image_url"],
        "blocking_issue": None,
        "warnings": [],
    }
    source = client.portal.call(_source, body["upload_id"])
    assert source.width == source.height == 64
    assert source.quality_check == {
        "blur": False,
        "dark": False,
        "multi_subject": False,
        "no_dog": False,
        "cat": False,
        "human_face": False,
        "vision_checked": True,
    }
    assert (tmp_path / body["image_url"].removeprefix("/media/")).is_file()


def test_dark_image_returns_quality_warning(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    _mock_vision(monkeypatch, _vision())
    session = _guest(client)

    response = client.post(
        "/v1/uploads",
        headers=_headers(session),
        files=_files(_image_bytes((10, 10, 10))),
    )

    warning = next(item for item in response.json()["warnings"] if item["code"] == "QUALITY_WARNING")
    assert response.status_code == 200
    assert "dark" in warning["detail"]["issues"]


def test_cat_blocks_without_saving(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    _mock_vision(monkeypatch, _vision(is_dog=False, is_cat=True))
    session = _guest(client)

    response = client.post("/v1/uploads", headers=_headers(session), files=_files())

    assert response.status_code == 200
    assert response.json() == {
        "upload_id": None,
        "image_url": None,
        "blocking_issue": {
            "code": "CAT_DETECTED",
            "message": "누띠는 강아지 전용이에요. 다른 사진을 골라주세요.",
        },
        "warnings": [],
    }
    assert client.portal.call(_source_count) == 0


@pytest.mark.parametrize("policy", ["block", "warn", "allow"])
def test_human_face_policy_branches(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    policy: str,
):
    _mock_vision(monkeypatch, _vision(human_face=True))
    client.portal.call(_set_policy, policy)
    session = _guest(client)

    response = client.post("/v1/uploads", headers=_headers(session), files=_files())

    assert response.status_code == 200
    body = response.json()
    warning_codes = [warning["code"] for warning in body["warnings"]]
    if policy == "block":
        assert body["upload_id"] is None
        assert body["blocking_issue"]["code"] == "HUMAN_FACE_DETECTED"
        assert client.portal.call(_source_count) == 0
    elif policy == "warn":
        assert body["upload_id"] is not None
        assert body["blocking_issue"] is None
        assert "HUMAN_FACE_DETECTED" in warning_codes
    else:
        assert body["upload_id"] is not None
        assert body["blocking_issue"] is None
        assert "HUMAN_FACE_DETECTED" not in warning_codes


def test_no_dog_blocks_by_default(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    _mock_vision(monkeypatch, _vision(is_dog=False))
    session = _guest(client)

    response = client.post("/v1/uploads", headers=_headers(session), files=_files())

    assert response.status_code == 200
    body = response.json()
    assert body["upload_id"] is None
    assert body["blocking_issue"]["code"] == "NOT_A_DOG"
    assert client.portal.call(_source_count) == 0


@pytest.mark.parametrize("policy", ["warn", "allow"])
def test_no_dog_policy_warn_and_allow_let_upload_through(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, policy: str
):
    _mock_vision(monkeypatch, _vision(is_dog=False))
    client.portal.call(_set_policy, policy, "no_dog_policy")
    session = _guest(client)

    response = client.post("/v1/uploads", headers=_headers(session), files=_files())

    body = response.json()
    assert body["upload_id"] is not None
    assert body["blocking_issue"] is None
    codes = {warning["code"] for warning in body["warnings"]}
    assert ("NOT_A_DOG" in codes) == (policy == "warn")


def test_rejects_unsupported_type_oversized_file_and_decompression_bomb(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    session = _guest(client)

    unsupported = client.post(
        "/v1/uploads",
        headers=_headers(session),
        files=_files(b"not an image", "text/plain"),
    )
    oversized = client.post(
        "/v1/uploads",
        headers=_headers(session),
        files=_files(b"x" * (10 * 1024 * 1024 + 1)),
    )

    def decompression_bomb(_data: bytes):
        raise Image.DecompressionBombError

    monkeypatch.setattr(uploads_router, "_process_image", decompression_bomb)
    bomb = client.post("/v1/uploads", headers=_headers(session), files=_files())

    assert unsupported.status_code == oversized.status_code == bomb.status_code == 400
    assert unsupported.json()["error"]["code"] == "VALIDATION_ERROR"
    assert oversized.json()["error"]["code"] == "VALIDATION_ERROR"
    assert bomb.json()["error"]["code"] == "VALIDATION_ERROR"


def test_other_member_cannot_attach_pet(client: TestClient):
    owner = _guest(client)
    other = _guest(client)
    pet = client.portal.call(_create_pet, owner["member_id"])

    response = client.post(
        "/v1/uploads",
        headers=_headers(other),
        data={"pet_id": str(pet.id)},
        files=_files(),
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_missing_openai_key_skips_vision_without_not_a_dog_warning(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "openai_api_key", "")
    session = _guest(client)

    response = client.post("/v1/uploads", headers=_headers(session), files=_files())

    assert response.status_code == 200
    assert response.json()["upload_id"] is not None
    assert "NOT_A_DOG" not in {warning["code"] for warning in response.json()["warnings"]}
    source = client.portal.call(_source, response.json()["upload_id"])
    assert source.quality_check["vision_checked"] is False


def test_guest_expiry_is_copied_to_source_image(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    _mock_vision(monkeypatch, _vision())
    session = _guest(client)

    response = client.post("/v1/uploads", headers=_headers(session), files=_files())

    source_expiry, guest_expiry = client.portal.call(
        _expiry_values,
        response.json()["upload_id"],
        session["member_id"],
    )
    assert response.status_code == 200
    assert source_expiry == guest_expiry
