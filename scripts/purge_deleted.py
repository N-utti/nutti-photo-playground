"""논리삭제(deleted_at)된 자산의 스토리지 실파기 배치 — 06-architecture §4.

탈퇴(#22)·보관함 삭제가 남긴 deleted_at 행의 오브젝트를 삭제하고 purged_at을
기록한다. 탈퇴 회원(withdrawn_at) 자산은 deleted_at 여부와 무관하게 먼저
쓸어담아, 탈퇴 트랜잭션과 업로드·워커 사이의 마이크로 레이스 잔여물을 영구
봉합한다(보안 리뷰 권고).

실행: uv run python scripts/purge_deleted.py  (cron 등 주기 실행 전제)
"""

import asyncio
from datetime import datetime, timezone

from tortoise import Tortoise

from app.models import GenerationJob, GenerationResult, Member, SourceImage
from app.settings import settings
from app.storage import delete_bytes


async def purge(now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)

    # 1) 탈퇴 회원 자산 스윕 — 레이스로 deleted_at을 비껴간 행을 편입
    withdrawn_ids = await Member.filter(withdrawn_at__isnull=False).values_list(
        "id", flat=True
    )
    if withdrawn_ids:
        await SourceImage.filter(
            member_id__in=withdrawn_ids, deleted_at__isnull=True
        ).update(deleted_at=now)
        job_ids = await GenerationJob.filter(member_id__in=withdrawn_ids).values_list(
            "id", flat=True
        )
        if job_ids:
            await GenerationResult.filter(
                job_id__in=job_ids, deleted_at__isnull=True
            ).update(deleted_at=now)

    # 2) 실파기: 오브젝트 삭제 후 purged_at 기록(멱등 — delete_bytes는 없는 키 무시)
    # ponytail: 행 단위 순차 삭제 — 파일럿 규모 전제, 수만 건이면 배치 API로 승격
    summary = {"source_purged": 0, "result_purged": 0}
    for model, counter in ((SourceImage, "source_purged"), (GenerationResult, "result_purged")):
        rows = await model.filter(deleted_at__isnull=False, purged_at__isnull=True)
        for row in rows:
            await delete_bytes(row.storage_key)
            row.purged_at = now
            await row.save(update_fields=["purged_at"])
            summary[counter] += 1

    # ponytail: CDN 캐시 퍼지는 R2/CDN 프로비저닝 후 여기서 Cloudflare API 호출로
    # 활성화(#77과 같은 시점의 운영 작업). 그 전까지 로컬/미캐시 환경이라 불필요.
    return summary


async def run() -> None:
    await Tortoise.init(
        db_url=settings.database_url,
        modules={"models": ["app.models"]},
    )
    try:
        summary = await purge()
    finally:
        await Tortoise.close_connections()
    print(f"purged: source={summary['source_purged']} result={summary['result_purged']}")


if __name__ == "__main__":
    asyncio.run(run())
