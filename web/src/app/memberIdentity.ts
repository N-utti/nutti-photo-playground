/**
 * 회원 표시명·아바타 이니셜 (이슈 #12 결정1·결정5).
 *
 * `nickname` 은 카카오·네이버 프로필에서만 옵니다(PR #21) — 로컬 전용 회원은 항상
 * `null` 이라 폴백이 필요하고, 그때 이메일 전체를 화면에 박으면 남에게 보이는
 * 화면에 계정 아이디가 그대로 노출되므로 앞부분만 씁니다(§3 인증 폴백 규칙).
 *
 * 아바타는 **이니셜 원형**입니다. 프로바이더 프로필 이미지는 URL 만료·CORS 가
 * provider 마다 달라 깨진 이미지가 되기 쉽고, 이 서비스에서 사람 사진이 강아지보다
 * 중요할 이유도 없습니다(이슈 #12 결정5 확정).
 */

import { initialOf } from './initials'
import type { AuthProvider, Me } from '../api/types'

/** 이메일 로컬파트. `null` 이거나 '@' 앞이 비면 null. */
function emailLocalPart(me: Me): string | null {
  const local = me.email?.split('@')[0]
  return local ? local : null
}

export function memberLabel(me: Me): string {
  if (me.nickname) return `${me.nickname}님`
  const local = emailLocalPart(me)
  return local ? `${local}님` : '내 계정'
}

/** 아바타 원형 안에 넣는 한 글자. 이름이 없으면 '나'. */
export function memberInitial(me: Me): string {
  const source = me.nickname ?? emailLocalPart(me)
  if (!source) return '나'
  return initialOf(source) || '나'
}

/** 로그인 수단 칩 라벨. `providers` 는 복수라(§3) 칩도 복수로 그립니다. */
export const PROVIDER_LABEL: Record<AuthProvider, string> = {
  kakao: '카카오',
  naver: '네이버',
  local: '이메일',
}
