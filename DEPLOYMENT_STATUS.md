# Handong Dev-Ops Hub - Current Status (기능 우선 모드)

## 최근 변경 (2026-05-xx)

### 완료된 구조 개선
- Deployment 로직을 serviceType별로 완전히 분리 (`services/` 폴더)
- Web / APK / Function / Cron 4가지 타입 지원 구조 완성
- Web Deployer 대폭 개선 (아래 참조)

### Web Deployer 개선 내용 (이번에 집중)
- internalPort 지원 (기본 80, 사용자가 지정 가능)
- commit hash 기록
- 명확한 실패 단계(failureStage) 반환 (clone_failed, build_failed, container_start_failed 등)
- 기본 헬스체크
- buildCommand / startCommand 전달 준비
- DB에 service_type 정상 저장

### DB 스키마
`service_type` 컬럼이 필요합니다.

마이그레이션 스크립트 제공:
```bash
node utils/add_service_type_column.js
```
(실제 DB가 있는 머신에서 실행해야 함)

## 테스트 현황
- 모듈 로딩 + 문법 검사: ✅ 성공
- 실제 배포 테스트: 이 환경에서는 불가능 (토큰, Docker 권한, 실제 DB 없음)

## 다음 작업 추천 (시간 있을 때)
1. 프론트엔드에서 Web일 때 internalPort 입력 필드 추가
2. APK 실제 빌드 동작시키기 (Docker 이미지 선정 + artifact 복사)
3. Function / Cron을 조금 더 그럴듯하게 만들기
4. 실패 시에도 로그가 제대로 남도록 개선 (현재는 메모리)

## 대화 기록
이 세션의 대화는 저장됩니다. 나중에 다시 들어와도 이어서 작업할 수 있습니다.
