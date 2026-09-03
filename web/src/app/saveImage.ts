/**
 * 결과 이미지를 파일로 저장 (이슈 #77, PR #78).
 *
 * `<a download>` 은 **같은 출처**(그리고 `data:`·`blob:`)에서만 동작합니다. 크로스
 * 오리진이면 브라우저가 속성을 조용히 무시하고 그 URL 로 이동해서, «저장» 버튼이
 * 이미지 페이지 이동이 됩니다. `CDN_BASE_URL` 이 설정되면 결과 이미지가 바로 그
 * 크로스 오리진이 되고(`app/storage.py` `public_url`), 지금은 비어 있어
 * `/media/{key}` 라 로컬·목에서만 멀쩡한 — 배포 시점에 조용히 깨지는 종류입니다.
 *
 * 그래서 URL 을 앵커에 그대로 물리지 않고 fetch → blob → `blob:` URL 로 바꿔서
 * 저장합니다. `blob:` 은 언제나 같은 출처라 `download` 가 먹습니다. 대신 이 경로는
 * 이미지 응답에 `Access-Control-Allow-Origin` 이 있어야 하고, PR #78 이 그것을
 * `CDN_BASE_URL` 의 필수 조건으로 배포 문서에 박아 뒀습니다.
 *
 * **이슈 #77 이 닫혀도 이 파일을 지우고 `<a download>` 로 돌아가면 안 됩니다.** CORS 는
 * 위의 fetch 를 허용할 뿐, 교차 출처에서 무시되는 `download` 속성을 되살리지 않습니다
 * (브라우저가 속성 자체를 없는 것으로 칩니다). 되돌리면 #77 이 고치려던 버그가 그대로
 * 재발합니다 — 이 경로는 임시 우회가 아니라 교차 출처에서 유일하게 저장이 되는 길입니다.
 *
 * 그럼에도 CORS 가 아직 안 열린 버킷을 만나면 fetch 는 실패합니다. 그때는 예전
 * 동작(새 탭으로 이미지 열기)으로 물러납니다 — 길게 눌러 저장할 수는 있으니
 * 아무 일도 안 일어나는 것보다 낫습니다. 어느 쪽으로 끝났는지 돌려주는 이유는
 * 화면이 그 경우에만 안내 문구를 띄우기 위해서입니다.
 *
 * **다만 «실패» 를 한 덩어리로 보면 안 됩니다.** 서버가 응답을 준 실패(404 · 403 ·
 * 만료된 서명)와 응답 자체가 없는 실패(CORS 차단 · 오프라인)는 물러설 곳이 다릅니다.
 * 전자에서 새 탭을 열면 오류 페이지가 뜨는데 화면은 «길게 눌러 저장하세요» 라고
 * 안내하게 됩니다 — 사용자는 시키는 대로 하다가 저장할 게 없다는 걸 알게 됩니다.
 * 그래서 셋으로 나눠 돌려줍니다: 저장됨 · 열었음 · 못 함.
 *
 * 결과는 항상 JPEG 이라(`app/worker.py` `save_bytes(..., "image/jpeg")`) 확장자는
 * 호출부가 `.jpg` 로 붙입니다.
 */
export type SaveImageOutcome = 'saved' | 'opened' | 'failed'

export async function saveImage(url: string, filename: string): Promise<SaveImageOutcome> {
  let response: Response
  try {
    // shareImage 와 같은 이유 — <img> 가 캐시한 무-CORS 응답을 피해 네트워크로 간다.
    response = await fetch(url, { cache: 'no-store' })
  } catch {
    /*
      응답이 아예 없는 경우 — CORS 차단이거나 네트워크가 끊긴 경우입니다. 둘을
      구분할 방법은 없습니다(CORS 실패는 브라우저가 일부러 사유를 숨깁니다).
      CORS 쪽이라면 이미지 자체는 멀쩡해서 새 탭으로 열면 보이므로, 되는 쪽에
      걸고 예전 동작으로 물러납니다.
    */
    clickAnchor(url, filename, { newTab: true })
    return 'opened'
  }

  // 서버가 «못 준다» 고 답했습니다. 새 탭을 열어도 같은 오류 페이지라 열지 않습니다.
  if (!response.ok) return 'failed'

  try {
    const objectUrl = URL.createObjectURL(await response.blob())
    clickAnchor(objectUrl, filename)
    // 클릭 직후에 취소하면 저장이 시작되기 전에 URL 이 죽는 브라우저가 있어서 넉넉히 둡니다.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    return 'saved'
  } catch {
    // 본문을 받다가 끊긴 경우. 헤더는 200 이었으니 새 탭도 같은 자리에서 끊깁니다.
    return 'failed'
  }
}

/**
 * 서버가 준 **첨부 주소**(`download_url`, `Content-Disposition: attachment`)로 이동해 저장합니다.
 *
 * fetch → blob 을 거치지 않는 이유가 이 함수의 존재 이유입니다 — 카톡·인스타 Android
 * 웹뷰는 `blob:` 을 파일로 만들지 않지만(«다운로드 중» 토스트만 뜨고 끝), 응답 헤더로
 * 오는 첨부는 카카오 공식 FAQ 가 안내하는 경로라 iOS·Android 웹뷰 모두 기기에 파일을
 * 남깁니다(2026-09-03 조사). 그래서 «이미지 저장» 이 어느 브라우저에서나 같은 결과가 됩니다.
 * 결과를 돌려주지 못하는 건 이동식 다운로드의 한계 — 시작했다는 것까지만 압니다.
 */
export function downloadAttachment(downloadUrl: string, filename: string): void {
  clickAnchor(downloadUrl, filename)
}

/**
 * `newTab` 은 물러선 경로에서만 켭니다. 원본 URL 로 이동할 때 현재 탭이 이미지로
 * 바뀌면 만들던 흐름이 통째로 날아가기 때문입니다. blob 경로에서는 반대로 켜면
 * 안 됩니다 — 저장 대신 새 탭이 열리는 브라우저가 있습니다.
 */
function clickAnchor(href: string, filename: string, options?: { newTab: boolean }): void {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  if (options?.newTab) {
    anchor.target = '_blank'
    anchor.rel = 'noopener'
  }
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}
