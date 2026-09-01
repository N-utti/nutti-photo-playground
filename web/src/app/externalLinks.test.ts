import { describe, expect, it } from 'vitest'
import { NUTTI_SHOP_URL, shopLink } from './externalLinks'

describe('shopLink', () => {
  it('쇼핑몰 출구마다 같은 소스·다른 content 로 UTM 을 붙인다', () => {
    /*
      맨 링크면 쇼핑몰 GA4·카페24 유입경로에 «직접 유입»으로 남아 놀이터가 만든 매출을 증명할 수
      없습니다. 소스는 계산기 링크(백엔드)와 같아야 GA4 에서 한 채널로 묶입니다.
    */
    const url = new URL(shopLink('w06_result'))

    expect(url.origin + url.pathname).toBe(`${NUTTI_SHOP_URL}/`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utm_source: 'nutti_playground',
      utm_medium: 'referral',
      utm_campaign: 'playground_exit',
      utm_content: 'w06_result',
    })
    expect(new URL(shopLink('tabbar')).searchParams.get('utm_content')).toBe('tabbar')
  })
})
