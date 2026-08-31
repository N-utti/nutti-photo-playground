import os
import uuid
from functools import partial

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.auth import create_admin_token, create_token, hash_password
from app.main import app
from app.models import (
    AdminUser,
    CreditLedger,
    CreditReason,
    CustomPromptLog,
    GenerationJob,
    Member,
    MemberKind,
    MetricEvent,
    PromptVersionStatus,
    SourceImage,
    Style,
    StylePromptVersion,
    StyleStatus,
)
from app.routers import admin as admin_router
from app.routers import auth as auth_router


@pytest.fixture
def client():
    for buckets in (
        auth_router._guest_requests,
        auth_router._login_requests,
        auth_router._register_requests,
        admin_router._admin_login_requests,
    ):
        buckets.clear()
    with TestClient(app) as test_client:
        test_client.portal.call(Tortoise.generate_schemas)
        yield test_client


async def _create_member(
    kind: MemberKind, credit_balance: int = 0, withdrawn: bool = False
) -> str:
    member = await Member.create(kind=kind, credit_balance=credit_balance)
    if withdrawn:
        member.withdrawn_at = member.created_at
        await member.save(update_fields=["withdrawn_at"])
    return str(member.id)


def _session(
    client: TestClient, kind: MemberKind = MemberKind.MEMBER
) -> tuple[str, dict[str, str]]:
    member_id = client.portal.call(_create_member, kind)
    token = create_token(uuid.UUID(member_id), kind.value, 0)
    return member_id, {"Authorization": f"Bearer {token}"}


async def _create_job(member_id: str, style_id: int | None = None) -> str:
    source = await SourceImage.create(
        member_id=member_id,
        storage_key=f"uploads/{uuid.uuid4()}.jpg",
        quality_check={},
    )
    job = await GenerationJob.create(
        member_id=member_id,
        source_image=source,
        style_id=style_id,
        idempotency_key=uuid.uuid4(),
        credit_cost=1,
    )
    return str(job.id)


async def _create_admin(email: str = "admin@nutti.test", password: str = "secret") -> int:
    admin = await AdminUser.create(email=email, password_hash=hash_password(password))
    return admin.id


def _admin_headers(client: TestClient) -> dict[str, str]:
    admin_id = client.portal.call(_create_admin)
    return {"Authorization": f"Bearer {create_admin_token(admin_id)}"}


def test_admin_adjust_credits_grants_and_records_ledger(client: TestClient):
    member_id = client.portal.call(_create_member, MemberKind.MEMBER)

    response = client.post(
        "/v1/admin/credits/adjust",
        headers=_admin_headers(client),
        json={"member_id": member_id, "amount": 5, "dedupe_key": "admin-positive"},
    )

    member = client.portal.call(partial(Member.get, id=member_id))
    ledger = client.portal.call(partial(CreditLedger.get, member_id=member_id))
    assert response.status_code == 200
    assert response.json() == {
        "member_id": member_id,
        "balance": 5,
        "amount_granted": 5,
    }
    assert member.credit_balance == 5
    assert ledger.amount == 5
    assert ledger.reason == CreditReason.CS_ADJUSTMENT
    assert ledger.dedupe_key == "admin-positive"
    assert ledger.balance_after == 5
    assert ledger.ref_id.startswith("admin:")


def test_admin_adjust_credits_deducts_from_sufficient_balance(client: TestClient):
    member_id = client.portal.call(_create_member, MemberKind.MEMBER, 10)

    response = client.post(
        "/v1/admin/credits/adjust",
        headers=_admin_headers(client),
        json={"member_id": member_id, "amount": -4, "dedupe_key": "admin-negative"},
    )

    member = client.portal.call(partial(Member.get, id=member_id))
    assert response.status_code == 200
    assert response.json()["balance"] == 6
    assert response.json()["amount_granted"] == -4
    assert member.credit_balance == 6


def test_admin_adjust_credits_rejects_negative_balance(client: TestClient):
    member_id = client.portal.call(_create_member, MemberKind.MEMBER, 3)

    response = client.post(
        "/v1/admin/credits/adjust",
        headers=_admin_headers(client),
        json={"member_id": member_id, "amount": -4, "dedupe_key": "admin-overdraw"},
    )

    member = client.portal.call(partial(Member.get, id=member_id))
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert member.credit_balance == 3


def test_admin_adjust_credits_rejects_duplicate_dedupe_key(client: TestClient):
    member_id = client.portal.call(_create_member, MemberKind.MEMBER)
    payload = {
        "member_id": member_id,
        "amount": 5,
        "dedupe_key": "admin-duplicate",
    }
    headers = _admin_headers(client)

    first = client.post("/v1/admin/credits/adjust", headers=headers, json=payload)
    duplicate = client.post("/v1/admin/credits/adjust", headers=headers, json=payload)

    member = client.portal.call(partial(Member.get, id=member_id))
    assert first.status_code == 200
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "ALREADY_CLAIMED"
    assert member.credit_balance == 5


def test_admin_adjust_credits_returns_not_found_for_missing_member(client: TestClient):
    response = client.post(
        "/v1/admin/credits/adjust",
        headers=_admin_headers(client),
        json={
            "member_id": str(uuid.uuid4()),
            "amount": 1,
            "dedupe_key": "admin-missing",
        },
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_admin_adjust_credits_returns_not_found_for_withdrawn_member(
    client: TestClient,
):
    member_id = client.portal.call(_create_member, MemberKind.MEMBER, 0, True)

    response = client.post(
        "/v1/admin/credits/adjust",
        headers=_admin_headers(client),
        json={"member_id": member_id, "amount": 1, "dedupe_key": "admin-withdrawn"},
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


async def _merge_member(member_id: str, target_id: str) -> None:
    await Member.filter(id=member_id).update(merged_into_id=target_id)


def test_admin_adjust_credits_returns_not_found_for_merged_member(client: TestClient):
    member_id = client.portal.call(_create_member, MemberKind.MEMBER)
    target_id = client.portal.call(_create_member, MemberKind.MEMBER)
    client.portal.call(_merge_member, member_id, target_id)

    response = client.post(
        "/v1/admin/credits/adjust",
        headers=_admin_headers(client),
        json={"member_id": member_id, "amount": 1, "dedupe_key": "admin-merged"},
    )

    assert response.status_code == 404


@pytest.mark.parametrize(
    "invalid_field",
    [{"amount": 0}, {"amount": 100_001}, {"reason": "bogus"}, {"dedupe_key": ""}],
)
def test_admin_adjust_credits_validates_payload(
    client: TestClient, invalid_field: dict
):
    member_id = client.portal.call(_create_member, MemberKind.MEMBER)
    payload = {
        "member_id": member_id,
        "amount": 1,
        "dedupe_key": "admin-invalid",
    }
    payload.update(invalid_field)

    response = client.post(
        "/v1/admin/credits/adjust",
        headers=_admin_headers(client),
        json=payload,
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_admin_adjust_credits_rejects_member_token(client: TestClient):
    member_id, member_headers = _session(client)

    response = client.post(
        "/v1/admin/credits/adjust",
        headers=member_headers,
        json={"member_id": member_id, "amount": 1, "dedupe_key": "admin-member"},
    )

    assert response.status_code == 401


async def _create_custom_prompt_logs(member_id: str) -> dict[str, str]:
    ids = {}
    for normalized_text, frequency in (("A", 3), ("B", 2), ("C", 1), ("", 1)):
        for _ in range(frequency):
            log = await CustomPromptLog.create(
                member_id=member_id,
                raw_text=normalized_text,
                normalized_text=normalized_text,
                moderation={},
            )
            ids.setdefault(normalized_text, str(log.id))
    promoted_style = await Style.create(
        code="already-promoted",
        name="Already Promoted",
        section="admin-test",
    )
    promoted_log = await CustomPromptLog.get(id=ids["B"])
    promoted_log.promoted_style_id = promoted_style.id
    await promoted_log.save(update_fields=["promoted_style_id"])
    return ids


async def _create_custom_prompt_group(member_id: str) -> list[str]:
    logs = [
        await CustomPromptLog.create(
            member_id=member_id,
            raw_text="승격 문구",
            normalized_text="승격 문구",
            moderation={},
        )
        for _ in range(2)
    ]
    return [str(log.id) for log in logs]


async def _promoted_style_ids() -> list[int | None]:
    return await CustomPromptLog.filter(normalized_text="승격 문구").values_list(
        "promoted_style_id", flat=True
    )


def test_admin_top_custom_prompts_aggregates_and_sorts(client: TestClient):
    member_id = client.portal.call(_create_member, MemberKind.MEMBER)
    ids = client.portal.call(_create_custom_prompt_logs, member_id)
    headers = _admin_headers(client)

    response = client.get("/v1/admin/custom-prompts/top", headers=headers)
    limited = client.get(
        "/v1/admin/custom-prompts/top?limit=1", headers=headers
    )

    assert response.status_code == 200
    assert response.json()["items"] == [
        {
            "id": ids["A"],
            "normalized_text": "A",
            "frequency": 3,
            "promotable": True,
        },
        {
            "id": ids["B"],
            "normalized_text": "B",
            "frequency": 2,
            "promotable": False,
        },
        {
            "id": ids["C"],
            "normalized_text": "C",
            "frequency": 1,
            "promotable": True,
        },
    ]
    assert limited.status_code == 200
    assert limited.json()["items"] == [response.json()["items"][0]]


def test_admin_promote_custom_prompt_updates_group_and_rejects_retry(
    client: TestClient,
):
    member_id = client.portal.call(_create_member, MemberKind.MEMBER)
    prompt_ids = client.portal.call(_create_custom_prompt_group, member_id)
    headers = _admin_headers(client)
    payload = {"section": "admin-test", "credit_cost": 3}

    response = client.post(
        f"/v1/admin/custom-prompts/{prompt_ids[0]}/promote",
        headers=headers,
        json=payload,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["code"].startswith("custom-")
    assert data["section"] == "admin-test"
    assert data["credit_cost"] == 3
    assert data["status"] == "draft"
    promoted_style_ids = client.portal.call(_promoted_style_ids)
    assert promoted_style_ids == [data["id"], data["id"]]

    retry = client.post(
        f"/v1/admin/custom-prompts/{prompt_ids[1]}/promote",
        headers=headers,
        json=payload,
    )
    assert retry.status_code == 409
    assert retry.json()["error"]["code"] == "ALREADY_CLAIMED"
    assert retry.json()["error"]["detail"] == {"style_id": data["id"]}


@pytest.mark.parametrize("prompt_id", [str(uuid.uuid4()), "not-a-uuid"])
def test_admin_promote_custom_prompt_returns_not_found(
    client: TestClient, prompt_id: str
):
    response = client.post(
        f"/v1/admin/custom-prompts/{prompt_id}/promote",
        headers=_admin_headers(client),
        json={"section": "admin-test"},
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_admin_promote_custom_prompt_rejects_empty_section(client: TestClient):
    member_id = client.portal.call(_create_member, MemberKind.MEMBER)
    prompt_id = client.portal.call(_create_custom_prompt_group, member_id)[0]

    response = client.post(
        f"/v1/admin/custom-prompts/{prompt_id}/promote",
        headers=_admin_headers(client),
        json={"section": ""},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_admin_login_success(client: TestClient):
    admin_id = client.portal.call(_create_admin)

    response = client.post(
        "/v1/admin/login",
        json={"email": "admin@nutti.test", "password": "secret"},
    )

    assert response.status_code == 200
    assert response.json()["admin_id"] == admin_id
    assert response.json()["email"] == "admin@nutti.test"
    assert isinstance(response.json()["token"], str)


@pytest.mark.parametrize(
    ("email", "password"),
    [
        ("admin@nutti.test", "wrong"),
        ("missing@nutti.test", "secret"),
    ],
)
def test_admin_login_rejects_invalid_credentials(
    client: TestClient, email: str, password: str
):
    client.portal.call(_create_admin)

    response = client.post(
        "/v1/admin/login", json={"email": email, "password": password}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_admin_styles_requires_admin_token(client: TestClient):
    without_token = client.get("/v1/admin/styles")
    _, member_headers = _session(client)
    with_member_token = client.get("/v1/admin/styles", headers=member_headers)
    with_admin_token = client.get("/v1/admin/styles", headers=_admin_headers(client))

    assert without_token.status_code == 401
    assert with_member_token.status_code == 401
    assert with_admin_token.status_code == 200


def test_admin_token_cannot_access_member_endpoint(client: TestClient):
    response = client.get("/v1/credits", headers=_admin_headers(client))

    assert response.status_code == 401


async def _create_styles() -> tuple[int, int]:
    style_a = await Style.create(
        id=1,
        code="admin-a",
        name="Admin A",
        section="admin-test",
        status=StyleStatus.DRAFT,
        sort_order=1,
    )
    style_b = await Style.create(
        id=2,
        code="admin-b",
        name="Admin B",
        section="admin-test",
        status=StyleStatus.PUBLIC,
        sort_order=2,
    )
    return style_a.id, style_b.id


async def _create_events(member_id: str, style_id: int):
    for event_type in (
        "result_view",
        "result_view",
        "share_click",
        "shop_exit_click",
    ):
        await MetricEvent.create(
            event_type=event_type,
            member_id=member_id,
            style_id=style_id,
        )


def test_admin_styles_returns_ordered_aggregates(client: TestClient):
    member_id, _ = _session(client)
    style_a_id, style_b_id = client.portal.call(_create_styles)
    client.portal.call(_create_job, member_id, style_a_id)
    client.portal.call(_create_job, member_id, style_a_id)
    client.portal.call(_create_job, member_id, style_b_id)
    client.portal.call(_create_events, member_id, style_a_id)

    response = client.get("/v1/admin/styles", headers=_admin_headers(client))

    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["id"] for item in items] == [style_a_id, style_b_id]
    assert items[0]["status"] == "draft"
    assert items[0]["selection_rate"] == 0.667
    assert items[0]["share_rate"] == 0.5
    assert items[0]["shop_click_rate"] == 0.5
    assert items[1]["selection_rate"] == 0.333
    assert items[1]["share_rate"] == 0.0
    assert items[1]["shop_click_rate"] == 0.0


def test_admin_login_locks_email_after_failures_and_normalizes_case(client: TestClient):
    client.portal.call(_create_admin)
    for _ in range(5):
        response = client.post(
            "/v1/admin/login", json={"email": " Admin@Nutti.Test ", "password": "wrong"}
        )
        assert response.status_code == 401

    response = client.post(
        "/v1/admin/login", json={"email": "admin@nutti.test", "password": "secret"}
    )

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"


async def _create_writable_style(code: str = "admin-write") -> int:
    style = await Style.create(
        code=code,
        name="Admin Write",
        section="admin-test",
    )
    return style.id


async def _style_write_state(style_id: int) -> tuple[StyleStatus, int, list]:
    style = await Style.get(id=style_id)
    return style.status, style.avg_seconds, style.input_fields


def test_admin_create_style_persists_input_fields(client: TestClient):
    input_fields = [{"label": "반려동물 이름", "default": "누띠"}]

    response = client.post(
        "/v1/admin/styles",
        headers=_admin_headers(client),
        json={
            "code": "new-style",
            "name": "New Style",
            "section": "admin-test",
            "input_fields": input_fields,
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "draft"
    assert data["sort_order"] == 0
    assert data["input_fields"] == input_fields
    assert client.portal.call(_style_write_state, data["id"]) == (
        StyleStatus.DRAFT,
        24,
        input_fields,
    )


def test_admin_create_style_rejects_duplicate_code(client: TestClient):
    headers = _admin_headers(client)
    payload = {
        "code": "duplicate-style",
        "name": "Duplicate Style",
        "section": "admin-test",
    }
    assert client.post("/v1/admin/styles", headers=headers, json=payload).status_code == 201

    response = client.post("/v1/admin/styles", headers=headers, json=payload)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    "payload",
    [
        {"code": "missing-name", "section": "admin-test"},
        {
            "code": "missing-label",
            "name": "Missing Label",
            "section": "admin-test",
            "input_fields": [{"default": "x"}],
        },
    ],
)
def test_admin_create_style_rejects_invalid_payload(
    client: TestClient, payload: dict
):
    response = client.post(
        "/v1/admin/styles", headers=_admin_headers(client), json=payload
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_admin_update_style_validates_and_persists_changes(client: TestClient):
    style_id = client.portal.call(_create_writable_style)
    headers = _admin_headers(client)

    response = client.patch(
        f"/v1/admin/styles/{style_id}",
        headers=headers,
        json={"status": "public", "avg_seconds": 48},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "public"
    assert response.json()["avg_seconds"] == 48
    assert client.portal.call(_style_write_state, style_id)[:2] == (
        StyleStatus.PUBLIC,
        48,
    )

    invalid = client.patch(
        f"/v1/admin/styles/{style_id}",
        headers=headers,
        json={"status": "bogus"},
    )
    missing = client.patch(
        "/v1/admin/styles/999999", headers=headers, json={"status": "public"}
    )

    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "NOT_FOUND"


def test_admin_delete_style_retires_it(client: TestClient):
    style_id = client.portal.call(_create_writable_style)
    headers = _admin_headers(client)

    response = client.delete(f"/v1/admin/styles/{style_id}", headers=headers)
    missing = client.delete("/v1/admin/styles/999999", headers=headers)

    assert response.status_code == 200
    assert response.json()["status"] == "retired"
    assert client.portal.call(_style_write_state, style_id)[0] == StyleStatus.RETIRED
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        (
            "POST",
            "/v1/admin/styles",
            {"code": "member-style", "name": "Member Style", "section": "test"},
        ),
        ("PATCH", "/v1/admin/styles/999999", {}),
        ("DELETE", "/v1/admin/styles/999999", None),
    ],
)
def test_admin_style_writes_reject_member_token(
    client: TestClient, method: str, path: str, payload: dict | None
):
    _, member_headers = _session(client)

    response = client.request(method, path, headers=member_headers, json=payload)

    assert response.status_code == 401


def test_admin_create_prompt_versions_assigns_incrementing_versions(
    client: TestClient,
):
    style_id = client.portal.call(_create_writable_style)
    headers = _admin_headers(client)
    payloads = [
        {
            "prompt_text": "first prompt",
            "model_config": {"model": "first"},
            "traffic_weight": 20,
        },
        {
            "prompt_text": "second prompt",
            "model_config": {"model": "second"},
            "traffic_weight": 80,
        },
    ]

    responses = [
        client.post(
            f"/v1/admin/styles/{style_id}/prompt-versions",
            headers=headers,
            json=payload,
        )
        for payload in payloads
    ]

    assert [response.status_code for response in responses] == [201, 201]
    for expected_version, payload, response in zip(
        (1, 2), payloads, responses, strict=True
    ):
        data = response.json()
        assert data["style_id"] == style_id
        assert data["version"] == expected_version
        assert data["status"] == "draft"
        assert data["prompt_text"] == payload["prompt_text"]
        assert data["model_config"] == payload["model_config"]
        assert data["traffic_weight"] == payload["traffic_weight"]


def test_admin_create_prompt_version_rejects_missing_style(client: TestClient):
    response = client.post(
        "/v1/admin/styles/999999/prompt-versions",
        headers=_admin_headers(client),
        json={"prompt_text": "prompt"},
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.parametrize(
    "payload",
    [
        {"prompt_text": ""},
        {"prompt_text": "prompt", "traffic_weight": -1},
    ],
)
def test_admin_create_prompt_version_validates_payload(
    client: TestClient, payload: dict
):
    style_id = client.portal.call(_create_writable_style)

    response = client.post(
        f"/v1/admin/styles/{style_id}/prompt-versions",
        headers=_admin_headers(client),
        json=payload,
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_admin_list_prompt_versions_orders_descending(client: TestClient):
    style_id = client.portal.call(_create_writable_style)
    headers = _admin_headers(client)
    for prompt_text in ("first prompt", "second prompt"):
        response = client.post(
            f"/v1/admin/styles/{style_id}/prompt-versions",
            headers=headers,
            json={"prompt_text": prompt_text},
        )
        assert response.status_code == 201

    response = client.get(
        f"/v1/admin/styles/{style_id}/prompt-versions", headers=headers
    )
    missing = client.get(
        "/v1/admin/styles/999999/prompt-versions", headers=headers
    )

    assert response.status_code == 200
    assert [item["version"] for item in response.json()["items"]] == [2, 1]
    assert [item["prompt_text"] for item in response.json()["items"]] == [
        "second prompt",
        "first prompt",
    ]
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "NOT_FOUND"


async def _prompt_version_state(
    version_id: int,
) -> tuple[PromptVersionStatus, int]:
    version = await StylePromptVersion.get(id=version_id)
    return version.status, version.traffic_weight


def test_admin_update_prompt_version_persists_changes(client: TestClient):
    style_id = client.portal.call(_create_writable_style)
    headers = _admin_headers(client)
    created = client.post(
        f"/v1/admin/styles/{style_id}/prompt-versions",
        headers=headers,
        json={"prompt_text": "prompt"},
    ).json()

    response = client.patch(
        f"/v1/admin/styles/{style_id}/prompt-versions/{created['id']}",
        headers=headers,
        json={"status": "active", "traffic_weight": 100},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "active"
    assert response.json()["traffic_weight"] == 100
    assert client.portal.call(_prompt_version_state, created["id"]) == (
        PromptVersionStatus.ACTIVE,
        100,
    )


def test_admin_update_prompt_version_rejects_invalid_status(client: TestClient):
    style_id = client.portal.call(_create_writable_style)
    headers = _admin_headers(client)
    created = client.post(
        f"/v1/admin/styles/{style_id}/prompt-versions",
        headers=headers,
        json={"prompt_text": "prompt"},
    ).json()

    response = client.patch(
        f"/v1/admin/styles/{style_id}/prompt-versions/{created['id']}",
        headers=headers,
        json={"status": "bogus"},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_admin_update_prompt_version_returns_not_found(client: TestClient):
    style_id = client.portal.call(_create_writable_style)

    response = client.patch(
        f"/v1/admin/styles/{style_id}/prompt-versions/999999",
        headers=_admin_headers(client),
        json={},
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_admin_update_prompt_version_rejects_other_style_version(
    client: TestClient,
):
    style_a_id = client.portal.call(_create_writable_style, "prompt-style-a")
    style_b_id = client.portal.call(_create_writable_style, "prompt-style-b")
    headers = _admin_headers(client)
    created = client.post(
        f"/v1/admin/styles/{style_a_id}/prompt-versions",
        headers=headers,
        json={"prompt_text": "prompt"},
    ).json()

    response = client.patch(
        f"/v1/admin/styles/{style_b_id}/prompt-versions/{created['id']}",
        headers=headers,
        json={"status": "active"},
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("GET", "/v1/admin/styles/999999/prompt-versions", None),
        (
            "POST",
            "/v1/admin/styles/999999/prompt-versions",
            {"prompt_text": "prompt"},
        ),
        ("PATCH", "/v1/admin/styles/999999/prompt-versions/999999", {}),
        ("GET", "/v1/admin/custom-prompts/top", None),
        (
            "POST",
            "/v1/admin/custom-prompts/00000000-0000-0000-0000-000000000000/promote",
            {"section": "admin-test"},
        ),
    ],
)
def test_admin_prompt_version_endpoints_reject_member_token(
    client: TestClient, method: str, path: str, payload: dict | None
):
    _, member_headers = _session(client)

    response = client.request(method, path, headers=member_headers, json=payload)

    assert response.status_code == 401
