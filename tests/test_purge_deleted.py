import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from tortoise import Tortoise

from app import storage
from app.models import GenerationJob, GenerationResult, Member, MemberKind, SourceImage
from app.settings import settings
from scripts.purge_deleted import purge

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
async def database(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    await Tortoise.init(
        db_url="sqlite://:memory:",
        modules={"models": ["app.models"]},
        _enable_global_fallback=True,
    )
    await Tortoise.generate_schemas()
    monkeypatch.setattr(settings, "r2_endpoint_url", "")
    monkeypatch.setattr(storage, "MEDIA_ROOT", str(tmp_path))
    yield
    await Tortoise.close_connections()


async def _member_with_assets(*, withdrawn: bool, deleted: bool) -> dict:
    member = await Member.create(
        kind=MemberKind.MEMBER,
        withdrawn_at=datetime.now(timezone.utc) if withdrawn else None,
    )
    now = datetime.now(timezone.utc) if deleted else None
    source_key = f"uploads/{uuid.uuid4()}.jpg"
    result_key = f"results/{uuid.uuid4()}.jpg"
    await storage.save_bytes(source_key, b"src", "image/jpeg")
    await storage.save_bytes(result_key, b"res", "image/jpeg")
    source = await SourceImage.create(
        member=member, storage_key=source_key, quality_check={}, deleted_at=now
    )
    job = await GenerationJob.create(
        member=member, source_image=source, idempotency_key=uuid.uuid4(), credit_cost=1
    )
    result = await GenerationResult.create(
        job=job, seq=1, storage_key=result_key, deleted_at=now
    )
    return {"source": source, "result": result}


def _exists(key: str) -> bool:
    return Path(storage.MEDIA_ROOT, key).exists()


async def test_purge_deletes_marked_objects_and_is_idempotent():
    marked = await _member_with_assets(withdrawn=False, deleted=True)
    live = await _member_with_assets(withdrawn=False, deleted=False)

    summary = await purge()

    assert summary == {"source_purged": 1, "result_purged": 1}
    assert not _exists(marked["source"].storage_key)
    assert not _exists(marked["result"].storage_key)
    assert _exists(live["source"].storage_key)
    assert _exists(live["result"].storage_key)
    refreshed = await SourceImage.get(id=marked["source"].id)
    assert refreshed.purged_at is not None

    # 재실행 시 이미 파기된 행은 다시 세지 않는다
    assert await purge() == {"source_purged": 0, "result_purged": 0}


async def test_purge_sweeps_withdrawn_member_assets_without_deleted_at():
    leftover = await _member_with_assets(withdrawn=True, deleted=False)

    summary = await purge()

    # 탈퇴 회원의 레이스 잔여물(deleted_at 없음)도 편입·파기된다
    assert summary == {"source_purged": 1, "result_purged": 1}
    assert not _exists(leftover["source"].storage_key)
    assert not _exists(leftover["result"].storage_key)
    source = await SourceImage.get(id=leftover["source"].id)
    assert source.deleted_at is not None and source.purged_at is not None
