import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { fromHex, toHex } from '@mysten/sui/utils';
import { SealClient } from '@mysten/seal';
import { Transaction } from '@mysten/sui/transactions';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import readline from 'readline';

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

// Walrus 서비스 설정
const WALRUS_PUBLISHER_URL = process.env.WALRUS_PUBLISHER_URL || 'https://publisher.walrus-testnet.walrus.space';
const WALRUS_AGGREGATOR_URL = process.env.WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space';

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
 * 현재 계정이 소유한 모든 Cap 객체들을 가져옴
 */
async function getAllCaps(): Promise<Array<{ id: string; allowlist_id: string }>> {
    console.log(`\n🔍 Loading all Cap objects for address: ${keypair.toSuiAddress()}`);
    
    const res = await baseSuiClient.getOwnedObjects({
        owner: keypair.toSuiAddress(),
        options: {
            showContent: true,
            showType: true,
        },
        filter: {
            StructType: `${PACKAGE_ID}::allowlist::Cap`,
        },
    });

    const caps = res.data
        .map((obj) => {
            if (!obj.data?.content || typeof obj.data.content !== 'object' || !('fields' in obj.data.content)) {
                return null;
            }
            const fields = (obj.data.content as { fields: any }).fields;
            return {
                id: fields?.id?.id || fields?.id,
                allowlist_id: fields?.allowlist_id || fields?.allowlist_id?.id,
            };
        })
        .filter((item): item is { id: string; allowlist_id: string } => 
            item !== null && item.id && item.allowlist_id
        );

    console.log(`✅ Found ${caps.length} Cap object(s)`);
    return caps;
}

/**
 * Allowlist 객체를 가져옴
 */
async function getAllowlist(allowlistId: string) {
    try {
        const allowlist = await baseSuiClient.getObject({
            id: allowlistId,
            options: { showContent: true },
        });

        if (!allowlist.data?.content || typeof allowlist.data.content !== 'object' || !('fields' in allowlist.data.content)) {
            throw new Error('Invalid allowlist object');
        }

        const fields = (allowlist.data.content as { fields: any }).fields || {};
        
        return {
            id: allowlistId,
            name: fields.name || 'N/A',
            list: fields.list || [],
        };
    } catch (error) {
        console.error(`❌ Failed to load allowlist: ${error}`);
        throw error;
    }
}

/**
 * Walrus에 blob 업로드
 */
async function storeBlob(encryptedData: Uint8Array): Promise<{ info: any }> {
    const publisherUrl = `${WALRUS_PUBLISHER_URL}/v1/blobs?epochs=${NUM_EPOCH}`;
    
    console.log(`📤 Uploading to Walrus publisher: ${publisherUrl}`);
    
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
 * 업로드 결과에서 blobId 추출
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
 * Allowlist에 blob publish
 */
async function publishToAllowlist(
    allowlistId: string,
    capId: string,
    blobId: string
): Promise<void> {
    console.log(`\n📝 Publishing blob to allowlist...`);
    console.log(`   Allowlist ID: ${allowlistId}`);
    console.log(`   Cap ID: ${capId}`);
    console.log(`   Blob ID: ${blobId}`);

    const tx = new Transaction();
    
    tx.moveCall({
        target: `${PACKAGE_ID}::allowlist::publish`,
        arguments: [
            tx.object(allowlistId),
            tx.object(capId),
            tx.pure.string(blobId)
        ],
    });
    
    tx.setGasBudget(10000000);

    console.log(`🔨 Building transaction...`);
    const result = await baseSuiClient.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: {
            showRawEffects: true,
            showEffects: true,
            showEvents: true,
        },
    });

    console.log(`✅ Transaction executed successfully!`);
    console.log(`📋 Transaction Digest: ${result.digest}`);
    console.log(`🔗 SuiScan URL: https://suiscan.xyz/testnet/txblock/${result.digest}`);
}

/**
 * 메인 함수
 */
async function main() {
    console.log(`\n🚀 Upload Secret Key to Walrus and Publish to Allowlist`);
    console.log(`📝 User Address: ${keypair.toSuiAddress()}`);
    console.log(`📦 Package ID: ${PACKAGE_ID}`);
    console.log(`🌐 Network: ${NETWORK}`);

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

    // 2. 모든 Cap 객체 가져오기
    const allCaps = await getAllCaps();
    
    if (allCaps.length === 0) {
        console.log(`\n⚠️  No Cap objects found for address: ${keypair.toSuiAddress()}`);
        console.log(`💡 You need to create an allowlist first.`);
        console.log(`   Run: npm run create-allowlist`);
        process.exit(1);
    }

    // 3. Cap 선택 (하나면 자동 선택, 여러 개면 선택)
    let selectedCap: { id: string; allowlist_id: string };
    let allowlistId: string;
    let capId: string;

    if (allCaps.length === 1) {
        // Cap이 하나면 자동 선택
        selectedCap = allCaps[0];
        allowlistId = selectedCap.allowlist_id;
        capId = selectedCap.id;
        console.log(`\n✅ Using the only available Cap:`);
        console.log(`   Cap ID: ${capId}`);
        console.log(`   Allowlist ID: ${allowlistId}`);
    } else {
        // 여러 Cap이 있으면 선택
        console.log(`\n📋 Found ${allCaps.length} Cap object(s). Please select one:`);
        console.log('='.repeat(50));
        
        // 각 Cap에 대한 allowlist 정보 가져오기
        const capInfos = await Promise.all(
            allCaps.map(async (cap) => {
                try {
                    const allowlist = await getAllowlist(cap.allowlist_id);
                    return {
                        cap,
                        allowlistName: allowlist.name,
                        memberCount: allowlist.list.length,
                    };
                } catch (error) {
                    return {
                        cap,
                        allowlistName: 'N/A',
                        memberCount: 0,
                    };
                }
            })
        );

        capInfos.forEach((info, index) => {
            console.log(`\n${index + 1}. Allowlist: ${info.allowlistName}`);
            console.log(`   Allowlist ID: ${info.cap.allowlist_id}`);
            console.log(`   Cap ID: ${info.cap.id}`);
            console.log(`   Members: ${info.memberCount} address(es)`);
        });

        const input = await getUserInput(`\n🔢 Select Cap (1-${allCaps.length}): `);
        const selectedIndex = parseInt(input.trim()) - 1;

        if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= allCaps.length) {
            console.error(`❌ Invalid selection. Please choose a number between 1 and ${allCaps.length}.`);
            process.exit(1);
        }

        selectedCap = allCaps[selectedIndex];
        allowlistId = selectedCap.allowlist_id;
        capId = selectedCap.id;
        
        console.log(`\n✅ Selected:`);
        console.log(`   Cap ID: ${capId}`);
        console.log(`   Allowlist ID: ${allowlistId}`);
    }

    // 4. Encryption ID 생성 (React 코드 방식: policyObjectBytes + nonce)
    // React 코드: const policyObjectBytes = fromHex(policyObject);
    //            const id = toHex(new Uint8Array([...policyObjectBytes, ...nonce]));
    const policyObjectBytes = fromHex(allowlistId.startsWith('0x') ? allowlistId.slice(2) : allowlistId);
    const nonce = crypto.getRandomValues(new Uint8Array(5));
    const encryptionId = toHex(new Uint8Array([...policyObjectBytes, ...nonce]));
    
    console.log(`\n🔑 Encryption ID (hex): ${encryptionId}`);
    console.log(`📌 Nonce (hex): ${toHex(nonce)}`);
    console.log(`📝 Allowlist ID: ${allowlistId}`);

    // 5. Seal로 데이터 암호화
    console.log(`\n🔐 Encrypting secret key with Seal...`);
    const { encryptedObject: encryptedData } = await sealClient.encrypt({
        threshold: 2,
        packageId: PACKAGE_ID,
        id: encryptionId,
        data: dataBytes,
    });
    console.log(`✅ Secret key encrypted! Encrypted size: ${encryptedData.length} bytes`);

    // 6. Walrus에 업로드
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

    // 7. Allowlist에 publish
    await publishToAllowlist(allowlistId, capId, blobInfo.blobId);

    // 8. 결과 저장
    const outputDir = path.join(__dirname, '../tmp/walrus');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const saveResultsPath = path.join(outputDir, 'upload_secret_key_results.json');
    const uploadInfo = {
        timestamp: new Date().toISOString(),
        secretKeyPath,
        allowlistId,
        capId,
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
    console.log(`\n✅ Successfully uploaded secret key and published to allowlist!`);
    console.log(`\n📋 Summary:`);
    console.log(`   - Allowlist ID: ${allowlistId}`);
    console.log(`   - Cap ID: ${capId}`);
    console.log(`   - Blob ID: ${blobInfo.blobId}`);
    console.log(`   - Encryption ID: ${encryptionId}`);
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});

