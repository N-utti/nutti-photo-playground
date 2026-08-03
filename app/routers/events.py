from fastapi import APIRouter
from pydantic import BaseModel

from app.common import not_implemented

router = APIRouter(tags=["events"])


class TrackEventRequest(BaseModel):
    event_type: str
    properties: dict = {}


@router.post("/events", status_code=204)
async def track_event(body: TrackEventRequest):
    not_implemented()
