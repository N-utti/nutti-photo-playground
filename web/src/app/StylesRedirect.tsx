/**
 * 옛 카탈로그 주소(`/styles`)를 홈(`/`)으로 넘깁니다 — 홈이 원페이지 갤러리에 흡수됐습니다
 * (screens/W01Landing.tsx). 이 주소로 오는 옛 링크·북마크·앱 흐름의 되돌림
 * (`withReuse('/styles', …)`)을 받되, `?from_job=` 재사용 맥락은 그대로 실어 보냅니다 —
 * 떨어뜨리면 방금 쓴 사진을 다시 올리게 됩니다(app/reuseFromJob.ts). `replace` 라
 * 뒤로가기에 빈 칸을 남기지 않습니다.
 *
 * `/styles/:styleId`(상세 시트)는 이 규칙보다 구체적인 홈의 자식이 먼저 잡으므로
 * 여기로 오지 않습니다(app/routes.tsx).
 */

import { Navigate, useLocation } from 'react-router'

export default function StylesRedirect() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/', search }} replace />
}
