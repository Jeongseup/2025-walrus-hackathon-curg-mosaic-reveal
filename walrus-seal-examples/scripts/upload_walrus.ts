import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { fromHex, toHex } from '@mysten/sui/utils';
import { SealClient } from '@mysten/seal';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
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
const NUM_EPOCH = 1;

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

// Walrus 서비스 설정 (EncryptAndUpload.tsx 참고)
// https://github.com/MystenLabs/seal/blob/main/examples/frontend/src/EncryptAndUpload.tsx
const WALRUS_PUBLISHER_URL = process.env.WALRUS_PUBLISHER_URL || 'https://publisher.walrus-testnet.walrus.space';
const WALRUS_AGGREGATOR_URL = process.env.WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space';

/**
 * Move의 compute_key_id 함수를 TypeScript로 재현
 * encrypt_sui_data.ts와 동일한 방식
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
 * Walrus에 blob 업로드 (EncryptAndUpload.tsx의 storeBlob 함수 참고)
 * https://github.com/MystenLabs/seal/blob/main/examples/frontend/src/EncryptAndUpload.tsx
 */
async function storeBlob(encryptedData: Uint8Array): Promise<{ info: any }> {
    const publisherUrl = `${WALRUS_PUBLISHER_URL}/v1/blobs?epochs=${NUM_EPOCH}`;
    
    console.log(`📤 Uploading to Walrus publisher: ${publisherUrl}`);
    
    // Uint8Array를 Buffer로 변환하여 fetch에 전달
    const response = await fetch(publisherUrl, {
        method: 'PUT',
        body: Buffer.from(encryptedData),
    });

    if (response.status !== 200) {
        throw new Error(`Failed to upload blob: HTTP ${response.status}`);
    }

    const info = await response.json();
    return { info };
}

/**
 * 업로드 결과에서 blobId 추출 (EncryptAndUpload.tsx의 displayUpload 함수 참고)
 */
function extractBlobInfo(storageInfo: any): {
    blobId: string;
    endEpoch: string;
    suiRefType: string;
    suiRef: string;
    status: string;
} {
    if ('alreadyCertified' in storageInfo) {
        return {
            blobId: storageInfo.alreadyCertified.blobId,
            endEpoch: storageInfo.alreadyCertified.endEpoch,
            suiRefType: 'Previous Sui Certified Event',
            suiRef: storageInfo.alreadyCertified.event.txDigest,
            status: 'Already certified',
        };
    } else if ('newlyCreated' in storageInfo) {
        return {
            blobId: storageInfo.newlyCreated.blobObject.blobId,
            endEpoch: storageInfo.newlyCreated.blobObject.storage.endEpoch,
            suiRefType: 'Associated Sui Object',
            suiRef: storageInfo.newlyCreated.blobObject.id,
            status: 'Newly created',
        };
    } else {
        throw new Error('Unhandled successful response!');
    }
}

/**
 * 메인 함수: 데이터 암호화 및 Walrus 업로드
 * EncryptAndUpload.tsx 참고: https://github.com/MystenLabs/seal/blob/main/examples/frontend/src/EncryptAndUpload.tsx
 */
async function main() {
    console.log(`\n🚀 Uploading Encrypted Secret Key to Walrus...`);
    console.log(`📝 User Address: ${keypair.toSuiAddress()}`);
    console.log(`📦 Package ID: ${PACKAGE_ID}`);

    // 1. secret-key.txt 파일 읽기
    const secretKeyPath = path.join(__dirname, '../secret-key.txt');
    if (!fs.existsSync(secretKeyPath)) {
        console.error(`❌ Secret key file not found: ${secretKeyPath}`);
        console.log(`💡 Generating secret key...`);
        // secret-key가 없으면 생성
        const { execSync } = await import('child_process');
        execSync(`openssl rand -hex 32 > ${secretKeyPath}`, { stdio: 'inherit' });
    }

    const secretKeyHex = fs.readFileSync(secretKeyPath, 'utf-8').trim();
    const dataBytes = fromHex(secretKeyHex.startsWith('0x') ? secretKeyHex.slice(2) : secretKeyHex);
    
    console.log(`\n📄 Secret key loaded from: ${secretKeyPath}`);
    console.log(`📊 Secret key size: ${dataBytes.length} bytes (${secretKeyHex.length / 2} hex chars)`);
    console.log(`🔐 Secret key (hex): ${secretKeyHex.slice(0, 16)}...${secretKeyHex.slice(-16)}`);

    // 2. Encryption ID 생성 (encrypt_sui_data.ts와 동일한 방식)
    // compute_key_id(sender, nonce) = [sender bytes][nonce]
    const nonce = crypto.getRandomValues(new Uint8Array(5));
    const keyId = computeKeyId(keypair.toSuiAddress(), nonce);
    const encryptionId = toHex(keyId);
    
    console.log(`\n🔑 Encryption ID (hex): ${encryptionId}`);
    console.log(`📌 Nonce (hex): ${toHex(nonce)}`);
    console.log(`📝 Sender Address: ${keypair.toSuiAddress()}`);

    // 3. Seal로 데이터 암호화
    console.log(`\n🔐 Encrypting secret key with Seal...`);
    const { encryptedObject: encryptedData } = await sealClient.encrypt({
        threshold: 2,
        packageId: PACKAGE_ID,
        id: encryptionId,
        data: dataBytes,
    });
    console.log(`✅ Secret key encrypted! Encrypted size: ${encryptedData.length} bytes`);

    // 4. Walrus에 업로드 (EncryptAndUpload.tsx의 storeBlob 함수 사용)
    console.log(`\n📤 Uploading encrypted blob to Walrus...`);
    const storageInfo = await storeBlob(encryptedData);
    const blobInfo = extractBlobInfo(storageInfo.info);

    console.log(`\n✅ Upload successful!`);
    console.log(`📦 Status: ${blobInfo.status}`);
    console.log(`📦 Blob ID: ${blobInfo.blobId}`);
    console.log(`📅 End Epoch: ${blobInfo.endEpoch}`);
    console.log(`🔗 ${blobInfo.suiRefType}: ${blobInfo.suiRef}`);
    console.log(`🔍 Walrus Aggregator URL: ${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobInfo.blobId}`);
    console.log(`🔍 SuiScan URL: https://suiscan.xyz/testnet/object/${blobInfo.suiRef}`);

    // 5. 결과 저장
    const outputDir = path.join(__dirname, '../tmp/walrus');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const saveResultsPath = path.join(outputDir, 'upload_results.json');
    const uploadInfo = {
        timestamp: new Date().toISOString(),
        secretKeyPath,
        blobId: blobInfo.blobId,
        encryptionId,
        endEpoch: blobInfo.endEpoch,
        status: blobInfo.status,
        suiRefType: blobInfo.suiRefType,
        suiRef: blobInfo.suiRef,
        walrusAggregatorUrl: `${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobInfo.blobId}`,
        suiScanUrl: `https://suiscan.xyz/testnet/object/${blobInfo.suiRef}`,
    };
    
    fs.writeFileSync(saveResultsPath, JSON.stringify(uploadInfo, null, 2));
    console.log(`\n💾 Upload info saved to: ${saveResultsPath}`);
    console.log(`\n📋 To decrypt this blob, use:`);
    console.log(`   npm run download-walrus ${blobInfo.blobId} ${encryptionId}`);
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});

