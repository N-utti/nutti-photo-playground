/**
 * 아직 구현하지 않은 화면의 자리표시자.
 *
 * 화면을 실제로 만들 때 이 파일에서 꺼내 `screens/W0x*.tsx` 로 분리합니다.
 * 지금 한 파일에 모아 둔 이유는, 빈 컴포넌트 10개를 파일 10개로 흩어 놓으면
 * "만들어진 것"과 "자리만 잡은 것"이 구분되지 않기 때문입니다.
 *
 * 예외가 하나 있습니다 — 아래 `NotFound` 는 자리표시자가 아닙니다(그 주석 참고).
 */

import { Link } from 'react-router'

interface StubProps {
  id: string
  title: string
  /** docs/05-api-spec.md §2 가 이 화면에 매핑한 엔드포인트. */
  endpoints: string[]
  phase: string
}

function Stub({ id, title, endpoints, phase }: StubProps) {
  return (
    <section className="mx-auto max-w-2xl px-5 py-10">
      <p className="font-mono text-xs tracking-wide text-ink-3">{id}</p>
      <h1 className="mt-1 text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-ink-2">아직 구현하지 않았습니다 · {phase}</p>

      <div className="mt-6 rounded-xl bg-surface p-4">
        <p className="text-xs font-semibold text-ink-2">이 화면이 쓰는 API (05-api-spec §2)</p>
        <ul className="mt-2 space-y-1">
          {endpoints.map((endpoint) => (
            <li key={endpoint} className="font-mono text-xs text-ink-3">
              {endpoint}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export const W11Console = () => (
  <Stub
    id="W-11"
    title="프롬프트 운영 콘솔 (관리자)"
    phase="Phase 5 · 인증 경계가 달라 번들 분리 예정"
    endpoints={['GET /v1/admin/styles', 'GET /v1/admin/custom-prompts/top', 'GET /v1/admin/settings']}
  />
)

/**
 * 없는 주소(`routes.tsx` 의 `path: '*'`).
 *
 * 자리표시자가 아니라 **끝까지 만든 화면**입니다. 이 파일에 남아 있는 이유는 딱
 * 하나 — 라우트가 여기서 꺼내 쓰고 있어서고, 자리표시자가 다 없어지는 날 함께
 * 옮기면 됩니다.
 *
 * 원래는 제목 한 줄이 전부였습니다. 그런데 이 라우트에는 탭바가 없습니다 —
 * 탭바는 목적지 네 화면(W-01·W-02·W-04·W-09)이 각자 붙이는 것이라, 여기 오면
 * 앱바도 탭바도 없는 빈 화면에 문장 하나만 남습니다(2026-09-03 실측). 브라우저
 * 뒤로가기 말고는 나갈 길이 없는데, 링크를 타고 처음 들어온 사람에게는 그 뒤가
 * 우리 화면도 아닙니다.
 *
 * 그래서 «왜 이렇게 됐는지» 와 «어디로 가면 되는지» 를 함께 둡니다 — 결과를 못
 * 찾을 때(`JobUnavailable`)와 같은 짜임입니다. 스타일 카탈로그로 보내는 이유는
 * 그게 이 앱에서 할 일이 시작되는 자리이면서, **탭바가 있는 화면**이기 때문입니다 —
 * 거기 닿으면 홈·보관함까지 한 번에 열립니다. 「홈으로」 같은 작은 링크를 하나 더
 * 두는 것보다 낫습니다(그런 밑줄 링크는 세로 16px 이라 WCAG 2.5.8 을 또 못 넘깁니다).
 */
export const NotFound = () => (
  <section className="mx-auto max-w-md px-5 py-16 text-center">
    <h1 className="text-xl font-bold">페이지를 찾을 수 없습니다</h1>
    <p className="mt-2 text-sm text-ink-2">
      주소가 잘못됐거나, 지금은 없어진 페이지예요. 스타일을 고르는 자리에서 다시 시작할 수 있어요.
    </p>

    <Link
      to="/styles"
      className="mt-6 block rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99]"
    >
      스타일 보러 가기
    </Link>
  </section>
)
