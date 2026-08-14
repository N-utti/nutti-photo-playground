import os
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from tortoise import Tortoise

from app.models import PromptVersionStatus, Style, StylePromptVersion, StyleStatus
from conftest import reset_tortoise_executor_cache
from scripts.seed_styles import extract_prompt_body, seed_from_dir


@pytest.fixture(autouse=True)
async def database():
    reset_tortoise_executor_cache()
    await Tortoise.init(
        db_url="sqlite://:memory:",
        modules={"models": ["app.models"]},
        _enable_global_fallback=True,
    )
    await Tortoise.generate_schemas()
    yield
    await Tortoise.close_connections()


def test_extract_prompt_body(tmp_path: Path):
    prompt_file = tmp_path / "sample.txt"
    prompt_file.write_text(
        "[사용법]\n설명\n──────────────────────\n한국어 지시문\n"
        "──────────────────────\n  final [pet name] prompt  \n",
        encoding="utf-8",
    )

    body = extract_prompt_body(prompt_file.read_text(encoding="utf-8"))

    assert body == "final [pet name] prompt"
    assert extract_prompt_body("[사용법]\n──────────\n   \n") == ""


async def test_seed_from_dir_creates_records_and_is_idempotent(tmp_path: Path):
    prompt_dir = tmp_path / "prompts"
    prompt_dir.mkdir()
    (prompt_dir / "3D_피규어.txt").write_text(
        "[사용법]\n──────────\nDraft [pet name] prompt",
        encoding="utf-8",
    )
    (prompt_dir / "레고.txt").write_text(
        "[사용법]\n──────────\nPublic prompt",
        encoding="utf-8",
    )
    (prompt_dir / "미등록_스타일.txt").write_text(
        "[사용법]\n──────────\nFallback prompt",
        encoding="utf-8",
    )

    first = await seed_from_dir(prompt_dir)

    styles = {style.code: style for style in await Style.all()}
    versions = await StylePromptVersion.all()
    assert first == {"created": 3, "skipped": 0}
    assert len(styles) == 3
    assert len(versions) == 3
    assert styles["3D_피규어"].name == "3D 피규어"
    assert styles["3D_피규어"].section == "피규어·장난감"
    assert styles["3D_피규어"].credit_cost == 1
    assert styles["3D_피규어"].sort_order == 0
    assert styles["3D_피규어"].status == StyleStatus.PUBLIC
    assert styles["레고"].sort_order == 1
    assert styles["레고"].status == StyleStatus.PUBLIC
    assert styles["미등록_스타일"].section == "일상 유머"
    assert styles["미등록_스타일"].sort_order == 39
    assert all(version.version == 1 for version in versions)
    assert all(version.model_config == {} for version in versions)
    assert all(version.traffic_weight == 100 for version in versions)
    assert all(version.status == PromptVersionStatus.ACTIVE for version in versions)
    prompt_version = next(version for version in versions if version.style_id == styles["3D_피규어"].id)
    assert prompt_version.prompt_text == "Draft [pet name] prompt"

    second = await seed_from_dir(prompt_dir)

    assert second == {"created": 0, "skipped": 3}
    assert await Style.all().count() == 3
    assert await StylePromptVersion.all().count() == 3
