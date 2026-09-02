/**
 * 결과 이미지를 **OS 공유 시트**로 넘깁니다 — 모바일에서 W-06 «공유» 버튼의 실체입니다.
 *
 * 인스타그램은 웹에서 대신 게시할 방법이 없습니다(공개 게시 API 없음). 남은 길은 둘인데,
 * «저장 → 인스타 앱 → 갤러리에서 다시 찾기» 는 왕복이 길고, Web Share API 로 파일을 넘기면
 * iOS·Android 의 공유 시트에 인스타그램(게시물/스토리/DM)이 바로 뜹니다. 데스크톱 브라우저는
 * 파일 공유를 대부분 못 하므로 `canShareImage()` 가 false 면 화면이 기존 저장·열기로 물러납니다.
 *
 * 이미지는 `saveImage` 와 같은 이유로 fetch → blob 을 거칩니다(다른 오리진의 CDN 파일을
 * File 로 만들려면 CORS 가 열려 있어야 함 — 이슈 #77, deploy 문서 §1-3).
 *
 * **받기와 넘기기를 두 함수로 나눈 이유**가 이 파일의 핵심입니다. `navigator.share()` 는
 * 사용자 제스처의 **활성화 창 안에서** 불려야 하는데, 파일을 받아 오는 `await` 가 그 앞에
 * 있으면 창을 넘길 수 있습니다. 그 확률은 PR #215(`cache: 'no-store'` — 캐시 히트가 0)와
 * PR #213(JPEG 품질 92·4:4:4 — 파일이 커짐)이 **함께 올려놨습니다.** 그래서 호출부가
 * `fetchShareFile()` 의 결과를 들고 있다가 다음 탭에서 `shareImage()` 만 부르면, 두 번째
 * 탭은 네트워크 없이 시트가 뜹니다.
 */

/**
 * `'expired'` 는 활성화 창을 넘겨 브라우저가 시트를 거절한 것입니다 — **다시 누르면 됩니다.**
 * `'failed'`(CORS·서버 응답 없음)와 갈라 두는 이유는 물러설 곳이 반대라서입니다: 전자는
 * 같은 버튼을 한 번 더, 후자는 「저장한 뒤 올리기」. 뭉뚱그리면 다시 누르면 될 사람을
 * 저장하러 보내고, 계측에서도 #215 가 고친 CORS 실패와 구분이 안 됩니다.
 *
 * `'unsupported'` 는 없앴습니다. 버튼이 그려졌다는 건 렌더 시점에 `canShareImage()` 가
 * true 였다는 뜻이라, 여기서 다시 false 가 될 수 없는 «영영 안 오는 값» 이었습니다 —
 * 유니언에도 `share_sheet` 이벤트 값에도 남겨 두면 안 밟히는 갈래를 세게 됩니다.
 */
export type ShareImageOutcome = 'shared' | 'cancelled' | 'expired' | 'failed'

/** 이 브라우저가 이미지 파일을 공유 시트로 넘길 수 있는지 — 렌더 시점에 버튼을 보일지 정합니다. */
export function canShareImage(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [new File([new Uint8Array(1)], 'probe.jpg', { type: 'image/jpeg' })] })
  } catch {
    return false
  }
}

/**
 * 공유할 파일을 받아 옵니다. 실패는 `null` — 사유를 나눠도 호출부가 할 일이 같습니다.
 *
 * 호출부는 이 결과를 **들고 있어야 합니다.** 그래야 활성화 만료로 한 번 놓쳐도 다음 탭이
 * 즉시 뜹니다.
 */
export async function fetchShareFile(url: string, filename: string): Promise<File | null> {
  try {
    // 결과 <img> 가 Origin 없이 받아 둔 응답(ACAO 헤더 없음)을 브라우저 캐시가 재사용해
    // CORS 로 죽는다 — 라이브에서 W-06 공유 버튼이 항상 failed 였던 원인. 캐시를 건너뛴다.
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return null
    const blob = await response.blob()
    return new File([blob], filename, { type: blob.type || 'image/jpeg' })
  } catch {
    return null
  }
}

/**
 * 받아 둔 파일을 공유 시트로 넘깁니다. **여기에는 `await` 가 하나뿐이라야 합니다** — 앞에
 * 뭘 더 붙이면 위에서 설명한 활성화 창 문제가 되돌아옵니다.
 */
export async function shareImage(file: File, text: string): Promise<ShareImageOutcome> {
  try {
    await navigator.share({ files: [file], text })
    return 'shared'
  } catch (error) {
    if (!(error instanceof DOMException)) return 'failed'
    // 시트를 닫은 것은 실패가 아닙니다 — 안내를 띄우면 안 됩니다.
    if (error.name === 'AbortError') return 'cancelled'
    // 활성화 창 만료. WebKit 이 던지는 이름이고, 사용자가 할 일은 한 번 더 누르는 것뿐입니다.
    if (error.name === 'NotAllowedError') return 'expired'
    return 'failed'
  }
}
