import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
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

const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY!);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);
const suiClient = new SuiClient({ url: getFullnodeUrl(NETWORK) });

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
    
    const res = await suiClient.getOwnedObjects({
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
 * 특정 allowlist id에 대한 Cap을 찾음
 */
async function findCapForAllowlist(allowlistId: string): Promise<string | null> {
    const caps = await getAllCaps();
    
    const matchingCaps = caps.filter((item) => item.allowlist_id === allowlistId);
    
    if (matchingCaps.length === 0) {
        return null;
    }
    
    return matchingCaps[0].id;
}

/**
 * Allowlist 객체를 가져옴
 */
async function getAllowlist(allowlistId: string) {
    console.log(`\n📋 Loading allowlist: ${allowlistId}`);
    
    try {
        const allowlist = await suiClient.getObject({
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
 * 메인 함수
 */
async function main() {
    console.log(`\n🔍 Checking Allowlist Objects`);
    console.log(`📝 User Address: ${keypair.toSuiAddress()}`);
    console.log(`📦 Package ID: ${PACKAGE_ID}`);
    console.log(`🌐 Network: ${NETWORK}`);

    // 1. 명령줄 인자에서 allowlist ID 확인
    let allowlistId: string | undefined;
    
    if (process.argv.length > 2) {
        allowlistId = process.argv[2];
    } else {
        // 사용자 입력 요청
        console.log('\n📦 Allowlist 확인');
        console.log('='.repeat(50));
        const input = await getUserInput('\n🔍 확인할 Allowlist ID를 입력하세요 (엔터만 누르면 모든 Cap 목록 표시): ');
        
        if (input) {
            allowlistId = input.trim();
        }
    }

    // 2. 모든 Cap 객체 가져오기
    const allCaps = await getAllCaps();
    
    if (allCaps.length === 0) {
        console.log(`\n⚠️  No Cap objects found for address: ${keypair.toSuiAddress()}`);
        console.log(`💡 You may need to create an allowlist first.`);
        return;
    }

    // 3. Cap 목록 출력
    console.log(`\n📋 Cap Objects Summary:`);
    console.log('='.repeat(50));
    allCaps.forEach((cap, index) => {
        console.log(`\n${index + 1}. Cap ID: ${cap.id}`);
        console.log(`   Allowlist ID: ${cap.allowlist_id}`);
    });

    // 4. 특정 allowlist ID가 제공된 경우 상세 정보 표시
    if (allowlistId) {
        console.log(`\n🔍 Checking allowlist: ${allowlistId}`);
        console.log('='.repeat(50));

        // Cap 찾기
        const capId = await findCapForAllowlist(allowlistId);
        
        if (!capId) {
            console.log(`\n⚠️  No Cap found for allowlist ID: ${allowlistId}`);
            console.log(`💡 Available allowlist IDs:`);
            allCaps.forEach((cap) => {
                console.log(`   - ${cap.allowlist_id}`);
            });
            return;
        }

        console.log(`\n✅ Found Cap for allowlist:`);
        console.log(`   Cap ID: ${capId}`);
        console.log(`   Allowlist ID: ${allowlistId}`);

        // Allowlist 정보 가져오기
        try {
            const allowlist = await getAllowlist(allowlistId);
            
            console.log(`\n📋 Allowlist Details:`);
            console.log('='.repeat(50));
            console.log(`   ID: ${allowlist.id}`);
            console.log(`   Name: ${allowlist.name}`);
            console.log(`   List Size: ${allowlist.list.length} address(es)`);
            
            if (allowlist.list.length > 0) {
                console.log(`\n   Allowed Addresses:`);
                allowlist.list.forEach((addr: string, index: number) => {
                    console.log(`   ${index + 1}. ${addr}`);
                });
            } else {
                console.log(`\n   ⚠️  No addresses in allowlist`);
            }

            console.log(`\n✅ Summary:`);
            console.log(`   - You have Cap for this allowlist: ✅`);
            console.log(`   - Cap ID: ${capId}`);
            console.log(`   - Allowlist Name: ${allowlist.name}`);
            console.log(`   - Allowlist Members: ${allowlist.list.length}`);
            
        } catch (error) {
            console.error(`\n❌ Failed to load allowlist details:`, error);
        }
    } else {
        console.log(`\n💡 Tip: Run with an allowlist ID to see detailed information:`);
        console.log(`   npm run check-allowlist <allowlist_id>`);
    }
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});

