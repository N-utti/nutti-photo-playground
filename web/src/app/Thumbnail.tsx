/**
 * 썸네일 — **null 이 올 수 있는 이미지 자리**에 씁니다.
 *
 * `GET /v1/styles` 의 `thumbnail_url`(예시 이미지가 없는 스타일)과 `GET /v1/pets` 의
 * `thumbnail_url`(썸네일 키가 없는 펫)은 둘 다 널 가능입니다(app/routers/styles.py ·
 * pets.py). 이걸 `<img src={null}>` 로 두면 React 가 src 속성을 지우고, 브라우저는
 * **깨진 이미지 아이콘**을 그립니다 — 카드 그리드에서는 한 칸만 무너지고, 원형 펫 칩
 * 에서는 원이 사각으로 튀어나옵니다. 값이 없을 때 자리를 유지하려면 `<img>` 가 아닌
 * 다른 요소를 그려야 하고, 그 판단을 화면마다 반복하지 않도록 여기 모읍니다.
 *
 * 배경색은 일부러 넣지 않습니다 — 호출부가 이미 자기 배경(`bg-surface-2`,
 * `bg-canvas-2`)을 들고 있고, 여기서 하나를 더 얹으면 같은 `bg-*` 유틸리티끼리
 * 부딪혀 어느 쪽이 이길지 CSS 순서에 달리게 됩니다.
 */

interface ThumbnailProps {
  src: string | null
  /**
   * 빈 문자열이면 장식용입니다(이름이 옆에 이미 있는 경우) — 자리 표시자도 같은
   * 규칙으로 보조기술에서 숨깁니다. 이미지에만 alt 를 주고 폴백은 그냥 두면,
   * 사진 없는 항목만 스크린리더에서 사라집니다.
   */
  alt: string
  className?: string
  /** 자리 표시자에 남길 짧은 글자(펫 이름 첫 자 등). 없으면 빈 자리로 둡니다. */
  fallbackLabel?: string
  loading?: 'lazy' | 'eager'
  decoding?: 'async' | 'sync' | 'auto'
}

export default function Thumbnail({
  src,
  alt,
  className = '',
  fallbackLabel,
  loading,
  decoding,
}: ThumbnailProps) {
  if (src) {
    return <img src={src} alt={alt} loading={loading} decoding={decoding} className={className} />
  }

  return (
    <div
      className={`grid place-items-center ${className}`}
      {...(alt === '' ? { 'aria-hidden': true } : { role: 'img', 'aria-label': alt })}
    >
      {fallbackLabel ? (
        <span aria-hidden className="truncate px-1 text-xs font-semibold text-ink-3">
          {fallbackLabel}
        </span>
      ) : null}
    </div>
  )
}
