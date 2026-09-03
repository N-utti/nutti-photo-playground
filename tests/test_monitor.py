import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest  # noqa: E402
from tortoise import Tortoise  # noqa: E402

from app import monitor  # noqa: E402
from app.models import (  # noqa: E402
    CreditLedger,
    CreditReason,
    GenerationJob,
    JobStatus,
    Member,
    MemberKind,
    SourceImage,
)


@pytest.fixture
async def db():
    await Tortoise.init(db_url="sqlite://:memory:", modules={"models": ["app.models"]})
    await Tortoise.generate_schemas()
    yield
    await Tortoise.close_connections()


async def _job(status: JobStatus, *, queued_ago: int = 0, lease_ago: int | None = None) -> GenerationJob:
    member = await Member.create(kind=MemberKind.GUEST, credit_balance=0)
    source = await SourceImage.create(member=member, storage_key=f"uploads/{uuid.uuid4()}.jpg", quality_check={})
    now = datetime.now(timezone.utc)
    job = await GenerationJob.create(
        member=member, source_image=source, idempotency_key=uuid.uuid4(), credit_cost=1, status=status,
        lease_expires_at=now - timedelta(seconds=lease_ago) if lease_ago is not None else None,
    )
    # auto_now_add 는 create 시각으로 박히므로 과거로 되돌린다
    await GenerationJob.filter(id=job.id).update(queued_at=now - timedelta(seconds=queued_ago))
    return job


async def test_collect_is_empty_when_healthy(db, monkeypatch):
    monkeypatch.setattr(monitor, "_mem_available_mb", lambda: 1000)
    await _job(JobStatus.QUEUED, queued_ago=10)
    await _job(JobStatus.PROCESSING, lease_ago=-300)
    assert await monitor.collect_problems() == {}


async def test_collect_flags_stale_queue_dead_worker_and_missing_refund(db, monkeypatch):
    monkeypatch.setattr(monitor, "_mem_available_mb", lambda: 120)
    await _job(JobStatus.QUEUED, queued_ago=600)
    await _job(JobStatus.PROCESSING, lease_ago=30)
    failed_refunded = await _job(JobStatus.FAILED)
    await CreditLedger.create(
        member_id=failed_refunded.member_id, dedupe_key="r", reason=CreditReason.GENERATION_REFUND,
        ref_id=str(failed_refunded.id), amount=1, balance_after=1,
    )
    failed_missing = await _job(JobStatus.FAILED)

    problems = await monitor.collect_problems()

    assert set(problems) == {"대기열 정체", "리스 만료 잡", "실패-미환불", "메모리 부족"}
    assert str(failed_missing.id) in problems["실패-미환불"]
    assert "120MB" in problems["메모리 부족"]


async def test_loop_alerts_once_then_reports_recovery(monkeypatch):
    sent: list[str] = []
    state = {"problems": {"대기열 정체": "3건"}}

    async def collect():
        return dict(state["problems"])

    async def alert(text):
        sent.append(text)

    monkeypatch.setattr(monitor, "collect_problems", collect)
    monkeypatch.setattr(monitor, "alert_admin", alert)
    monkeypatch.setattr(monitor, "CHECK_INTERVAL_SECONDS", 0.01)

    task = asyncio.create_task(monitor.run_monitor_loop())
    await asyncio.sleep(0.05)  # 여러 틱 — 같은 문제는 한 번만
    state["problems"] = {}
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(sent) == 2
    assert sent[0].startswith("🚨") and "대기열 정체" in sent[0]
    assert sent[1].startswith("✅") and "대기열 정체" in sent[1]
