import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
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

const NETWORK = 'testnet';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY!);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);

// Walrus Aggregator URLs
const WALRUS_AGGREGATOR_URLS = [
    'https://aggregator.walrus-testnet.walrus.space',
];

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
 * Walrus에서 blob 다운로드
 * 여러 aggregator를 시도하여 다운로드
 */
async function downloadBlobFromWalrus(blobId: string): Promise<ArrayBuffer | null> {
    const aggregators = WALRUS_AGGREGATOR_URLS;
    
    // 여러 aggregator를 시도
    for (const aggregator of aggregators) {
        const aggregatorUrl = `${aggregator}/v1/blobs/${blobId}`;
        
        console.log(`📥 Trying to download from: ${aggregator}`);
        
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10초 타임아웃
            
            const response = await fetch(aggregatorUrl, { signal: controller.signal });
            clearTimeout(timeout);
            
            if (response.ok) {
                console.log(`✅ Successfully downloaded from: ${aggregator}`);
                return await response.arrayBuffer();
            } else {
                console.warn(`⚠️ Failed to download from ${aggregator}: HTTP ${response.status}`);
            }
        } catch (err) {
            console.warn(`⚠️ Error downloading from ${aggregator}:`, err);
        }
    }
    
    return null;
}

/**
 * 메인 함수
 */
async function main() {
    console.log(`\n📥 Download Encrypted Key from Walrus`);
    console.log(`📝 User Address: ${keypair.toSuiAddress()}`);
    console.log(`🌐 Network: ${NETWORK}`);

    // 1. 명령줄 인자에서 blob ID 확인
    let blobId: string | undefined;
    
    if (process.argv.length > 2) {
        blobId = process.argv[2];
    } else {
        // 사용자 입력 요청
        console.log('\n📦 Encrypted Key 다운로드');
        console.log('='.repeat(50));
        const input = await getUserInput('\n🔍 다운로드할 Blob ID를 입력하세요: ');
        
        if (!input) {
            console.error('❌ Blob ID가 입력되지 않았습니다.');
            process.exit(1);
        }
        
        blobId = input.trim();
    }

    if (!blobId) {
        console.error('❌ Blob ID가 없습니다.');
        process.exit(1);
    }

    console.log(`\n📦 Blob ID: ${blobId}`);

    try {
        // 2. Blob 다운로드
        console.log(`\n📥 Downloading encrypted blob from Walrus...`);
        const downloadResult = await downloadBlobFromWalrus(blobId);
        
        if (!downloadResult) {
            const errorMsg =
                'Cannot retrieve file from Walrus aggregators. File uploaded more than 1 epoch ago may have been deleted.';
            console.error(`\n❌ ${errorMsg}`);
            process.exit(1);
        }
        
        console.log(`✅ Downloaded blob: ${downloadResult.byteLength} bytes`);

        // 3. 암호화된 데이터 저장
        const outputDir = path.join(__dirname, '../tmp/walrus/encrypted');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputPath = path.join(outputDir, `encrypted_${blobId.slice(0, 8)}.bin`);
        fs.writeFileSync(outputPath, Buffer.from(downloadResult));
        
        console.log(`\n✅ Download successful!`);
        console.log(`📄 Encrypted data saved to: ${outputPath}`);
        console.log(`📊 File size: ${downloadResult.byteLength} bytes`);

    } catch (error) {
        console.error(`\n❌ Failed to download:`, error);
        throw error;
    }
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});

