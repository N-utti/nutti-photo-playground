/**
 * 앵커 id 규칙 (screens/sectionAnchor.ts).
 *
 * 막으려는 것은 «칩을 눌렀는데 아무 일도 안 일어나는» 상태입니다. 그 상태는 화면에
 * 오류로 나타나지 않고 **보던 자리에 그대로 머무는** 것으로만 나타나므로, 브라우저로
 * 눌러 보는 사람 입장에서는 «다른 섹션이 나왔다» 로 보입니다.
 *
 * jsdom 은 실제 스크롤을 하지 않으니 여기서는 «두 값이 갈라질 수 있는 이름» 만 훑고,
 * 실제로 같은 값을 쓰는지는 W02StyleCatalog.test.tsx 가 렌더된 DOM 에서 확인합니다.
 */

import { describe, expect, it } from 'vitest'
import { sectionAnchorIds } from './sectionAnchor'

describe('섹션 앵커 id', () => {
  it('공백뿐인 차이는 id 를 흔들지 않는다', () => {
    // 셋 다 URL 파서가 손대는 이름입니다 — 꼬리 공백은 잘리고, 탭·개행은 제거됩니다.
    expect(sectionAnchorIds(['여름 '])).toEqual(['section-여름'])
    expect(sectionAnchorIds(['  겨울'])).toEqual(['section-겨울'])
    expect(sectionAnchorIds(['가을\t한정'])).toEqual(['section-가을-한정'])
    expect(sectionAnchorIds(['봄\n특집'])).toEqual(['section-봄-특집'])
  })

  it('URL 이 건드리지 않는 글자는 그대로 둔다', () => {
    // 실제 시드 섹션명(scripts/seed_styles.py)입니다. 가운뎃점·& · % 는 프래그먼트에서
    // 멀쩡히 살아남으므로 굳이 바꿔서 주소를 못 읽게 만들 이유가 없습니다.
    expect(sectionAnchorIds(['피규어·장난감', '키즈&펫', '50%할인'])).toEqual([
      'section-피규어·장난감',
      'section-키즈&펫',
      'section-50%할인',
    ])
  })

  it('공백을 접은 뒤 겹치는 이름을 갈라 놓는다', () => {
    // 서버 응답에서 이름 자체는 유일하지만("여름 한정" ≠ "여름  한정"), 접고 나면
    // 같아집니다. 같은 id 가 둘이면 뒤엣것은 영영 도달할 수 없습니다.
    expect(sectionAnchorIds(['여름 한정', '여름  한정'])).toEqual([
      'section-여름-한정',
      'section-여름-한정-1',
    ])
  })

  it('이름이 공백뿐이어도 서로 다른 id 를 준다', () => {
    expect(sectionAnchorIds([' ', ''])).toEqual(['section-0', 'section-1'])
  })
})
