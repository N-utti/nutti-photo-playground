/**
 * GA4 배선 (01-prd §6 «측정 배선» · 06-architecture-deployment §11 · FR-W06-12).
 *
 * **두 시스템이 같은 클릭을 각자 기록합니다.** `metric_event`(`POST /v1/events`)는 90일
 * 보존의 **내부 로그**로 W-11 운영 콘솔의 스타일별 성과를 계산하고, GA4 는 마케팅
 * 기여와 **크로스도메인 세션**을 담당하는 외부 도구입니다(01-prd §6 «경계»). 소유
 * 시스템도 보존 기간도 다르므로 하나로 합치지 않고, 대신 **부르는 자리는 하나**로
 * 둡니다 — 갈래가 둘이면 한쪽에만 이벤트를 추가하는 실수가 반드시 납니다.
 *
 * 측정 ID 는 쇼핑몰이 이미 쓰는 그 속성입니다(`G-KG0XE6F5XT`). 지어낸 값이 아니라
 * `nutti.co.kr/calculator/js/ga.js` 에서 실측한 값이고, `nutti.co.kr` 본체도 카페24가
 * 심은 Google Tag 컨테이너(`GT-MBH8R5DC`)를 거쳐 **같은 속성**으로 보냅니다. 크로스도메인은
 * 한 속성 안에서만 성립하므로 이 일치가 전제입니다.
 *
 * ID 가 비어 있으면 **아무 요청도 안 보냅니다**. 계산기 `ga.js` 가 쓰는 규칙 그대로고,
 * 개발(`.env.development`)에서 비워 두는 이유입니다 — 목 위에서 만든 가짜 클릭이 실제
 * 속성에 섞이면 북극성 지표의 기준선(01-prd §6 Q1)이 처음부터 오염됩니다.
 *
 * ## 여기서 하지 않는 것
 *
 * **화면 전환마다 `page_view` 를 쏘지 않습니다.** GA4 «향상된 측정» 의 «브라우저 기록
 * 이벤트 기반 페이지 변경» 이 History API 를 이미 보고 있고(데이터 스트림 기본값),
 * React Router 가 그 API 를 씁니다. 여기서 또 보내면 화면 하나가 **두 번** 세어져
 * 세션·이탈률이 통째로 틀립니다. 대신 이 의존을 web/README 에 적어 뒀습니다 — 관리자
 * 설정 하나에 기대는 일이라 «그렇겠지» 로 두면 안 됩니다.
 *
 * **크로스도메인 도메인 목록도 코드에 없습니다.** GA4 는 관리자 UI(데이터 스트림 →
 * 태그 설정 → 도메인 구성)에서만 설정하고, 코드의 `linker` 파라미터는 UA 시절
 * 방식입니다. 등록되면 gtag 가 해당 도메인으로 나가는 링크에 `_gl` 을 자동으로 붙입니다.
 *
 * 그래서 **코드가 크로스도메인을 깨뜨릴 수 있는 자리는 링크 자체**입니다. 구글 문서가
 * 두 가지를 못 박습니다 — 사용자의 직접 클릭이 아니라 **JS 로 이동시키면** `_gl` 이
 * 안 붙고, 중간에서 `Event.stopPropagation()` 을 하면 이벤트가 문서 노드까지 못 갑니다.
 * 오늘 출구 넷(W-06 쇼핑몰·계산기, W-07, W-10, 탭바)은 전부 평범한 `<a href>` 이고
 * 둘 다 하지 않습니다. **출구를 버튼+`navigate()` 로 바꾸면 그 순간 조용히 깨집니다.**
 */

import { events } from '../api/endpoints'
import type { MetricEventBody } from '../api/types'

const MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID ?? ''

declare global {
  interface Window {
    dataLayer?: unknown[]
  }
}

/**
 * gtag 는 «큐에 밀어 넣기» 가 전부입니다 — 스크립트가 늦게 와도 쌓인 게 그때 처리되므로,
 * 로드 완료를 기다리지 않아도 첫 클릭이 유실되지 않습니다.
 *
 * `arguments` 를 그대로 push 하는 건 구글 스니펫의 모양입니다. 배열로 바꿔 넣으면
 * gtag 가 인자 개수를 다르게 읽습니다.
 */
function gtag(...args: unknown[]): void {
  window.dataLayer?.push(args)
}

/**
 * GA4 를 켭니다. `main.tsx` 부트스트랩에서 한 번만 부릅니다.
 *
 * 측정 ID 가 없으면 **`dataLayer` 조차 만들지 않습니다** — 아래 `track` 이 그걸 보고
 * 조용히 넘어가므로, 꺼진 상태에서 이벤트가 메모리에 무한히 쌓이지 않습니다.
 */
export function startAnalytics(): void {
  if (!MEASUREMENT_ID) return

  window.dataLayer = window.dataLayer ?? []
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`
  document.head.appendChild(script)

  gtag('js', new Date())
  gtag('config', MEASUREMENT_ID)
}

/**
 * 출구·참여 이벤트 한 건. **화면은 이 함수만 부릅니다.**
 *
 * 두 곳으로 갈라지지만 어느 쪽도 화면을 막지 않습니다 — `events.track` 은 실패를
 * 삼키고(내부 로그일 뿐), GA4 는 큐에 넣는 게 전부입니다. 측정이 화면을 멈추게 하는
 * 건 어떤 지표보다도 비쌉니다.
 *
 * 이벤트 이름과 속성은 **양쪽이 같습니다**. 두 시스템의 보존 기간이 달라 나중에 숫자가
 * 갈릴 때, 이름까지 다르면 무엇과 무엇을 비교하는지부터 다시 알아내야 합니다.
 */
export function track(body: MetricEventBody): void {
  void events.track(body)
  if (!MEASUREMENT_ID) return
  gtag('event', body.event_type, body.properties)
}
