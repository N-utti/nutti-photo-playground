/**
 * 아직 구현하지 않은 화면의 자리표시자.
 *
 * 화면을 실제로 만들 때 이 파일에서 꺼내 `screens/W0x*.tsx` 로 분리합니다.
 * 지금 한 파일에 모아 둔 이유는, 빈 컴포넌트 10개를 파일 10개로 흩어 놓으면
 * "만들어진 것"과 "자리만 잡은 것"이 구분되지 않기 때문입니다.
 */

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

      <div className="mt-6 rounded-lg border border-rule bg-surface p-4">
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

export const W01Landing = () => (
  <Stub
    id="W-01"
    title="랜딩"
    phase="Phase 2"
    endpoints={['GET /v1/styles?section=popular&limit=5']}
  />
)

export const W03StyleDetail = () => (
  <Stub id="W-03" title="스타일 상세 (바텀시트)" phase="Phase 2" endpoints={['GET /v1/styles/{id}']} />
)

export const W04Upload = () => (
  <Stub
    id="W-04"
    title="사진 업로드 · 품질 체크"
    phase="Phase 2"
    endpoints={['GET /v1/pets', 'POST /v1/uploads', 'POST /v1/jobs']}
  />
)

export const W05Waiting = () => (
  <Stub
    id="W-05"
    title="생성 대기"
    phase="Phase 2"
    endpoints={['GET /v1/jobs/{id} (2s 지수 백오프 폴링)', 'GET /v1/styles?section=popular&limit=3']}
  />
)

export const W06Result = () => (
  <Stub
    id="W-06"
    title="결과"
    phase="Phase 2"
    endpoints={[
      'GET /v1/jobs/{id}',
      'POST /v1/jobs/{id}/select',
      'POST /v1/jobs/{id}/share',
      'GET /v1/calculator-link',
    ]}
  />
)

export const W07Calculator = () => (
  <Stub id="W-07" title="계산기로 넘기기" phase="Phase 3" endpoints={['GET /v1/calculator-link']} />
)

export const W08Creative = () => (
  <Stub
    id="W-08"
    title="크리에이티브 모드"
    phase="Phase 5"
    endpoints={['POST /v1/jobs (custom_prompt, 2 크레딧)']}
  />
)

export const W09Library = () => (
  <Stub
    id="W-09"
    title="보관함"
    phase="Phase 4"
    endpoints={['GET /v1/pets', 'GET /v1/library?pet_id=&cursor=', 'DELETE /v1/library']}
  />
)

export const W10Credits = () => (
  <Stub
    id="W-10"
    title="크레딧 받기"
    phase="Phase 3"
    endpoints={['GET /v1/credits', 'POST /v1/credits/claim', 'GET /v1/credits/ledger']}
  />
)

export const W11Console = () => (
  <Stub
    id="W-11"
    title="프롬프트 운영 콘솔 (관리자)"
    phase="Phase 5 · 인증 경계가 달라 번들 분리 예정"
    endpoints={['GET /v1/admin/styles', 'GET /v1/admin/custom-prompts/top', 'GET /v1/admin/settings']}
  />
)

export const NotFound = () => (
  <section className="mx-auto max-w-2xl px-5 py-10">
    <h1 className="text-2xl font-bold">페이지를 찾을 수 없습니다</h1>
  </section>
)
