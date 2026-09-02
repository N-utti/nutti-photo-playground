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
 */

export type ShareImageOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed'

/** 이 브라우저가 이미지 파일을 공유 시트로 넘길 수 있는지 — 렌더 시점에 버튼을 보일지 정합니다. */
export function canShareImage(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [new File([new Uint8Array(1)], 'probe.jpg', { type: 'image/jpeg' })] })
  } catch {
    return false
  }
}

export async function shareImage(url: string, filename: string, text: string): Promise<ShareImageOutcome> {
  if (!canShareImage()) return 'unsupported'
  let file: File
  try {
    // 결과 <img> 가 Origin 없이 받아 둔 응답(ACAO 헤더 없음)을 브라우저 캐시가 재사용해
    // CORS 로 죽는다 — 라이브에서 W-06 공유 버튼이 항상 failed 였던 원인. 캐시를 건너뛴다.
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return 'failed'
    const blob = await response.blob()
    file = new File([blob], filename, { type: blob.type || 'image/jpeg' })
  } catch {
    return 'failed'
  }
  try {
    await navigator.share({ files: [file], text })
    return 'shared'
  } catch (error) {
    // 시트를 닫은 것은 실패가 아닙니다 — 안내를 띄우면 안 됩니다.
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    return 'failed'
  }
}
