"""운영 감시 — 5분마다 재서 임계를 넘으면 알리고, 풀리면 해소를 알린다.

docs/06 §2.5 확장 계획의 「신호」를 사람이 콘솔을 열어 보지 않아도 되게 하는 자리.
api 프로세스 안에서 돈다(lifespan) — 워커가 죽으면 그게 곧 첫 두 항목으로 드러난다.
ponytail: 상태는 프로세스 메모리(재배포 시 초기화 → 같은 문제가 한 번 더 울릴 수 있다). 그 정도는 감수.
"""

import asyncio
import logging
import shutil
import time
from datetime import datetime, timedelta, timezone

from app.cafe24 import alert_admin
from app.models import CreditLedger, GenerationJob, JobStatus

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 300
REALERT_AFTER_SECONDS = 3600  # 계속 넘고 있으면 1시간마다 다시
QUEUED_STALE_SECONDS = 300
MEM_AVAILABLE_MIN_MB = 300
DISK_FREE_MIN_PCT = 10


def _mem_available_mb() -> int | None:
    # 컨테이너 안에서도 /proc/meminfo 는 호스트 값(cgroup 미제한). 리눅스가 아니면 None.
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) // 1024
    except OSError:
        return None
    return None


async def collect_problems() -> dict[str, str]:
    """임계를 넘은 항목 → 사람이 읽을 설명(다음 손까지). 비어 있으면 정상."""
    now = datetime.now(timezone.utc)
    problems: dict[str, str] = {}

    stale = await GenerationJob.filter(
        status=JobStatus.QUEUED, queued_at__lt=now - timedelta(seconds=QUEUED_STALE_SECONDS)
    ).count()
    if stale:
        problems["대기열 정체"] = f"{stale}건이 5분 넘게 queued — 워커 생존 확인, 정상이면 WORKER_CONCURRENCY 상향(06 §2.5 1단계)"

    expired = await GenerationJob.filter(status=JobStatus.PROCESSING, lease_expires_at__lt=now).count()
    if expired:
        problems["리스 만료 잡"] = f"{expired}건이 processing 인 채 리스 만료 — 워커가 죽었거나 멈춤(docker compose ps worker)"

    since = now - timedelta(hours=24)
    failed_ids = [
        str(job_id)
        for job_id in await GenerationJob.filter(status=JobStatus.FAILED, queued_at__gte=since).values_list("id", flat=True)
    ]
    if failed_ids:
        refunded = set(
            await CreditLedger.filter(
                ref_id__in=failed_ids, reason__in=["generation_refund", "safety_block_refund"]
            ).values_list("ref_id", flat=True)
        )
        missing = [job_id for job_id in failed_ids if job_id not in refunded]
        if missing:
            problems["실패-미환불"] = f"{len(missing)}건 (24h) — 예: {missing[0]} · 관리자 콘솔 크레딧 탭에서 수동 조정"

    mem = _mem_available_mb()
    if mem is not None and mem < MEM_AVAILABLE_MIN_MB:
        problems["메모리 부족"] = f"가용 {mem}MB < {MEM_AVAILABLE_MIN_MB}MB — docker stats 확인, 지속되면 VPS 4GB(06 §2.5 3단계)"

    usage = shutil.disk_usage("/")
    free_pct = usage.free * 100 // usage.total
    if free_pct < DISK_FREE_MIN_PCT:
        problems["디스크 부족"] = f"여유 {free_pct}% — docker system prune, 로그 회전 확인"

    return problems


async def run_monitor_loop() -> None:
    active: dict[str, float] = {}  # 항목 → 마지막 알림 시각(monotonic)
    while True:
        try:
            problems = await collect_problems()
            now = time.monotonic()
            due = [name for name in problems if now - active.get(name, -REALERT_AFTER_SECONDS - 1) > REALERT_AFTER_SECONDS]
            if due:
                text = "🚨 누띠 감시\n" + "\n".join(f"- {name}: {problems[name]}" for name in due)
                logger.warning(text)
                await alert_admin(text)
                for name in due:
                    active[name] = now
            recovered = [name for name in active if name not in problems]
            if recovered:
                await alert_admin("✅ 누띠 감시 해소: " + ", ".join(recovered))
                for name in recovered:
                    del active[name]
        except Exception:
            logger.exception("monitor tick failed")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
