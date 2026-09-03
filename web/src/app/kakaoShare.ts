/**
 * 카카오톡 공유 — 카카오 JS SDK 의 `Kakao.Share.sendDefault` (피드 카드).
 *
 * 왜 필요한가 — Android 웹뷰(카톡 인앱 포함)에는 OS 공유 시트가 없어 「공유」가 자체 시트로
 * 물러났는데(app/ShareFallbackSheet.tsx), 카톡으로 받은 링크에서 만든 사진을 카톡으로 다시
 * 보내는 게 실제로 가장 많은 공유 경로입니다. SDK 는 카톡 웹뷰에서는 카카오링크 스킴으로
 * **친구 선택창**을, 모바일 브라우저에서는 카톡 앱을, PC 에서는 팝업 피커를 엽니다 —
 * SDK 없는 sharer.kakao.com 주소는 앱 키 없이 401 이라(2026-09-03 실측) 이 길뿐입니다.
 *
 * 전제(콘솔): [앱] › [플랫폼 키] › **JavaScript 키** 를 `VITE_KAKAO_JS_KEY` 에, 같은 화면의
 * **JavaScript SDK 도메인**에 `https://play.nutti.co.kr` 등록. 링크(webUrl)의 도메인도 등록된
 * 것이어야 카카오가 카드를 받아 줍니다. 키가 없으면(`kakaoShareAvailable()` false) 화면은
 * 항목을 그리지 않습니다 — 로컬 개발이 그 경우입니다.
 *
 * SDK 는 87KB 라 첫 화면에 얹지 않고 **공유 화면이 뜰 때** 미리 내려받습니다(`loadKakao`).
 * 누른 순간에 내려받으면 PC 의 팝업 차단(사용자 제스처 밖 `window.open`)에 걸립니다.
 */

const SDK_SRC = 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.2/kakao.min.js'
// 2026-09-03 파일에서 직접 계산한 sha384 — 버전을 올리면 같이 다시 계산할 것.
const SDK_INTEGRITY = 'sha384-zt/G7/KfaRQ9dT/QIkS0ujMtzouJqzuSJcXVQu50x0rl/+mD1dc70AeOejVbMD9E'

export interface KakaoSdk {
  init(key: string): void
  isInitialized(): boolean
  Share: { sendDefault(settings: Record<string, unknown>): void }
}

declare global {
  interface Window {
    Kakao?: KakaoSdk
  }
}

function jsKey(): string {
  return (import.meta.env.VITE_KAKAO_JS_KEY as string | undefined) ?? ''
}

/** 키가 있어야 그립니다 — 없는데 그리면 눌러도 아무 일이 안 일어나는 버튼이 됩니다. */
export function kakaoShareAvailable(): boolean {
  return jsKey() !== ''
}

let loading: Promise<KakaoSdk> | null = null

/** SDK 를 한 번만 내려받고 init 까지. 실패하면 다음 호출이 다시 시도합니다. */
export function loadKakao(): Promise<KakaoSdk> {
  const key = jsKey()
  if (key === '') return Promise.reject(new Error('VITE_KAKAO_JS_KEY 없음'))
  const existing = window.Kakao
  if (existing !== undefined) {
    if (!existing.isInitialized()) existing.init(key)
    return Promise.resolve(existing)
  }
  // `loading` 은 동시 요청을 하나로 묶는 용도뿐 — 끝나면(성공이든 실패든) 비워서 다음 호출이
  // 위의 `window.Kakao` 길이나 재시도를 타게 합니다. executor 안에서 비우면 대입이 덮어씁니다.
  loading ??= new Promise<KakaoSdk>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SDK_SRC
    script.integrity = SDK_INTEGRITY
    script.crossOrigin = 'anonymous'
    script.onload = () => {
      const sdk = window.Kakao
      if (sdk === undefined) {
        reject(new Error('Kakao SDK 가 전역을 만들지 않음'))
        return
      }
      if (!sdk.isInitialized()) sdk.init(key)
      resolve(sdk)
    }
    script.onerror = () => {
      script.remove()
      reject(new Error('Kakao SDK 로드 실패'))
    }
    document.head.append(script)
  }).finally(() => {
    loading = null
  })
  return loading
}

export type KakaoShareOutcome = 'sent' | 'failed'

/**
 * 결과 이미지를 피드 카드로 보냅니다. 카드의 링크는 놀이터 랜딩(UTM) — 결과 페이지는
 * 로그인이 필요해 받는 사람이 못 엽니다. `sent` 는 «선택창까지 열었다» 는 뜻이지 보냈다는
 * 보장은 아닙니다(SDK 가 결과를 돌려주지 않음).
 */
export async function shareToKakao(imageUrl: string): Promise<KakaoShareOutcome> {
  try {
    const kakao = await loadKakao()
    const landing = `${window.location.origin}/?utm_source=kakao&utm_medium=share&utm_campaign=result_share`
    kakao.Share.sendDefault({
      objectType: 'feed',
      content: {
        title: '우리 아이 AI 사진 🐾',
        description: '누띠 사진 놀이터에서 만들었어요',
        imageUrl,
        link: { mobileWebUrl: landing, webUrl: landing },
      },
      buttons: [{ title: '나도 만들기', link: { mobileWebUrl: landing, webUrl: landing } }],
    })
    return 'sent'
  } catch {
    return 'failed'
  }
}
