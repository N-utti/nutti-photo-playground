/**
 * GA4 배선 (app/analytics.ts).
 *
 * 측정 코드의 결함은 **화면에 아무 흔적도 남기지 않습니다.** 이벤트가 안 나가도 버튼은
 * 눌리고, 두 번 나가도 화면은 똑같습니다 — 틀렸다는 걸 알게 되는 건 몇 주 뒤 GA4
 * 보고서를 열었을 때고, 그때는 그 기간의 데이터를 되살릴 수 없습니다. 그래서 여기서는
 * «무엇이 나갔는가» 를 직접 셉니다.
 *
 * 보는 것은 셋입니다.
 *   1. **꺼져 있을 때 정말 조용한가.** 개발·미배포 환경이 여기고, 여기서 새면 가짜
 *      클릭이 실제 속성에 섞여 북극성 지표의 기준선을 오염시킵니다(01-prd §6 Q1).
 *   2. **두 시스템에 같은 이름·같은 속성으로 가는가.** 이름이 갈리면 나중에 숫자가
 *      다를 때 무엇과 무엇을 비교하는지부터 다시 알아내야 합니다.
 *   3. **측정이 화면을 막지 않는가.** 비콘이 실패해도 `track` 은 던지지 않습니다.
 *
 * `import.meta.env` 는 모듈 로드 시점에 한 번 읽히므로(상수), 켠 상태를 보려면
 * `vi.stubEnv` 뒤에 **모듈을 다시 import** 해야 합니다 — 아래 `loadAnalytics`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const DUMMY_ID = 'G-TEST000000'

/**
 * 환경을 세운 **뒤** 모듈을 새로 읽습니다. 상수는 그 순간에 굳습니다.
 *
 * 비콘 스파이를 여기서 같이 만들어 돌려주는 이유: `vi.resetModules()` 뒤의 import 는
 * `api/endpoints` 까지 **새 인스턴스**로 가져옵니다. 바깥에서 미리 import 해 둔
 * `events` 에 스파이를 걸면 analytics 가 보는 객체와 다른 객체를 감시하게 되고,
 * 호출 0건으로 조용히 통과하거나(여기선 실패로 드러났지만) 반대로 못 잡습니다.
 */
async function loadAnalytics(measurementId: string) {
  vi.stubEnv('VITE_GA4_MEASUREMENT_ID', measurementId)
  vi.resetModules()
  const { events } = await import('../api/endpoints')
  const beacon = vi.spyOn(events, 'track').mockResolvedValue(undefined)
  return { ...(await import('./analytics')), beacon }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  delete window.dataLayer
  document.querySelectorAll('script[src*="googletagmanager"]').forEach((node) => node.remove())
})

describe('app/analytics · 측정 ID 가 없을 때', () => {
  it('스크립트를 붙이지 않는다', async () => {
    const { startAnalytics } = await loadAnalytics('')

    startAnalytics()

    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull()
    // `dataLayer` 조차 만들지 않습니다 — 만들어 두면 `track` 이 이벤트를 계속 쌓습니다.
    expect(window.dataLayer).toBeUndefined()
  })

  it('GA4 로는 아무것도 안 보내면서 내부 로그는 그대로 남긴다', async () => {
    /*
      **끄는 것과 안 만드는 것은 다릅니다.** `metric_event` 는 우리 서버로 가는 내부
      로그라 GA4 와 수명이 다르고(90일 · W-11 콘솔), 개발에서 GA4 를 끈다고 이쪽까지
      멈추면 목 위에서 비콘 배선을 확인할 방법이 사라집니다.
    */
    const { track, beacon } = await loadAnalytics('')

    track({ event_type: 'shop_exit_click', properties: { from: 'tabbar' } })

    expect(beacon).toHaveBeenCalledWith({
      event_type: 'shop_exit_click',
      properties: { from: 'tabbar' },
    })
    expect(window.dataLayer).toBeUndefined()
  })
})

describe('app/analytics · 측정 ID 가 있을 때', () => {
  it('gtag 스크립트를 그 ID 로 붙이고 config 까지 밀어 넣는다', async () => {
    const { startAnalytics } = await loadAnalytics(DUMMY_ID)

    startAnalytics()

    const script = document.querySelector<HTMLScriptElement>('script[src*="googletagmanager"]')
    expect(script?.src).toContain(`id=${DUMMY_ID}`)
    // 스크립트가 늦게 와도 유실되지 않게 큐부터 채웁니다.
    expect(window.dataLayer).toEqual([
      ['js', expect.any(Date)],
      ['config', DUMMY_ID],
    ])
  })

  it('한 번의 track 이 두 시스템에 같은 이름·같은 속성으로 간다', async () => {
    /*
      **이 파일의 핵심입니다.** 부르는 자리를 하나로 둔 이유가 이것 — 갈래가 둘이면
      한쪽에만 이벤트를 추가하는 실수가 반드시 나고, 그러면 W-11 콘솔과 GA4 보고서가
      같은 클릭을 두고 다른 수를 말합니다.
    */
    const { startAnalytics, track, beacon } = await loadAnalytics(DUMMY_ID)
    startAnalytics()
    window.dataLayer!.length = 0

    const body = { event_type: 'calculator_exit_click', properties: { breed_code: '토이푸들' } }
    track(body)

    expect(beacon).toHaveBeenCalledWith(body)
    expect(window.dataLayer).toEqual([
      ['event', 'calculator_exit_click', { breed_code: '토이푸들' }],
    ])
  })

  it('화면 전환용 page_view 를 직접 쏘지 않는다', async () => {
    /*
      GA4 «향상된 측정» 이 History API 기반으로 이미 보내고 있어서, 여기서 또 보내면
      화면 하나가 **두 번** 세어집니다. 세션·이탈률이 통째로 틀어지는데 화면에는 아무
      흔적이 없습니다 — 그래서 «안 보낸다» 를 테스트로 못 박습니다.
    */
    const { startAnalytics } = await loadAnalytics(DUMMY_ID)

    startAnalytics()

    const names = window.dataLayer!.map((entry) => (entry as unknown[])[1])
    expect(names).not.toContain('page_view')
  })

  it('내부 비콘이 실패해도 track 은 던지지 않는다', async () => {
    // 측정이 화면을 멈추게 하는 건 어떤 지표보다도 비쌉니다.
    const { startAnalytics, track, beacon } = await loadAnalytics(DUMMY_ID)
    beacon.mockRejectedValue(new Error('네트워크 실패'))
    startAnalytics()

    expect(() => track({ event_type: 'share_click', properties: {} })).not.toThrow()
  })
})
