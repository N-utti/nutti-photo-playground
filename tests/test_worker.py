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
    PetProfile,
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
    monkeypatch.setattr(settings, "fal_key", "")
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


async def _preset_job(
    *,
    attempt_count: int = 0,
    prompt_version: bool = True,
    prompt_text: str = "수채화로 변환",
    pet_name: str | None = None,
    breed_label: str | None = None,
    breed_estimate: dict | None = None,
    input_fields: list | None = None,
    input_values: dict | None = None,
):
    member = await Member.create(kind=MemberKind.MEMBER, credit_balance=0)
    pet_profile = (
        await PetProfile.create(
            member=member,
            name=pet_name or "",
            breed_label=breed_label,
        )
        if pet_name is not None or breed_label is not None
        else None
    )
    source_key = f"uploads/{uuid.uuid4()}.jpg"
    await storage.save_bytes(source_key, _image_bytes(), "image/jpeg")
    source = await SourceImage.create(
        member=member,
        pet_profile=pet_profile,
        storage_key=source_key,
        quality_check={},
        breed_estimate=breed_estimate,
    )
    style = await Style.create(
        id=1,
        code="watercolor",
        section="test",
        name="수채화",
        input_fields=input_fields or [],
    )
    version = None
    if prompt_version:
        version = await StylePromptVersion.create(
            id=1,
            style=style,
            version=1,
            prompt_text=prompt_text,
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
        input_values=input_values,
    )
    return member, job, await storage.load_bytes(source_key)


async def _fail_generation(_original, _prompt, _style_name, model_config=None) -> bytes:
    raise RuntimeError("provider failed")


@pytest.mark.parametrize(
    ("model_config", "endpoint"),
    [
        (None, "fal-ai/nano-banana-2/edit"),
        ({"fal_endpoint": "openai/gpt-image-2/edit"}, "openai/gpt-image-2/edit"),
    ],
)
async def test_generate_image_via_fal(
    monkeypatch: pytest.MonkeyPatch,
    model_config: dict | None,
    endpoint: str,
):
    class FakeResponse:
        def __init__(self, data=None, content: bytes = b""):
            self.data = data
            self.content = content

        def raise_for_status(self):
            pass

        def json(self):
            return self.data

    class FakeClient:
        post_call = None
        get_calls = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            pass

        async def post(self, url, **kwargs):
            FakeClient.post_call = (url, kwargs)
            return FakeResponse({"status_url": "https://fal.test/status"})

        async def get(self, url, **kwargs):
            FakeClient.get_calls.append((url, kwargs))
            if url == "https://fal.test/status":
                return FakeResponse(
                    {
                        "status": "COMPLETED",
                        "response_url": "https://fal.test/response",
                    }
                )
            if url == "https://fal.test/response":
                return FakeResponse({"images": [{"url": "https://fal.test/image"}]})
            assert url == "https://fal.test/image"
            return FakeResponse(content=b"generated-image")

    monkeypatch.setattr(settings, "fal_key", "test-key")
    monkeypatch.setattr(
        settings, "fal_image_endpoint", "fal-ai/nano-banana-2/edit"
    )
    monkeypatch.setattr(worker.httpx, "AsyncClient", FakeClient)

    result = await worker._generate_image(
        b"original", "draw this", "test", model_config=model_config
    )

    assert result == b"generated-image"
    url, kwargs = FakeClient.post_call
    assert url == f"https://queue.fal.run/{endpoint}"
    auth_headers = {"Authorization": "Key test-key"}
    assert kwargs["headers"] == auth_headers
    assert kwargs["json"]["prompt"] == "draw this"
    assert kwargs["json"]["image_urls"] == [
        "data:image/jpeg;base64,b3JpZ2luYWw="
    ]
    assert kwargs["json"]["output_format"] == "jpeg"
    if endpoint.startswith("openai/"):
        assert kwargs["json"]["quality"] == settings.openai_image_quality
        assert kwargs["json"]["image_size"] == "auto"
    else:
        assert kwargs["json"]["resolution"] == "1K"
    assert FakeClient.get_calls == [
        ("https://fal.test/status", {"headers": auth_headers}),
        ("https://fal.test/response", {"headers": auth_headers}),
        ("https://fal.test/image", {}),
    ]


async def test_preset_success_creates_signed_result(monkeypatch: pytest.MonkeyPatch):
    _, job, original = await _preset_job()

    async def generated(_original, _prompt, _style_name, model_config=None):
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


async def test_preset_replaces_pet_name(monkeypatch: pytest.MonkeyPatch):
    _, job, original = await _preset_job(
        prompt_text="[pet name]을 수채화로 변환",
        pet_name="몽이",
    )
    prompts = []

    async def capture_prompt(_original, prompt, _style_name, model_config=None):
        prompts.append(prompt)
        return original

    monkeypatch.setattr(worker, "_generate_image", capture_prompt)
    await worker.process_job({"id": str(job.id)})

    assert "몽이" in prompts[0]
    assert "[pet name]" not in prompts[0]


async def test_preset_prepends_stored_input_values(monkeypatch: pytest.MonkeyPatch):
    _, job, original = await _preset_job(
        prompt_text="wearing the costume written above",
        input_fields=[
            {
                "label": "의상",
                "type": "choice",
                "default": "버섯",
                "options": [{"value": "버섯"}, {"value": "옥수수"}],
            }
        ],
        input_values={"의상": "옥수수"},
    )
    prompts = []

    async def capture_prompt(_original, prompt, _style_name, model_config=None):
        prompts.append(prompt)
        return original

    monkeypatch.setattr(worker, "_generate_image", capture_prompt)
    await worker.process_job({"id": str(job.id)})

    assert prompts[0] == "의상: 옥수수\n\nwearing the costume written above"


async def test_preset_input_values_fall_back_to_default_and_pet_name(
    monkeypatch: pytest.MonkeyPatch,
):
    _, job, original = await _preset_job(
        prompt_text="as written above",
        pet_name="몽이",
        input_fields=[
            {"label": "의상", "type": "choice", "default": "버섯"},
            {"label": "반려견 이름", "type": "text", "prefill": "pet_name"},
        ],
    )
    prompts = []

    async def capture_prompt(_original, prompt, _style_name, model_config=None):
        prompts.append(prompt)
        return original

    monkeypatch.setattr(worker, "_generate_image", capture_prompt)
    await worker.process_job({"id": str(job.id)})

    assert prompts[0] == "의상: 버섯\n반려견 이름: 몽이\n\nas written above"


async def test_preset_replaces_breed(monkeypatch: pytest.MonkeyPatch):
    _, job, original = await _preset_job(
        prompt_text="[breed]을 수채화로 변환",
        breed_label="말티푸",
    )
    prompts = []

    async def capture_prompt(_original, prompt, _style_name, model_config=None):
        prompts.append(prompt)
        return original

    monkeypatch.setattr(worker, "_generate_image", capture_prompt)
    await worker.process_job({"id": str(job.id)})

    assert "말티푸" in prompts[0]
    assert "[breed]" not in prompts[0]


async def test_preset_replaces_breed_falls_back_to_vision_estimate(
    monkeypatch: pytest.MonkeyPatch,
):
    _, job, original = await _preset_job(
        prompt_text="[breed]을 수채화로 변환",
        breed_estimate={"label": "토이푸들", "confidence": 0.9},
    )
    prompts = []

    async def capture_prompt(_original, prompt, _style_name, model_config=None):
        prompts.append(prompt)
        return original

    monkeypatch.setattr(worker, "_generate_image", capture_prompt)
    await worker.process_job({"id": str(job.id)})

    assert "토이푸들" in prompts[0]
    assert "[breed]" not in prompts[0]


async def test_preset_replaces_breed_defaults_without_estimate(
    monkeypatch: pytest.MonkeyPatch,
):
    _, job, original = await _preset_job(prompt_text="[breed]을 수채화로 변환")
    prompts = []

    async def capture_prompt(_original, prompt, _style_name, model_config=None):
        prompts.append(prompt)
        return original

    monkeypatch.setattr(worker, "_generate_image", capture_prompt)
    await worker.process_job({"id": str(job.id)})

    assert "강아지" in prompts[0]
    assert "[breed]" not in prompts[0]


async def test_preset_uses_fallback_without_pet_profile(
    monkeypatch: pytest.MonkeyPatch,
):
    _, job, original = await _preset_job(prompt_text="[pet name]을 수채화로 변환")
    prompts = []

    async def capture_prompt(_original, prompt, _style_name, model_config=None):
        prompts.append(prompt)
        return original

    monkeypatch.setattr(worker, "_generate_image", capture_prompt)
    await worker.process_job({"id": str(job.id)})

    assert "우리 아이" in prompts[0]


async def test_provider_failure_requeues_without_refund(monkeypatch: pytest.MonkeyPatch):
    _, job, _ = await _preset_job()
    monkeypatch.setattr(worker, "_generate_image", _fail_generation)

    await worker.process_job({"id": job.id})

    saved_job = await GenerationJob.get(id=job.id)
    assert saved_job.status == JobStatus.QUEUED
    assert saved_job.attempt_count == 1
    assert not await CreditLedger.filter(reason="generation_refund").exists()


async def test_withdrawn_member_result_is_soft_deleted(monkeypatch: pytest.MonkeyPatch):
    member, job, original = await _preset_job()
    member.withdrawn_at = datetime.now(timezone.utc)
    await member.save(update_fields=["withdrawn_at"])

    async def generated(_original, _prompt, _style_name, model_config=None):
        return original

    monkeypatch.setattr(worker, "_generate_image", generated)
    await worker.process_job({"id": str(job.id)})

    result = await GenerationResult.get(job_id=job.id)
    assert result.deleted_at is not None


async def test_withdrawn_member_gets_no_refund(monkeypatch: pytest.MonkeyPatch):
    member, job, _ = await _preset_job()
    member.withdrawn_at = datetime.now(timezone.utc)
    member.credit_balance = 0
    await member.save(update_fields=["withdrawn_at", "credit_balance"])

    async def blocked(_original, _prompt, _style_name, model_config=None):
        raise _bad_request("moderation_blocked")

    monkeypatch.setattr(worker, "_generate_image", blocked)
    await worker.process_job({"id": str(job.id)})

    saved = await Member.get(id=member.id)
    assert saved.credit_balance == 0
    assert not await CreditLedger.filter(member_id=member.id).exists()


async def test_safety_block_fails_immediately_with_refund(
    monkeypatch: pytest.MonkeyPatch,
):
    _, job, _ = await _preset_job(attempt_count=0)

    async def blocked(_original, _prompt, _style_name, model_config=None):
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

    async def invalid_image(_original, _prompt, _style_name, model_config=None):
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

    async def capture_prompt(_original, prompt, style_name, model_config=None):
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


async def test_worker_loop_runs_jobs_concurrently_up_to_limit(monkeypatch: pytest.MonkeyPatch):
    """fal 대기(I/O) 동안 다른 잡을 집는다 — 4명이 동시에 눌러도 4번째가 4배를 기다리지 않는다."""
    from app.settings import settings

    monkeypatch.setattr(settings, "worker_concurrency", 3)
    monkeypatch.setattr(worker, "POLL_INTERVAL_SECONDS", 0.01)
    queue = [{"id": f"job-{i}"} for i in range(5)]
    active = 0
    peak = 0
    done: list[str] = []

    async def fetch_next_job():
        return queue.pop(0) if queue else None

    async def process_job(job, *, lease):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.05)
        active -= 1
        done.append(job["id"])

    monkeypatch.setattr(worker, "fetch_next_job", fetch_next_job)
    monkeypatch.setattr(worker, "process_job", process_job)

    loop_task = asyncio.create_task(worker.run_worker_loop())
    for _ in range(200):
        await asyncio.sleep(0.01)
        if len(done) == 5:
            break
    loop_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await loop_task

    assert sorted(done) == [f"job-{i}" for i in range(5)]
    assert peak == 3


async def test_worker_loop_survives_a_crashed_slot(monkeypatch: pytest.MonkeyPatch, caplog):
    from app.settings import settings

    monkeypatch.setattr(settings, "worker_concurrency", 2)
    monkeypatch.setattr(worker, "POLL_INTERVAL_SECONDS", 0.01)
    queue = [{"id": "boom"}, {"id": "ok"}]
    done: list[str] = []

    async def fetch_next_job():
        return queue.pop(0) if queue else None

    async def process_job(job, *, lease):
        if job["id"] == "boom":
            raise RuntimeError("db went away")
        done.append(job["id"])

    monkeypatch.setattr(worker, "fetch_next_job", fetch_next_job)
    monkeypatch.setattr(worker, "process_job", process_job)

    loop_task = asyncio.create_task(worker.run_worker_loop())
    for _ in range(100):
        await asyncio.sleep(0.01)
        if done:
            break
    loop_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await loop_task

    assert done == ["ok"]
    assert "worker task crashed" in caplog.text
