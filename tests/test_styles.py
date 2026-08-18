import os

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.main import app
from app.models import PromptVersionStatus, Style, StylePromptVersion, StyleStatus
from app.settings import settings


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "cdn_base_url", "https://cdn.example.com")
    with TestClient(app) as test_client:
        test_client.portal.call(Tortoise.generate_schemas)
        yield test_client


async def _create_styles():
    await Style.bulk_create(
        [
            Style(
                id=1,
                code="popular-second",
                section="popular",
                name="Popular second",
                status=StyleStatus.PUBLIC,
                sort_order=3,
                example_keys=["styles/popular-second.jpg"],
            ),
            Style(
                id=2,
                code="summer-first",
                section="summer",
                name="Summer first",
                status=StyleStatus.PUBLIC,
                sort_order=1,
                example_keys=[],
            ),
            Style(
                id=3,
                code="popular-first",
                section="popular",
                name="Popular first",
                status=StyleStatus.PUBLIC,
                sort_order=2,
                credit_cost=2,
                example_keys=["styles/popular-first.jpg", "styles/popular-first-2.jpg"],
                fit_tags=[{"label": "소형견", "score": "good"}],
                avg_seconds=18,
            ),
            Style(
                id=4,
                code="summer-second",
                section="summer",
                name="Summer second",
                status=StyleStatus.PUBLIC,
                sort_order=4,
            ),
            Style(
                id=5,
                code="draft",
                section="popular",
                name="Draft",
                status=StyleStatus.DRAFT,
                sort_order=0,
            ),
            Style(
                id=6,
                code="retired",
                section="summer",
                name="Retired",
                status=StyleStatus.RETIRED,
                sort_order=0,
            ),
            Style(
                id=7,
                code="ab",
                section="popular",
                name="AB",
                status=StyleStatus.AB,
                sort_order=0,
            ),
        ]
    )


async def _create_extra_styles():
    await Style.bulk_create(
        [
            Style(
                id=style_id,
                code=f"extra-{style_id}",
                section="extra",
                name=f"Extra {style_id}",
                status=StyleStatus.PUBLIC,
                sort_order=style_id - 3,
            )
            for style_id in range(8, 17)
        ]
    )


async def _create_prompt_versions():
    await StylePromptVersion.bulk_create(
        [
            StylePromptVersion(
                id=101,
                style_id=1,
                version=1,
                prompt_text="Paint [pet name] in a frame",
                model_config={},
                status=PromptVersionStatus.ACTIVE,
            ),
            StylePromptVersion(
                id=102,
                style_id=1,
                version=2,
                prompt_text="Second active prompt without placeholders",
                model_config={},
                status=PromptVersionStatus.ACTIVE,
            ),
            StylePromptVersion(
                id=103,
                style_id=1,
                version=3,
                prompt_text="Old [breed] prompt",
                model_config={},
                status=PromptVersionStatus.RETIRED,
            ),
            StylePromptVersion(
                id=104,
                style_id=2,
                version=1,
                prompt_text="Paint the [breed] in watercolor",
                model_config={},
                status=PromptVersionStatus.ACTIVE,
            ),
        ]
    )


def test_list_styles_groups_sorts_and_exposes_only_public(client: TestClient):
    client.portal.call(_create_styles)

    response = client.get("/v1/styles")

    assert response.status_code == 200
    assert response.json() == {
        "sections": [
            {
                "name": "summer",
                "count": 2,
                "styles": [
                    {
                        "id": 2,
                        "code": "summer-first",
                        "name": "Summer first",
                        "thumbnail_url": None,
                        "credit_cost": 1,
                        "uses_pet_name": False,
                        "uses_breed": False,
                    },
                    {
                        "id": 4,
                        "code": "summer-second",
                        "name": "Summer second",
                        "thumbnail_url": None,
                        "credit_cost": 1,
                        "uses_pet_name": False,
                        "uses_breed": False,
                    },
                ],
            },
            {
                "name": "popular",
                "count": 2,
                "styles": [
                    {
                        "id": 3,
                        "code": "popular-first",
                        "name": "Popular first",
                        "thumbnail_url": "https://cdn.example.com/styles/popular-first.jpg",
                        "credit_cost": 2,
                        "uses_pet_name": False,
                        "uses_breed": False,
                    },
                    {
                        "id": 1,
                        "code": "popular-second",
                        "name": "Popular second",
                        "thumbnail_url": "https://cdn.example.com/styles/popular-second.jpg",
                        "credit_cost": 1,
                        "uses_pet_name": False,
                        "uses_breed": False,
                    },
                ],
            },
        ],
        "total_count": 4,
    }


def test_list_styles_limit_is_per_section_and_preserves_counts(client: TestClient):
    client.portal.call(_create_styles)

    response = client.get("/v1/styles", params={"limit": 1})
    filtered = client.get("/v1/styles", params={"section": "summer", "limit": 1})

    assert response.status_code == filtered.status_code == 200
    assert [len(section["styles"]) for section in response.json()["sections"]] == [1, 1]
    assert [section["count"] for section in response.json()["sections"]] == [2, 2]
    assert response.json()["total_count"] == 4
    assert [section["name"] for section in filtered.json()["sections"]] == ["summer"]
    assert filtered.json()["sections"][0]["count"] == 2
    assert filtered.json()["total_count"] == 4


def test_list_styles_popular_uses_public_sort_order_and_limit(client: TestClient):
    client.portal.call(_create_styles)

    limited = client.get("/v1/styles", params={"section": "popular", "limit": 2})

    assert limited.status_code == 200
    assert limited.json()["sections"] == [
        {
            "name": "인기",
            "count": 2,
            "styles": [
                {
                    "id": 2,
                    "code": "summer-first",
                    "name": "Summer first",
                    "thumbnail_url": None,
                    "credit_cost": 1,
                    "uses_pet_name": False,
                    "uses_breed": False,
                },
                {
                    "id": 3,
                    "code": "popular-first",
                    "name": "Popular first",
                    "thumbnail_url": "https://cdn.example.com/styles/popular-first.jpg",
                    "credit_cost": 2,
                    "uses_pet_name": False,
                    "uses_breed": False,
                },
            ],
        }
    ]
    assert limited.json()["total_count"] == 4

    client.portal.call(_create_extra_styles)
    default_limit = client.get("/v1/styles", params={"section": "popular"})

    assert default_limit.status_code == 200
    assert default_limit.json()["sections"][0]["name"] == "인기"
    assert default_limit.json()["sections"][0]["count"] == 12
    assert len(default_limit.json()["sections"][0]["styles"]) == 12
    assert default_limit.json()["sections"][0]["styles"][-1]["code"] == "extra-15"
    assert default_limit.json()["total_count"] == 13


def test_list_styles_etag_returns_empty_304(client: TestClient):
    client.portal.call(_create_styles)
    first = client.get("/v1/styles")

    response = client.get("/v1/styles", headers={"If-None-Match": first.headers["ETag"]})

    assert first.headers["ETag"]
    assert response.status_code == 304
    assert response.content == b""
    assert response.headers["ETag"] == first.headers["ETag"]


def test_style_detail_exposes_public_and_ab_but_hides_draft_and_retired(client: TestClient):
    client.portal.call(_create_styles)

    public = client.get("/v1/styles/3")
    ab = client.get("/v1/styles/7")

    assert public.status_code == ab.status_code == 200
    assert public.json() == {
        "id": 3,
        "code": "popular-first",
        "name": "Popular first",
        "credit_cost": 2,
        "examples": [
            "https://cdn.example.com/styles/popular-first.jpg",
            "https://cdn.example.com/styles/popular-first-2.jpg",
        ],
        "fit_tags": [{"label": "소형견", "score": "good"}],
        "avg_duration_seconds": 18,
        "output_count": 1,
        "uses_pet_name": False,
        "uses_breed": False,
    }
    for style_id in (5, 6, 999):
        response = client.get(f"/v1/styles/{style_id}")
        assert response.status_code == 404
        assert response.json()["error"] == {
            "code": "NOT_FOUND",
            "message": "Style not found",
            "detail": {},
        }


def test_style_placeholder_flags_use_any_active_prompt(client: TestClient):
    client.portal.call(_create_styles)
    client.portal.call(_create_prompt_versions)

    listing = client.get("/v1/styles")

    assert listing.status_code == 200
    by_id = {
        style["id"]: style
        for section in listing.json()["sections"]
        for style in section["styles"]
    }
    expected = {
        1: {"uses_pet_name": True, "uses_breed": False},
        2: {"uses_pet_name": False, "uses_breed": True},
        4: {"uses_pet_name": False, "uses_breed": False},
    }
    assert {
        style_id: {
            "uses_pet_name": by_id[style_id]["uses_pet_name"],
            "uses_breed": by_id[style_id]["uses_breed"],
        }
        for style_id in expected
    } == expected

    for style_id, flags in expected.items():
        detail = client.get(f"/v1/styles/{style_id}")
        assert detail.status_code == 200
        assert {key: detail.json()[key] for key in flags} == flags


def test_image_urls_fall_back_to_media_prefix_without_cdn(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    # 이슈 #71 — CDN_BASE_URL이 빈 값(로컬)일 때 public_url() 폴백을 거쳐 /media/가 붙어야 한다.
    monkeypatch.setattr(settings, "cdn_base_url", "")
    client.portal.call(_create_styles)

    listing = client.get("/v1/styles").json()
    by_code = {
        style["code"]: style
        for section in listing["sections"]
        for style in section["styles"]
    }
    assert by_code["popular-first"]["thumbnail_url"] == "/media/styles/popular-first.jpg"
    assert by_code["popular-second"]["thumbnail_url"] == "/media/styles/popular-second.jpg"

    detail = client.get("/v1/styles/3").json()
    assert detail["examples"] == [
        "/media/styles/popular-first.jpg",
        "/media/styles/popular-first-2.jpg",
    ]
