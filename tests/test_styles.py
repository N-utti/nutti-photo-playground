import os

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.main import app
from app.models import Style, StyleStatus
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
                    },
                    {
                        "id": 4,
                        "code": "summer-second",
                        "name": "Summer second",
                        "thumbnail_url": None,
                        "credit_cost": 1,
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
                    },
                    {
                        "id": 1,
                        "code": "popular-second",
                        "name": "Popular second",
                        "thumbnail_url": "https://cdn.example.com/styles/popular-second.jpg",
                        "credit_cost": 1,
                    },
                ],
            },
        ],
        "total_count": 4,
    }


def test_list_styles_limit_is_per_section_and_preserves_counts(client: TestClient):
    client.portal.call(_create_styles)

    response = client.get("/v1/styles", params={"limit": 1})
    filtered = client.get("/v1/styles", params={"section": "popular", "limit": 1})

    assert response.status_code == filtered.status_code == 200
    assert [len(section["styles"]) for section in response.json()["sections"]] == [1, 1]
    assert [section["count"] for section in response.json()["sections"]] == [2, 2]
    assert response.json()["total_count"] == 4
    assert [section["name"] for section in filtered.json()["sections"]] == ["popular"]
    assert filtered.json()["sections"][0]["count"] == 2
    assert filtered.json()["total_count"] == 4


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
    }
    for style_id in (5, 6, 999):
        response = client.get(f"/v1/styles/{style_id}")
        assert response.status_code == 404
        assert response.json()["error"] == {
            "code": "NOT_FOUND",
            "message": "Style not found",
            "detail": {},
        }
