# Seal Examples - Private Data Pattern (한국어)

이 디렉토리는 Seal을 사용한 Private Data 패턴의 예제를 포함합니다.

## 📋 사전 준비

### 1. Sui 클라이언트 활성 주소 확인

먼저 Sui 클라이언트의 활성 주소를 확인해야 합니다:

```bash
sui client active-address
```

예시 출력:
```
0xb6c3a4d0b862a77227ec760550a93f5c35ef8d4329d70d03ac2f62670a598dc4
```

이 주소가 나중에 데이터를 암호화하고 복호화할 때 사용됩니다.

### 2. 환경 설정

1. **의존성 설치:**
```bash
npm install
```

2. **환경 변수 설정:**
   - `.env` 파일을 생성하고 다음 변수를 설정하세요:
   ```bash
   # .env 파일
   PRIVATE_KEY=sui:ed25519:your_private_key_here
   ```
   
   > **참고:** `PRIVATE_KEY`는 `sui client active-address`로 확인한 주소에 해당하는 개인 키입니다.
   > `sui keytool export <key-name>` 명령어로 개인 키를 내보낼 수 있습니다.

## 🚀 사용 방법

### 1. 컨트랙트 배포 (deploy.sh)

Move 컨트랙트를 Sui 네트워크에 배포합니다:

```bash
cd pdata
./deploy.sh
```

이 스크립트는:
- `sui client publish` 명령어로 컨트랙트를 배포합니다
- 배포 결과에서 Package ID를 자동으로 추출합니다
- `../.env.public` 파일에 `PACKAGE_ID`를 자동으로 저장합니다

**출력 예시:**
```
🚀 Deploying pdata package...
✅ Deployment successful!
📦 Package ID: 0x6cd0297d61bdec85498e96464f5d28ab7a1e6de5dbe3800451a323d76132bdc0
✅ Updated ../.env.public with new PACKAGE_ID
```

### 2. 데이터 암호화 및 저장 (encrypt)

데이터를 Seal로 암호화하고 Sui 체인에 저장합니다:

```bash
npm run encrypt-sui-data
```

이 스크립트는:
- 랜덤 nonce를 생성합니다
- `compute_key_id` 함수를 사용하여 encryption ID를 계산합니다
- Seal SDK를 사용하여 데이터를 암호화합니다
- `store_entry` 함수를 호출하여 암호화된 데이터를 Sui 체인에 저장합니다
- 생성된 PrivateData 객체 ID를 출력합니다

**출력 예시:**
```
🔑 Storing Encrypted Data with Seal...
📝 User Address: 0xb6c3a4d0b862a77227ec760550a93f5c35ef8d4329d70d03ac2f62670a598dc4
📦 Package ID: 0x6cd0297d61bdec85498e96464f5d28ab7a1e6de5dbe3800451a323d76132bdc0

📌 Nonce (hex): 0x1234567890
📌 Key ID (hex): 0x...

🔐 Encrypting data with Seal...
✅ Data encrypted! Encrypted data length: 1234 bytes

📝 Preparing transaction...
🔗 Submitting transaction to Sui...
✅ Transaction executed! Digest: 0x...
📦 Stored PrivateData Object ID: 0x3c61b5bb1e5a621360751696680de2a799e20af319db10a2e829e9d640373580
```

**중요:** 출력된 `PrivateData Object ID`를 복호화할 때 사용하세요!

### 3. 저장된 데이터 복호화 (decrypt)

Sui 체인에 저장된 암호화된 데이터를 복호화합니다:

```bash
npm run decrypt-sui-data
```

**사용 방법:**

1. **대화형 입력 (추천):**
   ```bash
   npm run decrypt-sui-data
   ```
   프롬프트가 나타나면 복호화할 PrivateData 객체 ID를 입력하세요:
   ```
   📦 PrivateData 객체 복호화
   ==================================================
   
   🔍 복호화할 PrivateData 객체 ID를 입력하세요: 0x3c61b5bb1e5a621360751696680de2a799e20af319db10a2e829e9d640373580
   ```

2. **명령줄 인자로 전달:**
   ```bash
   npm run decrypt-sui-data 0x3c61b5bb1e5a621360751696680de2a799e20af319db10a2e829e9d640373580
   ```

3. **환경 변수 사용:**
   ```bash
   OBJECT_ID=0x3c61b5bb1e5a621360751696680de2a799e20af319db10a2e829e9d640373580 npm run decrypt-sui-data
   ```

이 스크립트는:
- PrivateData 객체를 Sui에서 가져옵니다
- `compute_key_id` 함수로 encryption ID를 재계산합니다
- `seal_approve` 트랜잭션을 생성합니다
- SessionKey를 생성하고 personal message에 서명합니다
- Seal SDK를 사용하여 데이터를 복호화합니다
- 복호화된 텍스트를 출력합니다

**출력 예시:**
```
🔓 Decrypting PrivateData object...
📦 Object ID: 0x3c61b5bb1e5a621360751696680de2a799e20af319db10a2e829e9d640373580

📥 Fetching object from Sui...
✅ Object fetched successfully
📋 Object Fields:
   - creator: 0xb6c3a4d0b862a77227ec760550a93f5c35ef8d4329d70d03ac2f62670a598dc4
   - nonce (hex): 0x1234567890
   - encrypted data length: 1234 bytes

🔑 Computed Key ID (hex): 0x...

📝 Creating seal_approve transaction...
🔨 Building transaction bytes...
✅ Transaction bytes created: 567 bytes

🔐 Decrypting with Seal...
📝 Signing personal message...
✅ Personal message signed

✅ Decryption successful!
📄 Decrypted data: "This is my secret diary."
📊 Decrypted data length: 24 bytes
```

## 📁 파일 구조

```
seal-examples/
├── pdata/                    # Move 컨트랙트
│   ├── sources/
│   │   └── pdata.move        # PrivateData 패턴 컨트랙트
│   └── deploy.sh             # 배포 스크립트
├── scripts/                  # TypeScript 스크립트
│   ├── encrypt_sui_data.ts   # 암호화 및 저장
│   └── decrypt_sui_data.ts   # 복호화
├── .env.public               # 공개 환경 변수 (Git에 커밋 가능)
├── .env                      # 개인 환경 변수 (Git에 커밋하지 마세요!)
└── README.ko.md             # 이 파일
```

## 🔐 환경 변수

### 공개 변수 (`.env.public`)
- `PACKAGE_ID`: 배포된 pdata 패키지 ID (자동으로 업데이트됨)

### 개인 변수 (`.env`)
- `PRIVATE_KEY`: Sui Ed25519 개인 키 (필수)
  - 형식: `sui:ed25519:...`
  - `sui keytool export <key-name>` 명령어로 내보낼 수 있습니다

### 선택적 변수
- `OBJECT_ID`: 복호화할 PrivateData 객체 ID (decrypt 스크립트용)

## 🔍 전체 워크플로우

1. **준비:**
   ```bash
   # 1. 활성 주소 확인
   sui client active-address
   
   # 2. 의존성 설치
   npm install
   
   # 3. .env 파일 설정 (PRIVATE_KEY)
   ```

2. **배포:**
   ```bash
   cd pdata
   ./deploy.sh
   ```

3. **암호화 및 저장:**
   ```bash
   npm run encrypt-sui-data
   # 출력된 PrivateData Object ID를 복사하세요!
   ```

4. **복호화:**
   ```bash
   npm run decrypt-sui-data
   # 프롬프트에 PrivateData Object ID를 입력하세요
   ```

## ⚠️ 주의사항

- `PRIVATE_KEY`는 절대 Git에 커밋하지 마세요!
- `.env.public` 파일은 공개 정보만 포함하므로 Git에 커밋해도 됩니다
- Seal 서버 설정은 testnet용으로 하드코딩되어 있습니다
- `compute_key_id` 함수는 Move의 `compute_key_id` 로직을 TypeScript로 재현한 것입니다

## 🔗 참고 링크

- [Seal 문서](https://seal-docs.wal.app/)
- [Sui 문서](https://docs.sui.io/)
- [SuiScan (Testnet)](https://suiscan.xyz/testnet/)

