"""논리삭제(deleted_at)된 자산의 스토리지 실파기 배치 — 06-architecture §4.

탈퇴(#22)·보관함 삭제가 남긴 deleted_at 행의 오브젝트를 삭제하고 purged_at을
기록한다. 탈퇴 회원(withdrawn_at) 자산은 deleted_at 여부와 무관하게 먼저
쓸어담아, 탈퇴 트랜잭션과 업로드·워커 사이의 마이크로 레이스 잔여물을 영구
봉합한다(보안 리뷰 권고). 만료 게스트(`guest_expires_at` 경과, 미병합)의 자산도
같은 스윕에 들어간다(04-erd §4 — 30일 보존). metric_event 는 90일 지난 행을 지운다.
ponytail: 만료 게스트 member 행 자체는 남긴다 — 지우면 CASCADE 로 metric_event·job 집계가
같이 사라진다. 행이 무거워지면 자산 purge 뒤 90일에 삭제하는 단계를 붙인다.

실행: uv run python scripts/purge_deleted.py  (cron 등 주기 실행 전제)
"""

import asyncio
from datetime import datetime, timedelta, timezone

from tortoise import Tortoise

from app.models import GenerationJob, GenerationResult, Member, MemberKind, MetricEvent, SourceImage
from app.settings import settings
from app.storage import delete_bytes


METRIC_EVENT_RETENTION = timedelta(days=90)  # 04-erd §4


async def purge(now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)

    # 1) 탈퇴 회원 + 만료 게스트 자산 스윕 — 레이스로 deleted_at을 비껴간 행을 편입.
    #    병합된 게스트(merged_into)는 자산이 회원에게 이관돼 있어 제외.
    withdrawn_ids = list(await Member.filter(withdrawn_at__isnull=False).values_list("id", flat=True))
    expired_guest_ids = list(
        await Member.filter(
            kind=MemberKind.GUEST, guest_expires_at__lt=now, merged_into_id__isnull=True, withdrawn_at__isnull=True
        ).values_list("id", flat=True)
    )
    swept_ids = withdrawn_ids + expired_guest_ids
    if swept_ids:
        await SourceImage.filter(
            member_id__in=swept_ids, deleted_at__isnull=True
        ).update(deleted_at=now)
        job_ids = await GenerationJob.filter(member_id__in=swept_ids).values_list(
            "id", flat=True
        )
        if job_ids:
            await GenerationResult.filter(
                job_id__in=job_ids, deleted_at__isnull=True
            ).update(deleted_at=now)

    # 2) 실파기: 오브젝트 삭제 후 purged_at 기록(멱등 — delete_bytes는 없는 키 무시)
    # ponytail: 행 단위 순차 삭제 — 파일럿 규모 전제, 수만 건이면 배치 API로 승격
    summary = {"source_purged": 0, "result_purged": 0, "expired_guests": len(expired_guest_ids)}
    for model, counter in ((SourceImage, "source_purged"), (GenerationResult, "result_purged")):
        rows = await model.filter(deleted_at__isnull=False, purged_at__isnull=True)
        for row in rows:
            await delete_bytes(row.storage_key)
            row.purged_at = now
            await row.save(update_fields=["purged_at"])
            summary[counter] += 1

    # 3) metric_event 보존 90일 — 집계는 운영 콘솔·GA4 가 그 안에서 본다
    summary["metric_deleted"] = await MetricEvent.filter(created_at__lt=now - METRIC_EVENT_RETENTION).delete()

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
    print(
        f"purged: source={summary['source_purged']} result={summary['result_purged']} "
        f"expired_guests={summary['expired_guests']} metric_deleted={summary['metric_deleted']}"
    )


if __name__ == "__main__":
    asyncio.run(run())
