# 누띠 강아지 사진 놀이터 — 개발 문서 세트

> 기준: wireframe-spec v0.5 / cebb865

이 디렉터리는 "누띠 강아지 사진 놀이터"(nutti.co.kr 쇼핑몰의 홍보 자산) 개발을 위한 문서 세트입니다.

## SSOT 선언

**`docs/wireframe-spec-v0.5.html`이 단일 진실 소스(SSOT)입니다.** 이 파일은 불변이며 마크다운으로 재이관하지 않습니다.

- HTML(와이어프레임 스펙)이 바뀌면 아래 01~07 문서를 갱신합니다. **반대는 하지 않습니다** — 문서를 고치기 위해 스펙 HTML을 수정하지 않습니다.
- 스펙 내부의 모순(예: 스타일 개수 표기 불일치)은 HTML을 고치지 않고 [07-decisions.md](07-decisions.md)의 정오표(errata)에 기록하고 채택값을 명시합니다.

## 문서 인덱스

| 문서 | 내용 |
|---|---|
| [01-prd.md](01-prd.md) | 제품 정의, 북극성 지표, 스코프, 설계 원칙 |
| [02-requirements.md](02-requirements.md) | FR/NFR + 출처 역추적 표 |
| [03-usecases.md](03-usecases.md) | 액터, 유스케이스, 엣지 케이스, 상태머신 |
| [04-erd.md](04-erd.md) | 데이터 모델(ERD), 화면→테이블 커버리지 표 |
| [05-api-spec.md](05-api-spec.md) | API 계약: 화면-API 매핑, 엔드포인트 스키마, 시나리오 |
| [06-architecture-deployment.md](06-architecture-deployment.md) | 시스템 구성, 배포, 인프라 |
| [07-decisions.md](07-decisions.md) | 결정 카드(ADR-lite), 스펙 정오표(errata) |

(각 문서는 아직 작성 중입니다. 완료되는 대로 위 표의 링크가 유효해집니다.)

## 독자별 읽기 순서

- **프론트엔드**: `05-api-spec` → `03-usecases` → `01-prd`
- **백엔드**: `01-prd` → `04-erd` → `06-architecture-deployment`
- **신규 합류자**: 이 README → `docs/wireframe-spec-v0.5.html`

## 참조 규약

모든 스펙 참조는 앵커 형식을 사용합니다: `wireframe-spec-v0.5.html#p01` ~ `#p11`, `#goal`, `#arch`, `#flow`, `#states`, `#open`.

## 버전 고정 규칙

각 문서(01~07) 머리에 다음 줄을 명시합니다:

```
> 기준: wireframe-spec v0.5 / cebb865
```

스펙 HTML이 갱신되어 커밋 해시가 바뀌면 이 표기와 각 문서 내용을 함께 갱신합니다.
