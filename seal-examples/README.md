# Seal Examples - Private Data Pattern

이 디렉토리는 Seal을 사용한 Private Data 패턴의 예제를 포함합니다.

## 구조

- `pdata/` - Move 컨트랙트 (PrivateData 패턴)
- `scripts/` - TypeScript 예제 스크립트
  - `compute_key_id.ts` - 데이터 암호화 및 저장
  - `decrypt_pdata.ts` - 저장된 데이터 복호화

## 설정

1. 의존성 설치:
```bash
npm install
```

2. 환경 변수 설정:
```bash
cp .env.example .env
# .env 파일을 편집하여 ORACLE_PRIVATE_KEY와 PDATA_PACKAGE_ID를 설정하세요
```

## 사용 방법

### 1. 데이터 암호화 및 저장

```bash
npm run compute-key-id
```

이 스크립트는:
- 랜덤 nonce 생성
- `compute_key_id`를 사용하여 encryption ID 계산
- Seal로 데이터 암호화
- Sui 체인에 암호화된 데이터 저장

### 2. 저장된 데이터 복호화

```bash
npm run decrypt-pdata
```

또는 특정 Object ID로 복호화:

```bash
OBJECT_ID=0x... npm run decrypt-pdata
```

이 스크립트는:
- PrivateData 객체 가져오기
- `compute_key_id`로 encryption ID 재계산
- `seal_approve` 트랜잭션 생성
- Seal로 데이터 복호화

## 환경 변수

- `ORACLE_PRIVATE_KEY`: Sui Ed25519 개인 키 (필수)
- `PDATA_PACKAGE_ID`: 배포된 pdata 패키지 ID (선택, 기본값 제공)
- `OBJECT_ID`: 복호화할 PrivateData 객체 ID (선택, 기본값 제공)

## 참고

- Seal 서버 설정은 코드에 하드코딩되어 있습니다 (testnet)
- `compute_key_id` 함수는 Move의 `compute_key_id` 로직을 TypeScript로 재현한 것입니다

