import asyncio
import io
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from openai import BadRequestError
from PIL import Image
from tortoise import Tortoise, connections

from app import storage, worker
from app.models import (
    CreditLedger,
    CustomPromptLog,
    GenerationJob,
    GenerationResult,
    JobStatus,
    Member,
    MemberKind,
    PromptVersionStatus,
    SourceImage,
    Style,
    StylePromptVersion,
)
from app.settings import settings
from conftest import reset_tortoise_executor_cache


TEST_PG_DATABASE_URL = os.getenv("TEST_PG_DATABASE_URL")


def _bad_request(code: str) -> BadRequestError:
    request = httpx.Request("POST", "https://api.openai.com/v1/images/edits")
    response = httpx.Response(400, request=request)
    return BadRequestError("blocked", response=response, body={"code": code})


@pytest.fixture(autouse=True)
async def database(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, request):
    is_pg_test = request.node.name == "test_postgres_workers_skip_locked_and_reclaim_expired"
    db_url = TEST_PG_DATABASE_URL if is_pg_test else "sqlite://:memory:"
    assert db_url is not None
    reset_tortoise_executor_cache()
    await Tortoise.init(
        db_url=db_url,
        modules={"models": ["app.models"]},
        _enable_global_fallback=True,
    )
    await Tortoise.generate_schemas()
    if is_pg_test:
        await connections.get("default").execute_script(
            'TRUNCATE TABLE "member" RESTART IDENTITY CASCADE;'
        )
    monkeypatch.setattr(settings, "r2_endpoint_url", "")
    monkeypatch.setattr(settings, "openai_api_key", "")
    monkeypatch.setattr(storage, "MEDIA_ROOT", str(tmp_path))
    yield
    if is_pg_test:
        await connections.get("default").execute_script(
            'TRUNCATE TABLE "member" RESTART IDENTITY CASCADE;'
        )
    await Tortoise.close_connections()


def _image_bytes(color: tuple[int, int, int] = (121, 80, 40)) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (64, 64), color).save(output, format="JPEG")
    return output.getvalue()


async def _preset_job(*, attempt_count: int = 0, prompt_version: bool = True):
    member = await Member.create(kind=MemberKind.MEMBER, credit_balance=0)
    source_key = f"uploads/{uuid.uuid4()}.jpg"
    await storage.save_bytes(source_key, _image_bytes(), "image/jpeg")
    source = await SourceImage.create(
        member=member,
        storage_key=source_key,
        quality_check={},
    )
    style = await Style.create(
        id=1,
        code="watercolor",
        section="test",
        name="수채화",
    )
    version = None
    if prompt_version:
        version = await StylePromptVersion.create(
            id=1,
            style=style,
            version=1,
            prompt_text="수채화로 변환",
            model_config={"provider": "openai"},
            status=PromptVersionStatus.ACTIVE,
        )
    job = await GenerationJob.create(
        member=member,
        source_image=source,
        style=style,
        prompt_version=version,
        idempotency_key=uuid.uuid4(),
        credit_cost=2,
        attempt_count=attempt_count,
    )
    return member, job, await storage.load_bytes(source_key)


async def _fail_generation(*_args) -> bytes:
    raise RuntimeError("provider failed")


async def test_preset_success_creates_signed_result(monkeypatch: pytest.MonkeyPatch):
    _, job, original = await _preset_job()

    async def generated(*_args):
        return original

    monkeypatch.setattr(worker, "_generate_image", generated)
    await worker.process_job({"id": str(job.id), "attempt_count": "ignored"})

    saved_job = await GenerationJob.get(id=job.id)
    result = await GenerationResult.get(job_id=job.id)
    result_bytes = await storage.load_bytes(result.storage_key)
    assert result.seq == 1
    assert saved_job.status == JobStatus.SUCCEEDED
    assert saved_job.finished_at is not None
    assert Path(storage.MEDIA_ROOT, result.storage_key).exists()
    assert result_bytes != original


async def test_provider_failure_requeues_without_refund(monkeypatch: pytest.MonkeyPatch):
    _, job, _ = await _preset_job()
    monkeypatch.setattr(worker, "_generate_image", _fail_generation)

    await worker.process_job({"id": job.id})

    saved_job = await GenerationJob.get(id=job.id)
    assert saved_job.status == JobStatus.QUEUED
    assert saved_job.attempt_count == 1
    assert not await CreditLedger.filter(reason="generation_refund").exists()


async def test_safety_block_fails_immediately_with_refund(
    monkeypatch: pytest.MonkeyPatch,
):
    _, job, _ = await _preset_job(attempt_count=0)

    async def blocked(*_args):
        raise _bad_request("moderation_blocked")

    monkeypatch.setattr(worker, "_generate_image", blocked)
    await worker.process_job({"id": str(job.id)})

    saved_job = await GenerationJob.get(id=job.id)
    refunds = await CreditLedger.filter(
        reason="safety_block_refund", dedupe_key=f"refund:{job.id}"
    ).all()
    assert saved_job.status == JobStatus.FAILED
    assert saved_job.error_code == "SAFETY_BLOCKED"
    assert saved_job.attempt_count == 1
    assert saved_job.finished_at is not None
    assert len(refunds) == 1
    assert refunds[0].amount == 2
    assert not await CreditLedger.filter(reason="generation_refund").exists()


async def test_non_safety_bad_request_still_retries(monkeypatch: pytest.MonkeyPatch):
    _, job, _ = await _preset_job(attempt_count=0)

    async def invalid_image(*_args):
        raise _bad_request("invalid_image")

    monkeypatch.setattr(worker, "_generate_image", invalid_image)
    await worker.process_job({"id": str(job.id)})

    saved_job = await GenerationJob.get(id=job.id)
    assert saved_job.status == JobStatus.QUEUED
    assert await CreditLedger.all().count() == 0


async def test_third_failure_is_terminal_and_refund_is_deduplicated(
    monkeypatch: pytest.MonkeyPatch,
):
    _, job, _ = await _preset_job(attempt_count=2)
    monkeypatch.setattr(worker, "_generate_image", _fail_generation)

    await worker.process_job({"id": str(job.id)})
    await worker.process_job({"id": str(job.id)})

    saved_job = await GenerationJob.get(id=job.id)
    refunds = await CreditLedger.filter(
        reason="generation_refund", dedupe_key=f"refund:{job.id}"
    ).all()
    assert saved_job.status == JobStatus.FAILED
    assert saved_job.error_code == "MAX_RETRIES_EXCEEDED"
    assert len(refunds) == 1
    assert refunds[0].amount == 2


async def test_custom_prompt_uses_fixed_template(monkeypatch: pytest.MonkeyPatch):
    member = await Member.create(kind=MemberKind.MEMBER)
    source_key = f"uploads/{uuid.uuid4()}.jpg"
    original = _image_bytes()
    await storage.save_bytes(source_key, original, "image/jpeg")
    source = await SourceImage.create(member=member, storage_key=source_key, quality_check={})
    job = await GenerationJob.create(
        member=member,
        source_image=source,
        idempotency_key=uuid.uuid4(),
        credit_cost=1,
    )
    log = await CustomPromptLog.create(
        member=member,
        raw_text="우주복을 입혀줘",
        normalized_text="우주복",
        moderation={},
        job=job,
    )
    job.custom_prompt_id = log.id
    await job.save(update_fields=["custom_prompt_id"])
    prompts = []

    async def capture_prompt(_original, prompt, style_name):
        prompts.append((prompt, style_name))
        return original

    monkeypatch.setattr(worker, "_generate_image", capture_prompt)
    await worker.process_job({"id": str(job.id)})

    assert prompts == [
        (
            "강아지 사진을 다음 지시로 변환: 우주복을 입혀줘. 품종·털색·무늬는 원본 유지.",
            "커스텀",
        )
    ]


async def test_fake_fallback_generates_image_without_api_key():
    _, job, original = await _preset_job()

    await worker.process_job({"id": job.id})

    result = await GenerationResult.get(job_id=job.id)
    result_bytes = await storage.load_bytes(result.storage_key)
    assert result_bytes != original
    with Image.open(io.BytesIO(result_bytes)) as image:
        assert image.format == "JPEG"


async def test_missing_prompt_version_fails_immediately_and_refunds():
    _, job, _ = await _preset_job(attempt_count=0, prompt_version=False)

    await worker.process_job({"id": str(job.id)})

    saved_job = await GenerationJob.get(id=job.id)
    refunds = await CreditLedger.filter(
        reason="generation_refund", dedupe_key=f"refund:{job.id}"
    ).all()
    assert saved_job.status == JobStatus.FAILED
    assert saved_job.error_code == "GENERATION_FAILED"
    assert saved_job.attempt_count == 1
    assert len(refunds) == 1


@pytest.mark.skipif(
    not TEST_PG_DATABASE_URL,
    reason="TEST_PG_DATABASE_URL is required for PostgreSQL worker tests",
)
async def test_postgres_workers_skip_locked_and_reclaim_expired():
    _, job, _ = await _preset_job()

    selected = await asyncio.gather(worker.fetch_next_job(), worker.fetch_next_job())
    assert [row["id"] for row in selected if row is not None] == [job.id]
    assert (await GenerationJob.get(id=job.id)).attempt_count == 1

    await GenerationJob.filter(id=job.id).update(
        status=JobStatus.PROCESSING,
        lease_expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    reclaimed = await worker.fetch_next_job()
    assert reclaimed is not None
    assert reclaimed["id"] == job.id
    assert (await GenerationJob.get(id=job.id)).attempt_count == 2
