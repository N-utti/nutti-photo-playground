/**
 * MSW 핸들러 — 백엔드 전 엔드포인트가 501 스텁이므로(PR #2) 프론트는 이 목 위에서 만듭니다.
 *
 * 응답 본문은 docs/05-api-spec.md §3 예시를 따릅니다(mocks/fixtures.ts).
 * 여기서 추가로 하는 일은 §3 이 정적 예시로만 보여 주는 것들을 **움직이게** 만드는 것입니다 —
 * job 이 시간에 따라 queued → processing → succeeded 로 전이하고, 크레딧이 실제로 차감되고,
 * 같은 Idempotency-Key 가 같은 job 을 돌려줍니다.
 *
 * 시나리오 강제: localStorage 에 `nutti.mock.scenario` 를 넣으면 해당 케이스로 고정됩니다.
 *   upload:warn | upload:block | job:fail | job:safety | credit:empty | session:expired
 *   guest:ratelimited | session:lost
 */

import { HttpResponse, http, delay } from 'msw'
import type {
  Credits,
  Job,
  JobErrorCode,
  UploadResult,
} from '../api/types'
import {
  initialCredits,
  ledgerEntries,
  libraryPage,
  petList,
  placeholderImage,
  styleCatalog,
  styleDetailFor,
  uploadBlocked,
  uploadOk,
  uploadWarned,
} from './fixtures'

const BASE = '*/v1'

function scenario(): string {
  return localStorage.getItem('nutti.mock.scenario') ?? ''
}

// ---------------------------------------------------------------- 목 상태

interface MockJob {
  id: string
  createdAt: number
  creditCost: number
  forcedError: JobErrorCode | null
  selectedIndex: number | null
}

const state = {
  credits: structuredClone(initialCredits) as Credits,
  jobs: new Map<string, MockJob>(),
  /** Idempotency-Key → job_id. 같은 키 재요청 시 새 job 을 만들지 않습니다(§1). */
  idempotency: new Map<string, string>(),
  /** session:expired 시나리오에서 "만료된 것으로 칠" Authorization 헤더 값. */
  expiredToken: null as string | null,
}

/** 생성에 걸리는 시간. W-03 "평균 24초"보다 짧게 잡아 개발 반복을 빠르게 합니다. */
const JOB_DURATION_MS = 12_000

function apiError(status: number, code: string, message: string, detail: unknown = {}) {
  return HttpResponse.json({ error: { code, message, detail } }, { status })
}

/** 경과 시간으로 job 상태를 계산 — 타이머 없이 폴링만으로 진행이 보입니다. */
function projectJob(job: MockJob): Job {
  const elapsed = Date.now() - job.createdAt
  const sourceImageUrl = placeholderImage('원본')

  if (elapsed >= JOB_DURATION_MS) {
    if (job.forcedError) {
      return {
        job_id: job.id,
        status: 'failed',
        progress: null,
        eta_seconds: null,
        status_message: null,
        source_image_url: sourceImageUrl,
        results: null,
        selected_index: null,
        error_code: job.forcedError,
      }
    }
    return {
      job_id: job.id,
      status: 'succeeded',
      progress: 100,
      eta_seconds: 0,
      status_message: null,
      source_image_url: sourceImageUrl,
      results: Array.from({ length: 4 }, (_, index) => ({
        index,
        image_url: placeholderImage(`결과 ${index + 1}`, '#F9E5EC'),
      })),
      selected_index: job.selectedIndex,
      error_code: null,
    }
  }

  if (elapsed < 1_500) {
    return {
      job_id: job.id,
      status: 'queued',
      progress: 0,
      eta_seconds: Math.ceil(JOB_DURATION_MS / 1000),
      status_message: '대기 중…',
      source_image_url: sourceImageUrl,
      results: null,
      selected_index: null,
      error_code: null,
    }
  }

  const ratio = elapsed / JOB_DURATION_MS
  return {
    job_id: job.id,
    status: 'processing',
    progress: Math.floor(ratio * 100),
    eta_seconds: Math.ceil((JOB_DURATION_MS - elapsed) / 1000),
    status_message: '레고 블록을 쌓는 중…',
    source_image_url: sourceImageUrl,
    results: null,
    selected_index: null,
    error_code: null,
  }
}

// ---------------------------------------------------------------- 핸들러

export const handlers = [
  // ------------------------------------------------------------ 인증
  http.post(`${BASE}/auth/guest`, async () => {
    await delay(120)
    // IP 당 시간당 발급 제한(app/routers/auth.py `_check_guest_rate_limit`, 이슈 #15).
    if (scenario() === 'guest:ratelimited') {
      return apiError(429, 'RATE_LIMITED', '게스트 발급 한도를 초과했습니다')
    }
    return HttpResponse.json(
      {
        token: `mock-guest-jwt.${crypto.randomUUID()}`,
        member_id: crypto.randomUUID(),
        kind: 'guest',
      },
      { status: 201 },
    )
  }),

  http.get(`${BASE}/auth/me`, () => {
    return HttpResponse.json({
      member_id: '8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f',
      kind: 'guest',
      credit_balance: state.credits.balance,
      cafe24_linked: false,
    })
  }),

  http.post(`${BASE}/auth/kakao`, async () => {
    await delay(200)
    return HttpResponse.json({
      token: `mock-member-jwt.${crypto.randomUUID()}`,
      member_id: '8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f',
      kind: 'member',
      merged: false,
      credit_balance: state.credits.balance + 4,
    })
  }),

  http.post(`${BASE}/auth/logout`, () => new HttpResponse(null, { status: 204 })),

  // ------------------------------------------------------------ 스타일
  http.get(`${BASE}/styles`, async ({ request }) => {
    await delay(150)
    const url = new URL(request.url)
    const section = url.searchParams.get('section')
    const limit = Number(url.searchParams.get('limit')) || undefined

    let sections = styleCatalog.sections
    if (section === 'popular') sections = sections.slice(0, 1)
    else if (section) sections = sections.filter((s) => s.name === section)

    if (limit) {
      sections = sections.map((s) => ({ ...s, styles: s.styles.slice(0, limit) }))
    }
    return HttpResponse.json({ sections, total_count: styleCatalog.total_count })
  }),

  http.get(`${BASE}/styles/:styleId`, async ({ params }) => {
    await delay(120)
    const detail = styleDetailFor(Number(params.styleId))
    if (!detail) return apiError(404, 'NOT_FOUND', '스타일을 찾을 수 없습니다')
    return HttpResponse.json(detail)
  }),

  // ------------------------------------------------------------ 업로드
  http.post(`${BASE}/uploads`, async () => {
    await delay(700) // 품질 체크가 도는 체감을 남깁니다.
    const forced = scenario()
    let body: UploadResult = uploadOk
    if (forced === 'upload:warn') body = uploadWarned
    else if (forced === 'upload:block') body = uploadBlocked
    // 차단도 HTTP 200 입니다(§1 코드 표) — 에러로 내리면 안 됩니다.
    return HttpResponse.json(body)
  }),

  // ------------------------------------------------------------ 펫
  http.get(`${BASE}/pets`, () => HttpResponse.json({ items: petList })),

  http.post(`${BASE}/pets`, async ({ request }) => {
    const { name } = (await request.json()) as { name: string }
    const pet = { id: crypto.randomUUID(), name, thumbnail_url: placeholderImage(name) }
    petList.push(pet)
    return HttpResponse.json(pet, { status: 201 })
  }),

  http.delete(`${BASE}/pets/:petId`, () => new HttpResponse(null, { status: 204 })),

  // ------------------------------------------------------------ 생성 job
  http.post(`${BASE}/jobs`, async ({ request }) => {
    await delay(200)
    const key = request.headers.get('Idempotency-Key')
    if (!key) {
      return apiError(400, 'VALIDATION_ERROR', 'Idempotency-Key 헤더가 필요합니다')
    }

    // 같은 키 재요청 → 새 job 을 만들지 않고 원래 job 을 그대로 반환(§1).
    const existing = state.idempotency.get(key)
    if (existing) return HttpResponse.json({ job_id: existing, status: 'queued' }, { status: 202 })

    const body = (await request.json()) as { custom_prompt: string | null }
    const cost = body.custom_prompt ? 2 : 1

    const forcedEmpty = scenario() === 'credit:empty'
    if (forcedEmpty || state.credits.balance < cost) {
      return apiError(402, 'INSUFFICIENT_CREDIT', '크레딧이 부족합니다', {
        required: cost,
        // 강제 시나리오에서 실제 잔액을 그대로 실어 보내면 "1 크레딧이 필요한데
        // 11 크레딧이 있어요" 같은 자기모순 화면이 나옵니다.
        balance: forcedEmpty ? 0 : Math.max(0, state.credits.balance),
      })
    }

    const forced = scenario()
    const job: MockJob = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      creditCost: cost,
      forcedError:
        forced === 'job:fail' ? 'GENERATION_FAILED' : forced === 'job:safety' ? 'SAFETY_BLOCKED' : null,
      selectedIndex: null,
    }
    state.jobs.set(job.id, job)
    state.idempotency.set(key, job.id)
    state.credits.balance -= cost // 차감은 job 생성 시점(04-erd 크레딧 트랜잭션).

    return HttpResponse.json({ job_id: job.id, status: 'queued' }, { status: 202 })
  }),

  http.get(`${BASE}/jobs/:jobId`, ({ params, request }) => {
    // 게스트 토큰 만료 → 재발급 → **다른 member_id** 라 원래 job 이 사라지는 경로.
    // 이슈 #5 의 복원 실패 안내를 실제로 밟아 보려면 이 시나리오가 필요합니다.
    //
    // "몇 번째 요청이냐"가 아니라 **어떤 토큰이냐**로 판정합니다. 회차로 세면
    // StrictMode 이중 마운트나 재시도 한 번에 만료가 소진돼 재발급 경로를 못 밟습니다.
    if (scenario() === 'session:expired') {
      const token = request.headers.get('Authorization') ?? ''
      state.expiredToken ??= token
      if (token === state.expiredToken) {
        return apiError(401, 'TOKEN_EXPIRED', '토큰이 만료되었습니다')
      }
      // 재발급된 토큰 = 다른 게스트. 이전 job 은 남의 것이라 404 입니다(§3).
      return apiError(404, 'NOT_FOUND', '작업을 찾을 수 없습니다')
    }

    const job = state.jobs.get(String(params.jobId))
    if (!job) return apiError(404, 'NOT_FOUND', '작업을 찾을 수 없습니다')

    const projected = projectJob(job)
    // 실패 확정 시 크레딧 자동 반환(§4 시나리오2 5단계) — 1회만.
    if (projected.status === 'failed' && job.creditCost > 0) {
      state.credits.balance += job.creditCost
      job.creditCost = 0
    }
    return HttpResponse.json(projected)
  }),

  http.post(`${BASE}/jobs/:jobId/select`, async ({ params, request }) => {
    const job = state.jobs.get(String(params.jobId))
    if (!job) return apiError(404, 'NOT_FOUND', '작업을 찾을 수 없습니다')
    const { result_index } = (await request.json()) as { result_index: number }
    job.selectedIndex = result_index
    return HttpResponse.json({ job_id: job.id, selected_index: result_index })
  }),

  http.post(`${BASE}/jobs/:jobId/share`, async ({ params }) => {
    await delay(400)
    return HttpResponse.json({ share_image_url: placeholderImage(`공유 ${params.jobId}`, '#F9E5EC') })
  }),

  // ------------------------------------------------------------ 계산기 연결
  http.get(`${BASE}/calculator-link`, async () => {
    await delay(120)
    return HttpResponse.json({
      breed_code: 'toy_poodle',
      breed_label: '토이푸들',
      size_label: '소형',
      calculator_url:
        'https://nutti.co.kr/calculator.html?name=콩이&breed=toy_poodle&size=소형' +
        '&utm_source=nutti_playground&utm_medium=referral&utm_campaign=calculator_handoff',
    })
  }),

  // ------------------------------------------------------------ 보관함
  http.get(`${BASE}/library`, () => HttpResponse.json(libraryPage)),
  http.delete(`${BASE}/library`, () => new HttpResponse(null, { status: 204 })),

  // ------------------------------------------------------------ 크레딧
  http.get(`${BASE}/credits`, () => {
    // 만료가 아닌 401 — 병합된 게스트 토큰·kind 불일치(app/auth.py `get_current_member`).
    // TOKEN_EXPIRED 와 달리 재발급으로 풀리지 않는다는 게 이 시나리오의 요점입니다.
    // 앱바 크레딧 pill 이 어느 화면에서나 이걸 부르므로 여기에 겁니다.
    if (scenario() === 'session:lost') {
      return apiError(401, 'UNAUTHORIZED', '유효하지 않은 토큰입니다')
    }
    return HttpResponse.json(state.credits)
  }),

  http.post(`${BASE}/credits/claim`, async ({ request }) => {
    await delay(250)
    const { action } = (await request.json()) as { action: string }
    const row = state.credits.earn_actions.find((a) => a.action === action)

    if (!row) return apiError(400, 'VALIDATION_ERROR', '알 수 없는 획득 경로입니다', { action })
    if (row.status !== 'available') {
      return apiError(409, 'ALREADY_CLAIMED', '이미 받은 크레딧이에요', { action })
    }

    state.credits.balance += row.amount
    row.status = action === 'daily' ? 'tomorrow' : 'done'
    row.cta = action === 'daily' ? '내일 다시' : null
    return HttpResponse.json({ balance: state.credits.balance, amount_granted: row.amount })
  }),

  http.get(`${BASE}/credits/ledger`, () =>
    HttpResponse.json({ items: ledgerEntries, next_cursor: null }),
  ),

  // ------------------------------------------------------------ 이벤트 비콘
  http.post(`${BASE}/events`, () => new HttpResponse(null, { status: 204 })),
]
