import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { fromHex, toHex } from '@mysten/sui/utils';
import { SealClient, SessionKey } from '@mysten/seal';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
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
const MODULE_NAME = 'private_data';

// Seal 서버 설정 (setup_game.ts와 동일)
const serverObjectIds = [
    "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
    "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8"
];

const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY!);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);
const suiClient = new SuiClient({ url: getFullnodeUrl(NETWORK) });

// SealClient 초기화
const sealClient = new SealClient({
    suiClient: suiClient,
    serverConfigs: serverObjectIds.map((id) => ({
        objectId: id,
        weight: 1,
    })),
    verifyKeyServers: false,
});

/**
 * Move의 compute_key_id 함수를 TypeScript로 재현
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
 * 저장된 PrivateData 객체를 복호화하는 함수
 */
async function decryptPData(objectId: string, sessionKey?: Uint8Array) {
    console.log(`\n🔓 Decrypting PrivateData object...`);
    console.log(`📦 Object ID: ${objectId}`);
    
    try {
        // 1. PrivateData 객체 가져오기
        console.log(`\n📥 Fetching object from Sui...`);
        const objectDetails = await suiClient.getObject({
            id: objectId,
            options: { showContent: true }
        });
        
        if (!objectDetails.data?.content || !('fields' in objectDetails.data.content)) {
            throw new Error('Failed to get object details or invalid object type');
        }
        
        const fields = objectDetails.data.content.fields as Record<string, unknown>;
        const creator = fields.creator as string;
        const storedNonce = fields.nonce as number[];
        const storedData = fields.data as number[];
        
        console.log(`✅ Object fetched successfully`);
        console.log(`📋 Object Fields:`);
        console.log(`   - creator: ${creator}`);
        console.log(`   - nonce (hex): ${toHex(new Uint8Array(storedNonce))}`);
        console.log(`   - encrypted data length: ${storedData.length} bytes`);
        
        // 2. compute_key_id로 encryption ID 계산
        const nonceBytes = new Uint8Array(storedNonce);
        const keyId = computeKeyId(creator, nonceBytes);
        const encryptionId = toHex(keyId);
        
        console.log(`\n🔑 Computed Key ID (hex): ${encryptionId}`);
        
        // 3. 저장된 암호화된 데이터 가져오기
        const encryptedBytes = new Uint8Array(storedData);
        console.log(`📦 Encrypted data: ${encryptedBytes.length} bytes`);
        
        // 4. seal_approve 트랜잭션 생성
        console.log(`\n📝 Creating seal_approve transaction...`);
        const tx = new Transaction();
        
        tx.moveCall({
            target: `${PACKAGE_ID}::${MODULE_NAME}::seal_approve`,
            arguments: [
                tx.pure.vector("u8", Array.from(keyId)),
                tx.object(objectId),
            ]
        });
        
        // 5. 트랜잭션 바이트 생성 (onlyTransactionKind: true)
        console.log(`🔨 Building transaction bytes...`);
        const txBytes = await tx.build({ 
            client: suiClient, 
            onlyTransactionKind: true 
        });
        
        console.log(`✅ Transaction bytes created: ${txBytes.length} bytes`);
        
        // 6. Seal로 복호화
        console.log(`\n🔐 Decrypting with Seal...`);

        // SessionKey 생성
        const sessionKeyObj = await SessionKey.create({
            address: keypair.toSuiAddress(),
            packageId: PACKAGE_ID,
            ttlMin: 10,
            suiClient,
        });
        
        // Personal message 가져오기 및 서명
        console.log(`📝 Signing personal message...`);
        const personalMessage = sessionKeyObj.getPersonalMessage();
        const signature = await keypair.signPersonalMessage(personalMessage);
        
        // 서명을 SessionKey에 설정
        await sessionKeyObj.setPersonalMessageSignature(signature.signature);
        console.log(`✅ Personal message signed`);
        
        // Seal로 복호화
        const decryptedData = await sealClient.decrypt({
            data: new Uint8Array(encryptedBytes),
            sessionKey: sessionKeyObj,
            txBytes,
        });
        
        // 7. 복호화된 데이터 출력
        const decryptedText = new TextDecoder().decode(decryptedData);
        console.log(`\n✅ Decryption successful!`);
        console.log(`📄 Decrypted data: "${decryptedText}"`);
        console.log(`📊 Decrypted data length: ${decryptedData.length} bytes`);
        console.log(`🔑 Encryption ID used: ${encryptionId}`);
        
        return {
            decryptedData,
            decryptedText,
            encryptionId,
            objectId,
        };
        
    } catch (error) {
        console.error(`\n❌ Failed to decrypt:`, error);
        throw error;
    }
}

/**
 * 사용자로부터 객체 ID를 입력받는 함수
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
 * 메인 실행 함수
 */
async function main() {
    // 1. 명령줄 인자에서 객체 ID 확인
    let objectId: string | undefined = process.argv[2];
    
    // 2. 명령줄 인자가 없으면 환경 변수 확인
    if (!objectId) {
        objectId = process.env.OBJECT_ID;
    }
    
    // 3. 환경 변수도 없으면 사용자에게 입력 요청
    if (!objectId) {
        console.log('\n📦 PrivateData 객체 복호화');
        console.log('='.repeat(50));
        const userInput = await getUserInput('\n🔍 복호화할 PrivateData 객체 ID를 입력하세요: ');
        
        if (!userInput) {
            console.error('❌ 객체 ID가 입력되지 않았습니다.');
            process.exit(1);
        }
        
        objectId = userInput;
    }
    
    // 객체 ID 형식 검증 (0x로 시작하는지 확인)
    if (!objectId.startsWith('0x')) {
        console.error('❌ 잘못된 객체 ID 형식입니다. 0x로 시작해야 합니다.');
        process.exit(1);
    }
    
    console.log(`\n📦 사용할 객체 ID: ${objectId}`);
    
    // sessionKey는 환경 변수나 명령줄 인자로 받을 수 있음
    // 예: SESSION_KEY=0x1234... npm run decrypt-sui-data
    const sessionKeyHex = process.env.SESSION_KEY;
    const sessionKey = sessionKeyHex ? fromHex(sessionKeyHex.startsWith('0x') ? sessionKeyHex.slice(2) : sessionKeyHex) : undefined;
    
    // objectId는 위에서 검증했으므로 string으로 확정됨
    await decryptPData(objectId, sessionKey);
}

// 메인 실행
main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});

