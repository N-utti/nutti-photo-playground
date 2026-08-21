/**
 * 탈퇴할 때 이 브라우저에 남는 흔적을 지웁니다 (이슈 #123).
 *
 * 토큰만 지우면 부족합니다. 앱은 sessionStorage 에 **탈퇴한 계정의 것**을 여럿 들고
 * 있습니다 — 올리던 사진의 초안(api/uploadDraft.ts), 진행 중이던 생성 의도와 멱등
 * 키(api/idempotency.ts), 보고 있던 job(app/activeJob.ts). 탈퇴 화면은 «업로드한
 * 사진과 결과물이 즉시 파기된다» 고 고지하는데, 그 직후 새 게스트 화면에서 방금 올린
 * 사진이 확인 단계에 되살아나면 고지가 그 자리에서 거짓이 됩니다.
 *
 * **왜 목록이 아니라 접두사인가**: 지울 키를 손으로 나열하면 다음에 저장소를 하나 더
 * 만드는 사람이 여기를 고쳐야 한다는 걸 알 방법이 없고, 안 고쳐도 아무 데서도 안
 * 깨집니다 — 조용히 남습니다. 앱 키는 전부 `nutti.` 로 시작하므로 접두사로 쓸어내면
 * 새 저장소가 자동으로 포함됩니다.
 *
 * 예외는 `nutti.mock.*` 입니다. 목의 시나리오·상태는 개발용 장치이지 사용자 데이터가
 * 아니고, 탈퇴를 밟아 볼 때마다 목이 초기화되면 그 검증 자체를 못 합니다. 실서버에는
 * 애초에 없는 키입니다.
 */

const APP_PREFIX = 'nutti.'
const MOCK_PREFIX = 'nutti.mock.'

export function clearLocalTraces(): void {
  for (const storage of [sessionStorage, localStorage]) {
    const doomed: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(APP_PREFIX) && !key.startsWith(MOCK_PREFIX)) doomed.push(key)
    }
    // 순회 중에 지우면 인덱스가 밀려 건너뛰는 키가 생깁니다 — 다 모은 뒤에 지웁니다.
    for (const key of doomed) storage.removeItem(key)
  }
}
