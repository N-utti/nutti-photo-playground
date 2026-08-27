import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import get_current_member
from app.models import GenerationJob, Member, MetricEvent

router = APIRouter(tags=["events"])


class TrackEventRequest(BaseModel):
    event_type: str = Field(min_length=1, max_length=100)
    properties: dict = {}


@router.post("/events", status_code=204)
async def track_event(
    body: TrackEventRequest,
    member: Member = Depends(get_current_member),
):
    job = None
    if raw_job_id := body.properties.get("job_id"):
        try:
            parsed_job_id = uuid.UUID(str(raw_job_id))
        except ValueError:
            pass
        else:
            job = await GenerationJob.get_or_none(id=parsed_job_id, member_id=member.id)

    # ponytail: job_id만 연결하고, style_id 직접 수신은 프론트가 보낼 때 추가한다.
    await MetricEvent.create(
        member_id=member.id,
        event_type=body.event_type,
        job_id=job.id if job is not None else None,
        style_id=job.style_id if job is not None else None,
        meta=body.properties,
    )
