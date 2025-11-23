import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { fromHex, toHex } from '@mysten/sui/utils';
import { SealClient, SessionKey, NoAccessError, EncryptedObject } from '@mysten/seal';
import { Transaction } from '@mysten/sui/transactions';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import fs from 'fs';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.public first (public variables)
dotenv.config({ path: path.join(__dirname, '../.env.public') });

// Then load .env (private variables, will override .env.public if same key exists)
dotenv.config({ path: path.join(__dirname, '../.env') });

// --- 환경 변수 체크 ---
if (!process.env.PRIVATE_KEY) {
    throw new Error("❌ PRIVATE_KEY environment variable missing");
}
if (!process.env.PACKAGE_ID) {
    throw new Error("❌ PACKAGE_ID environment variable missing");
}

const NETWORK = 'testnet';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const PACKAGE_ID = process.env.PACKAGE_ID;
const MODULE_NAME = 'private_data';

// Seal 서버 설정
const serverObjectIds = [
    "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
    "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8"
];

const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY!);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);
const baseSuiClient = new SuiClient({ url: getFullnodeUrl(NETWORK) });

// SealClient 초기화
const sealClient = new SealClient({
    suiClient: baseSuiClient,
    serverConfigs: serverObjectIds.map((id) => ({
        objectId: id,
        weight: 1,
    })),
    verifyKeyServers: false,
});

// Walrus Aggregator URLs (utils.ts 참고)
// https://github.com/MystenLabs/seal/blob/main/examples/frontend/src/utils.ts
const WALRUS_AGGREGATOR_URLS = [
    'https://aggregator.walrus-testnet.walrus.space',
];

/**
 * Move의 compute_key_id 함수를 TypeScript로 재현
 * decrypt_sui_data.ts와 동일한 방식
 * 
 * Move 코드:
 * fun compute_key_id(sender: address, nonce: vector<u8>): vector<u8> {
 *     let mut blob = sender.to_bytes();
 *     blob.append(nonce);
 *     blob
 * }
 */
function computeKeyId(sender: string, nonce: Uint8Array): Uint8Array {
    const senderHex = sender.startsWith('0x') ? sender.slice(2) : sender;
    const senderBytes = fromHex(senderHex);
    
    const keyId = new Uint8Array(senderBytes.length + nonce.length);
    keyId.set(senderBytes, 0);
    keyId.set(nonce, senderBytes.length);
    
    return keyId;
}


/**
 * 사용자로부터 입력받는 함수
 */
function getUserInput(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * Walrus에서 blob 다운로드 (utils.ts의 downloadAndDecrypt 함수 참고)
 * https://github.com/MystenLabs/seal/blob/main/examples/frontend/src/utils.ts
 */
async function downloadBlobFromWalrus(blobId: string): Promise<ArrayBuffer | null> {
    // 여러 aggregator를 랜덤하게 시도
    const aggregators = WALRUS_AGGREGATOR_URLS;
    const randomAggregator = aggregators[Math.floor(Math.random() * aggregators.length)];
    const aggregatorUrl = `${randomAggregator}/v1/blobs/${blobId}`;
    
    console.log(`📥 Downloading from aggregator: ${randomAggregator}`);
    
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10초 타임아웃
        
        const response = await fetch(aggregatorUrl, { signal: controller.signal });
        clearTimeout(timeout);
        
        if (!response.ok) {
            console.warn(`⚠️ Failed to download from ${randomAggregator}: HTTP ${response.status}`);
            return null;
        }
        
        return await response.arrayBuffer();
    } catch (err) {
        console.error(`❌ Blob ${blobId} cannot be retrieved from ${randomAggregator}`, err);
        return null;
    }
}

/**
 * Walrus에서 blob 다운로드 및 Seal로 복호화 (단일 파일용)
 * decrypt_pdata.ts 패턴 참고
 */
async function downloadAndDecrypt(
    blobId: string,
    sessionKey: SessionKey
): Promise<Uint8Array> {
    console.log(`\n🔓 Downloading and Decrypting blob from Walrus...`);

    // 1. blob 다운로드
    console.log(`\n📥 Downloading blob...`);
    const downloadResult = await downloadBlobFromWalrus(blobId);
    
    if (!downloadResult) {
        const errorMsg =
            'Cannot retrieve file from Walrus aggregators. File uploaded more than 1 epoch ago may have been deleted.';
        throw new Error(errorMsg);
    }
    
    console.log(`✅ Downloaded blob: ${downloadResult.byteLength} bytes`);

    // 2. EncryptedObject에서 id 추출
    const encryptedData = new Uint8Array(downloadResult);
    const encryptedObject = EncryptedObject.parse(encryptedData);
    // id는 hex string이므로 Uint8Array로 변환
    const keyIdHex = typeof encryptedObject.id === 'string' 
        ? encryptedObject.id 
        : toHex(encryptedObject.id);
    const keyId = fromHex(keyIdHex.startsWith('0x') ? keyIdHex.slice(2) : keyIdHex);
    
    console.log(`\n🔑 Extracted encryption ID: ${toHex(keyId)}`);

    // 3. seal_approve 트랜잭션 생성 (decrypt_pdata.ts 패턴)
    console.log(`\n📝 Creating seal_approve transaction...`);
    const tx = new Transaction();
    
    tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_NAME}::seal_approve`,
        arguments: [
            tx.pure.vector("u8", Array.from(keyId)),
        ]
    });
    
    const txBytes = await tx.build({ 
        client: baseSuiClient, 
        onlyTransactionKind: true 
    });
    
    console.log(`✅ Transaction bytes created: ${txBytes.length} bytes`);

    // 4. Seal로 복호화
    console.log(`\n🔐 Decrypting with Seal...`);
    try {
        const decryptedData = await sealClient.decrypt({
            data: encryptedData,
            sessionKey,
            txBytes,
        });
        
        console.log(`✅ Decrypted successfully: ${decryptedData.length} bytes`);
        return decryptedData;
    } catch (err) {
        const errorMsg =
            err instanceof NoAccessError
                ? 'No access to decryption keys'
                : 'Unable to decrypt file';
        console.error(`❌ ${errorMsg}`, err);
        throw err;
    }
}

/**
 * 메인 함수
 * utils.ts와 AllowlistView.tsx 패턴 참고
 * https://github.com/MystenLabs/seal/blob/main/examples/frontend/src/utils.ts
 * https://github.com/MystenLabs/seal/blob/main/examples/frontend/src/AllowlistView.tsx
 */
async function main() {
    console.log(`\n🔓 Downloading and Decrypting from Walrus...`);
    console.log(`📝 User Address: ${keypair.toSuiAddress()}`);
    console.log(`📦 Package ID: ${PACKAGE_ID}`);

    // 1. 명령줄 인자에서 blob ID 확인
    let blobId: string | undefined;
    
    if (process.argv.length > 2) {
        blobId = process.argv[2];
    } else {
        // upload_results.json에서 blob ID 찾기 시도
        const uploadResultsPath = path.join(__dirname, '../tmp/walrus/upload_results.json');
        if (fs.existsSync(uploadResultsPath)) {
            try {
                const uploadInfo = JSON.parse(fs.readFileSync(uploadResultsPath, 'utf-8'));
                if (uploadInfo.blobId) {
                    blobId = uploadInfo.blobId;
                    console.log(`\n📌 Found blob ID from upload results: ${blobId}`);
                }
            } catch (e) {
                // 무시
            }
        }

        // 사용자 입력 요청
        if (!blobId) {
            console.log('\n📦 Walrus Blob 다운로드 및 복호화');
            console.log('='.repeat(50));
            const blobIdInput = await getUserInput('\n🔍 다운로드할 Blob ID를 입력하세요: ');
            
            if (!blobIdInput) {
                console.error('❌ Blob ID가 입력되지 않았습니다.');
                process.exit(1);
            }
            
            blobId = blobIdInput.trim();
        }
    }

    if (!blobId) {
        console.error('❌ Blob ID가 없습니다.');
        process.exit(1);
    }

    console.log(`\n📦 Blob ID: ${blobId}`);

    // 2. SessionKey 생성 및 서명
    console.log(`\n🔑 Creating SessionKey...`);
    const sessionKey = await SessionKey.create({
        address: keypair.toSuiAddress(),
        packageId: PACKAGE_ID,
        ttlMin: 10,
        suiClient: baseSuiClient,
    });
    
    const personalMessage = sessionKey.getPersonalMessage();
    const signature = await keypair.signPersonalMessage(personalMessage);
    await sessionKey.setPersonalMessageSignature(signature.signature);
    console.log(`✅ SessionKey created and signed`);

    // 3. blob 다운로드 및 복호화
    try {
        const decryptedData = await downloadAndDecrypt(blobId, sessionKey);

        // 4. 복호화된 데이터 저장
        const outputDir = path.join(__dirname, '../tmp/walrus/decrypted');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Secret key는 hex 문자열로 저장
        const decryptedHex = Buffer.from(decryptedData).toString('hex');
        const outputPath = path.join(outputDir, `decrypted_${blobId.slice(0, 8)}.hex`);
        fs.writeFileSync(outputPath, decryptedHex);
        
        console.log(`\n✅ Decryption successful!`);
        console.log(`\n📄 Decrypted data:`);
        console.log(`   Hex: ${decryptedHex.slice(0, 32)}...${decryptedHex.slice(-32)}`);
        console.log(`   Size: ${decryptedData.length} bytes`);
        console.log(`   Saved to: ${outputPath}`);

    } catch (error) {
        console.error(`\n❌ Failed to download and decrypt:`, error);
        throw error;
    }
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});

