import json
import os
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from tortoise import Tortoise

import app.storage as storage
import scripts.seed_styles as seed_styles
from app.models import PromptVersionStatus, Style, StylePromptVersion, StyleStatus
from app.settings import settings
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
    (prompt_dir / "견생네컷.txt").write_text(
        "[사용법]\n──────────\nPrompt with input fields",
        encoding="utf-8",
    )
    (prompt_dir / "미등록_스타일.txt").write_text(
        "[사용법]\n──────────\nFallback prompt",
        encoding="utf-8",
    )

    first = await seed_from_dir(prompt_dir)

    styles = {style.code: style for style in await Style.all()}
    versions = await StylePromptVersion.all()
    assert first == {"created": 4, "skipped": 0}
    assert len(styles) == 4
    assert len(versions) == 4
    assert styles["3D_피규어"].name == "3D 피규어"
    assert styles["3D_피규어"].section == "피규어·장난감"
    assert styles["3D_피규어"].credit_cost == 1
    assert styles["3D_피규어"].sort_order == 0
    assert styles["3D_피규어"].status == StyleStatus.PUBLIC
    assert styles["레고"].sort_order == 1
    assert styles["레고"].status == StyleStatus.PUBLIC
    manifest = json.loads(
        (Path(__file__).parent.parent / "seeds/style_inputs.json").read_text(encoding="utf-8")
    )
    assert styles["견생네컷"].input_fields == manifest["견생네컷"]
    assert styles["레고"].input_fields == []
    assert styles["미등록_스타일"].section == "일상 유머"
    assert styles["미등록_스타일"].sort_order == 39
    assert all(version.version == 1 for version in versions)
    assert all(version.model_config == {} for version in versions)
    assert all(version.traffic_weight == 100 for version in versions)
    assert all(version.status == PromptVersionStatus.ACTIVE for version in versions)
    prompt_version = next(version for version in versions if version.style_id == styles["3D_피규어"].id)
    assert prompt_version.prompt_text == "Draft [pet name] prompt"

    await Style.filter(code="견생네컷").update(input_fields=[])

    second = await seed_from_dir(prompt_dir)

    assert second == {"created": 0, "skipped": 4}
    refreshed = await Style.get(code="견생네컷")
    assert refreshed.input_fields == manifest["견생네컷"]
    assert await Style.all().count() == 4
    assert await StylePromptVersion.all().count() == 4


async def test_seed_from_dir_backfills_thumbnails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    prompt_dir = tmp_path / "prompts"
    prompt_dir.mkdir()
    (prompt_dir / "3D_피규어.txt").write_text(
        "[사용법]\n──────────\nDraft [pet name] prompt",
        encoding="utf-8",
    )
    (prompt_dir / "레고.txt").write_text(
        "[사용법]\n──────────\nPublic prompt (no thumbnail)",
        encoding="utf-8",
    )

    thumbnails_dir = tmp_path / "thumbnails"
    thumbnails_dir.mkdir()
    (thumbnails_dir / "3D_피규어.jpg").write_bytes(b"fake-jpeg-bytes")
    # 레고.jpg는 일부러 만들지 않음: 썸네일 없는 code 케이스

    media_root = tmp_path / "media"
    monkeypatch.setattr(seed_styles, "_THUMBNAILS_DIR", thumbnails_dir)
    monkeypatch.setattr(storage, "MEDIA_ROOT", str(media_root))
    assert settings.r2_endpoint_url == ""  # 로컬 폴백 경로 보장, 실 R2로 안 나감

    await seed_from_dir(prompt_dir)

    figure_style = await Style.get(code="3D_피규어")
    assert figure_style.example_keys == ["styles/3D_피규어.jpg"]
    saved_path = media_root / "styles" / "3D_피규어.jpg"
    assert saved_path.read_bytes() == b"fake-jpeg-bytes"

    lego_style = await Style.get(code="레고")
    assert lego_style.example_keys == []

    # 기존 행 재시딩(멱등) — skip 분기에서도 example_keys 백필되는지 확인
    await Style.filter(code="3D_피규어").update(example_keys=[])

    await seed_from_dir(prompt_dir)

    refreshed_figure = await Style.get(code="3D_피규어")
    assert refreshed_figure.example_keys == ["styles/3D_피규어.jpg"]
    refreshed_lego = await Style.get(code="레고")
    assert refreshed_lego.example_keys == []
