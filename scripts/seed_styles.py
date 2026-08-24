import argparse
import asyncio
import json
import re
from pathlib import Path

from tortoise import Tortoise

from app.models import PromptVersionStatus, Style, StylePromptVersion, StyleStatus
from app.settings import settings
from app.storage import save_bytes


SECTION_MAP = {
    "피규어·장난감": [
        "3D_피규어",
        "레고",
        "프라모델",
        "인형뽑기",
        "스노우볼",
        "띠부씰",
        "이모티콘",
        "미니분신",
        "우리아이굿즈샵",
        "사물코스튬",
    ],
    "컨셉 사진관": [
        "90년대가족사진관",
        "조선시대",
        "르네상스초상화",
        "취업아이",
        "갸루",
        "입덕직캠",
        "견생네컷",
        "거울셀카",
        "어릴적나와우리아이",
        "반려견의인화",
    ],
    "아트": [
        "색연필드로잉",
        "하찮은크레파스",
        "메이플스토리",
        "아이소메트릭방",
        "우리아이라떼아트",
        "괴수",
    ],
    "일상 유머": [
        "식빵",
        "찜질방",
        "청문회",
        "퐁퐁견",
        "호캉스",
        "영화관",
        "새벽에몰래",
        "모래구멍",
        "수중샷",
        "반려견항공샷",
        "손바닥위반려견",
        "왕코클로즈업",
        "유리얼빡샷",
    ],
}

_SECTION_BY_CODE = {
    code: section for section, codes in SECTION_MAP.items() for code in codes
}
_SORT_ORDER_BY_CODE = {
    code: index
    for index, code in enumerate(
        code for codes in SECTION_MAP.values() for code in codes
    )
}
_SEPARATOR_RE = re.compile(r"^.*─{10,}.*$", re.MULTILINE)
_STYLE_INPUTS_PATH = Path(__file__).parent.parent / "seeds/style_inputs.json"
_THUMBNAILS_DIR = Path(__file__).parent.parent / "seeds/thumbnails"


def extract_prompt_body(text: str) -> str:
    matches = list(_SEPARATOR_RE.finditer(text))
    return text[matches[-1].end() :].strip() if matches else ""


async def _seed_thumbnail(code: str) -> list[str] | None:
    """썸네일 업로드 + example_keys 반환. 파일 없으면 None(건드리지 않음)."""
    thumbnail_path = _THUMBNAILS_DIR / f"{code}.jpg"
    if not thumbnail_path.exists():
        print(f"warning: no thumbnail for {code}")
        return None
    key = f"styles/{code}.jpg"
    await save_bytes(key, thumbnail_path.read_bytes(), "image/jpeg")
    return [key]


async def seed_from_dir(dir_path: Path) -> dict[str, int]:
    input_fields_by_code = json.loads(_STYLE_INPUTS_PATH.read_text(encoding="utf-8"))
    files = sorted(dir_path.glob("*.txt"), key=lambda path: path.name)
    fallback_codes = sorted(
        path.stem for path in files if path.stem not in _SORT_ORDER_BY_CODE
    )
    fallback_sort_orders = {
        code: len(_SORT_ORDER_BY_CODE) + index
        for index, code in enumerate(fallback_codes)
    }
    summary = {"created": 0, "skipped": 0}

    for path in files:
        code = path.stem
        body = extract_prompt_body(path.read_text(encoding="utf-8"))
        if not body:
            print(f"error: empty prompt body: {path.name}")
            raise SystemExit(1)

        if await Style.filter(code=code).exists():
            # 기존 행도 input_fields/example_keys는 매니페스트·썸네일 기준으로 백필(멱등)
            update_fields = {"input_fields": input_fields_by_code.get(code, [])}
            example_keys = await _seed_thumbnail(code)
            if example_keys is not None:
                update_fields["example_keys"] = example_keys
            await Style.filter(code=code).update(**update_fields)
            print(f"skip: {code}")
            summary["skipped"] += 1
            continue

        section = _SECTION_BY_CODE.get(code, "일상 유머")
        if code not in _SECTION_BY_CODE:
            print(f"warning: {code} not in SECTION_MAP; using 일상 유머")
        example_keys = await _seed_thumbnail(code)
        style = await Style.create(
            code=code,
            name=code.replace("_", " "),
            section=section,
            credit_cost=1,
            sort_order=(
                _SORT_ORDER_BY_CODE[code]
                if code in _SORT_ORDER_BY_CODE
                else fallback_sort_orders[code]
            ),
            status=StyleStatus.PUBLIC,
            input_fields=input_fields_by_code.get(code, []),
            example_keys=example_keys or [],
        )
        await StylePromptVersion.create(
            style=style,
            version=1,
            prompt_text=body,
            model_config={},
            traffic_weight=100,
            status=PromptVersionStatus.ACTIVE,
        )
        print(f"created: {code}")
        summary["created"] += 1

    return summary


async def run(dir_path: Path) -> None:
    await Tortoise.init(
        db_url=settings.database_url,
        modules={"models": ["app.models"]},
    )
    try:
        summary = await seed_from_dir(dir_path)
    finally:
        await Tortoise.close_connections()
    print(f"created {summary['created']}, skipped {summary['skipped']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", type=Path, default=Path("seeds/prompts"))
    args = parser.parse_args()
    asyncio.run(run(args.dir))


if __name__ == "__main__":
    main()
