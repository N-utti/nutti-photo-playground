/**
 * `role="dialog"` 를 선언한 곳이 **하나도 빠짐없이** 모달 계약을 지키는지 — 소스 수준에서.
 *
 * 옆의 `useModalDialog.test.tsx` 는 시트를 실제로 렌더해서 «뒤로 새는가» 를 묻습니다.
 * 그쪽이 본 검사이고 이 파일은 본 검사에 **들어오지 않은 시트**를 잡습니다. 둘은 겹치지
 * 않습니다 — 렌더 검사는 `CASES` 에 적힌 것만 보고, 적는 건 사람이 하기 때문입니다.
 *
 * 이슈 #94 가 그 구멍을 미리 적어 뒀는데도 그대로 재발했습니다. PR #93 이 로그인 시트와
 * 402 오버레이를 고치고 «새 시트를 만들면 CASES 에 한 줄 추가하세요» 라고 남겼지만, 그
 * 뒤로 생긴 확인 창 셋(로그아웃 · 보관함 삭제 · 마이페이지)은 전부 등록되지 않았고
 * 전부 `aria-modal="true"` 만 선언한 채 아무것도 가두지 않았습니다. 되돌릴 수 없는
 * 동작을 확인받는 창인데 Tab 한 번이면 포커스가 뒤 화면으로 나갑니다.
 *
 * 사람이 «추가를 깜빡했다» 로 실패하는 규칙은 규칙이 아닙니다. 그래서 여기서는 등록을
 * 기다리지 않고 **소스를 직접 훑습니다.** 새 시트가 어디에 생기든, `role="dialog"` 를
 * 쓰는 순간 이 테스트의 대상이 됩니다.
 *
 * `import.meta.glob` 을 쓰는 이유는 `node:fs` 를 피하려는 것입니다 — `tsconfig.app.json`
 * 의 `types` 는 `["vite/client"]` 뿐이고, 그 안에 이 API 의 타입이 이미 있습니다.
 */

import { describe, expect, it } from 'vitest'

/** src 전체의 컴포넌트 원문. `?raw` 라 평가되지 않고 문자열로만 들어옵니다. */
const sources = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>

/**
 * `role="dialog"` 를 **직접** 쓴 컴포넌트.
 *
 * 공용 `ConfirmDialog` 를 쓰는 쪽은 여기 안 걸립니다 — 자기 마크업에 dialog 가 없으니까요.
 * 그게 맞습니다. 계약을 지고 있는 건 껍데기를 실제로 그리는 파일 하나뿐이고,
 * 그 파일이 이 목록에 남아 검사를 받습니다.
 */
const dialogSources = Object.entries(sources)
  .filter(([path]) => !path.endsWith('.test.tsx'))
  .filter(([, source]) => source.includes('role="dialog"'))
  // glob 키(`../screens/X.tsx` · 같은 폴더면 `./X.tsx`)를 실패 메시지에서 바로 열 수 있는 경로로.
  .map(([path, source]) => [path.replace(/^\.\//, 'src/app/').replace(/^\.\.\//, 'src/'), source] as const)

describe('role="dialog" 를 선언한 곳', () => {
  it('적어도 하나는 찾는다', () => {
    /*
      glob 이 조용히 빗나가면(경로 오타 · 확장자 변경) 아래 검사가 0건을 돌면서 전부
      통과합니다. «검사할 게 없어서 통과» 와 «다 지켜서 통과» 는 결과가 같아 구분되지
      않으므로, 목록이 비지 않았다는 것부터 확인합니다.
    */
    expect(dialogSources.length).toBeGreaterThan(0)
  })

  it.each(dialogSources)('%s 는 useModalDialog 로 실제 가둠을 건다', (_path, source) => {
    /*
      `aria-modal="true"` 는 보조기술에 대한 **선언**일 뿐이라 브라우저가 강제해 주는 게
      없습니다(app/useModalDialog.ts 헤더). 선언만 있고 가둠이 없으면 마우스로는 아무
      차이가 없어 화면은 멀쩡해 보이고, 키보드에서만 드러납니다.
    */
    expect(source).toMatch(/useModalDialog[<(]/)
  })

  it.each(dialogSources)('%s 의 dialog 는 tabIndex={-1} 로 포커스를 받는다', (_path, source) => {
    /*
      훅이 열자마자 `dialog.focus()` 를 부르는데, 받을 수 있으려면 dialog 자신이 포커스
      대상이어야 합니다. 빠지면 포커스가 body 에 남고 — 훅을 붙였는데도 — 첫 Tab 이
      그대로 뒤 화면으로 나갑니다. 훅을 부른 것만으로는 안 되는 유일한 조건이라
      따로 셉니다.
    */
    expect(source).toContain('tabIndex={-1}')
  })
})
