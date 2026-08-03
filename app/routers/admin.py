from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from app.common import not_implemented

router = APIRouter(prefix="/admin", tags=["admin"])


class CreateStyleRequest(BaseModel):
    code: str
    name: str
    section: str
    credit_cost: int = 1
    output_count: int = 4
    avg_seconds: int = 24
    progress_message: str | None = None
    fit_tags: list = []
    example_keys: list = []


class UpdateStyleRequest(BaseModel):
    status: str | None = None
    name: str | None = None
    section: str | None = None
    credit_cost: int | None = None
    sort_order: int | None = None
    progress_message: str | None = None
    fit_tags: list | None = None
    example_keys: list | None = None


class CreatePromptVersionRequest(BaseModel):
    # ponytail: pydantic reserves `model_config` as a BaseModel ClassVar, so the field
    # is declared under a different name and aliased back to the API spec's JSON key.
    model_config = ConfigDict(populate_by_name=True)

    prompt_text: str
    prompt_model_config: dict = Field(default_factory=dict, alias="model_config")
    traffic_weight: int = 100


class UpdatePromptVersionRequest(BaseModel):
    status: str | None = None
    traffic_weight: int | None = None


class PromoteCustomPromptRequest(BaseModel):
    section: str
    credit_cost: int = 1


class AdjustCreditsRequest(BaseModel):
    member_id: str
    amount: int
    dedupe_key: str
    reason: str


class UpdateSettingRequest(BaseModel):
    value: object


@router.get("/styles")
async def admin_list_styles():
    not_implemented()


@router.post("/styles", status_code=201)
async def admin_create_style(body: CreateStyleRequest):
    not_implemented()


@router.patch("/styles/{style_id}")
async def admin_update_style(style_id: int, body: UpdateStyleRequest):
    not_implemented()


@router.delete("/styles/{style_id}")
async def admin_retire_style(style_id: int):
    not_implemented()


@router.get("/styles/{style_id}/prompt-versions")
async def admin_list_prompt_versions(style_id: int):
    not_implemented()


@router.post("/styles/{style_id}/prompt-versions", status_code=201)
async def admin_create_prompt_version(style_id: int, body: CreatePromptVersionRequest):
    not_implemented()


@router.patch("/styles/{style_id}/prompt-versions/{version_id}")
async def admin_update_prompt_version(style_id: int, version_id: int, body: UpdatePromptVersionRequest):
    not_implemented()


@router.get("/custom-prompts/top")
async def admin_top_custom_prompts():
    not_implemented()


@router.post("/custom-prompts/{prompt_id}/promote", status_code=201)
async def admin_promote_custom_prompt(prompt_id: str, body: PromoteCustomPromptRequest):
    not_implemented()


@router.post("/credits/adjust")
async def admin_adjust_credits(body: AdjustCreditsRequest):
    not_implemented()


@router.get("/cafe24/status")
async def admin_cafe24_status():
    not_implemented()


@router.get("/settings")
async def admin_get_settings():
    not_implemented()


@router.patch("/settings/{key}")
async def admin_update_setting(key: str, body: UpdateSettingRequest):
    not_implemented()
