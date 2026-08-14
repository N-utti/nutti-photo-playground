/**
 * 앵커바 칩의 `href` 와 섹션의 `id` 가 **같은 문자열**을 보게 만드는 한 곳.
 *
 * 원래는 둘 다 `` `section-${섹션명}` `` 이었습니다. 같은 식이니 같은 값이 나올 것
 * 같지만, 그 사이에 **URL 파서**가 끼어듭니다 — `href` 는 URL 이라 브라우저가 값을
 * 정규화하고, `id` 는 속성 문자열이라 손대지 않습니다. 그래서 섹션명이 이렇게 오면
 * 두 값이 갈라집니다:
 *
 *   "여름 "   → href 의 꼬리 공백은 URL 로 파싱될 때 잘립니다  → #section-여름
 *   "봄\n특집" → 개행·탭은 URL 안 어디에 있든 통째로 제거됩니다 → #section-봄특집
 *
 * `id` 쪽은 공백·개행을 그대로 들고 있으므로 `getElementById` 가 빗나가고, 브라우저는
 * **아무 데로도 스크롤하지 않습니다**. 화면은 보던 자리에 그대로 남고, 사용자에게는
 * «인기를 눌렀는데 여름 스타일이 나온다» 로 보입니다. 클릭이 씹혔다는 신호가 어디에도
 * 없다는 게 이 결함의 고약한 점입니다 — 콘솔도 조용하고 주소창만 바뀝니다.
 *
 * 섹션명은 서버가 주는 자유 텍스트입니다(`style.section` TEXT, docs/04-erd.md). 운영이
 * 어딘가에서 이름을 복사해 붙이면 꼬리 공백은 언제든 들어옵니다. 그래서 «그런 이름이
 * 안 들어오게 하자» 가 아니라 **어떤 문자열이 와도 두 값이 같게** 만듭니다.
 */

/** id 로 쓸 수 없는 공백류(스페이스·탭·개행)를 앞뒤로 자르고 안쪽은 `-` 로 접습니다. */
function slugify(name: string): string {
  return name.trim().replace(/\s+/g, '-')
}

/**
 * 섹션 이름 목록을 그대로 앵커 id 목록으로 바꿉니다. 칩과 섹션이 **같은 배열의 같은
 * 자리**를 읽게 해서, 한쪽만 규칙이 바뀌는 일이 생기지 않게 합니다.
 *
 * 중복 처리가 필요한 이유: 서버 응답에서 섹션명 자체는 유일하지만(`GET /v1/styles` 가
 * 이름으로 묶습니다), 공백을 접고 나면 "여름 한정" 과 "여름  한정" 이 같은 값이 됩니다.
 * 같은 id 가 둘이면 뒤엣것은 영영 못 가므로 — 원래 고치려던 그 증상입니다 — 순번을
 * 붙여 가릅니다.
 *
 * 이름이 공백뿐이면 슬러그가 비는데, `id="section-"` 두 개가 만들어지는 것보다
 * 순번으로 대신하는 편이 낫습니다.
 */
export function sectionAnchorIds(names: readonly string[]): string[] {
  const used = new Set<string>()

  return names.map((name, index) => {
    const slug = slugify(name)
    const base = `section-${slug === '' ? index : slug}`
    if (!used.has(base)) {
      used.add(base)
      return base
    }
    // 순번은 배열 안에서 유일하므로 한 번 붙이면 반드시 갈립니다.
    const unique = `${base}-${index}`
    used.add(unique)
    return unique
  })
}
