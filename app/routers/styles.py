import hashlib
import json

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel

from app.models import PromptVersionStatus, Style, StylePromptVersion, StyleStatus
from app.storage import public_url

router = APIRouter(prefix="/styles", tags=["styles"])


class StyleSummary(BaseModel):
    id: int
    code: str
    name: str
    thumbnail_url: str | None
    credit_cost: int
    uses_pet_name: bool
    uses_breed: bool
    input_fields: list


class StyleSection(BaseModel):
    name: str
    count: int
    styles: list[StyleSummary]


class StyleListResponse(BaseModel):
    sections: list[StyleSection]
    total_count: int


class StyleDetailResponse(BaseModel):
    id: int
    code: str
    name: str
    credit_cost: int
    examples: list[str]
    fit_tags: list[dict[str, str]]
    avg_duration_seconds: int
    output_count: int
    uses_pet_name: bool
    uses_breed: bool
    input_fields: list


@router.get("", response_model=StyleListResponse)
async def list_styles(
    request: Request,
    response: Response,
    section: str | None = None,
    limit: int | None = Query(default=None, ge=0),
):
    public_styles = await Style.filter(status=StyleStatus.PUBLIC).order_by("sort_order", "id")
    total_count = len(public_styles)
    prompt_flags = {
        style.id: {"uses_pet_name": False, "uses_breed": False} for style in public_styles
    }
    active_prompts = await StylePromptVersion.filter(
        style_id__in=[style.id for style in public_styles],
        status=PromptVersionStatus.ACTIVE,
    ).values("style_id", "prompt_text")
    # ACTIVE A/B versions can coexist, so each flag uses any matching prompt.
    for prompt in active_prompts:
        flags = prompt_flags[prompt["style_id"]]
        flags["uses_pet_name"] |= "[pet name]" in prompt["prompt_text"]
        flags["uses_breed"] |= "[breed]" in prompt["prompt_text"]
    if section == "popular":
        # ponytail: popular은 예약 키워드, 별도 컬럼/플래그 없이 sort_order 재사용
        grouped = {"인기": public_styles[: limit if limit is not None else 12]}
    else:
        if section is not None:
            public_styles = [style for style in public_styles if style.section == section]

        grouped: dict[str, list[Style]] = {}
        for style in public_styles:
            grouped.setdefault(style.section, []).append(style)

    body = StyleListResponse(
        sections=[
            StyleSection(
                name=name,
                count=len(styles),
                styles=[
                    StyleSummary(
                        id=style.id,
                        code=style.code,
                        name=style.name,
                        thumbnail_url=(
                            public_url(style.example_keys[0]) if style.example_keys else None
                        ),
                        credit_cost=style.credit_cost,
                        input_fields=style.input_fields,
                        **prompt_flags[style.id],
                    )
                    for style in (styles[:limit] if limit is not None else styles)
                ],
            )
            for name, styles in grouped.items()
        ],
        total_count=total_count,
    )
    serialized = json.dumps(
        body.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    etag = f'"{hashlib.sha256(serialized).hexdigest()}"'
    if request.headers.get("If-None-Match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    response.headers["ETag"] = etag
    return body


@router.get("/{style_id}", response_model=StyleDetailResponse)
async def get_style(style_id: int):
    style = await Style.get_or_none(id=style_id)
    # ponytail: draft is pre-publication content, so exposing only public/AB is the safe default without preview auth.
    if style is None or style.status not in (StyleStatus.PUBLIC, StyleStatus.AB):
        raise HTTPException(
            status_code=404,
            detail={"code": "NOT_FOUND", "message": "Style not found", "detail": {}},
        )
    prompt_texts = await StylePromptVersion.filter(
        style_id=style.id,
        status=PromptVersionStatus.ACTIVE,
    ).values_list("prompt_text", flat=True)
    return StyleDetailResponse(
        id=style.id,
        code=style.code,
        name=style.name,
        credit_cost=style.credit_cost,
        examples=[public_url(key) for key in style.example_keys],
        fit_tags=style.fit_tags,
        avg_duration_seconds=style.avg_seconds,
        output_count=style.output_count,
        uses_pet_name=any("[pet name]" in prompt for prompt in prompt_texts),
        uses_breed=any("[breed]" in prompt for prompt in prompt_texts),
        input_fields=style.input_fields,
    )
