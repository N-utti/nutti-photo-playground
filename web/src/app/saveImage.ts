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
 * 결과는 항상 JPEG 이라(`app/worker.py` `save_bytes(..., "image/jpeg")`) 확장자는
 * 호출부가 `.jpg` 로 붙입니다.
 */
export type SaveImageOutcome = 'saved' | 'opened'

export async function saveImage(url: string, filename: string): Promise<SaveImageOutcome> {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(String(response.status))
    const objectUrl = URL.createObjectURL(await response.blob())
    clickAnchor(objectUrl, filename)
    // 클릭 직후에 취소하면 저장이 시작되기 전에 URL 이 죽는 브라우저가 있어서 넉넉히 둡니다.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    return 'saved'
  } catch {
    clickAnchor(url, filename, { newTab: true })
    return 'opened'
  }
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
