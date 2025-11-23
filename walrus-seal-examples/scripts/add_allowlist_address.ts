import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { isValidSuiAddress } from '@mysten/sui/utils';
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
 * Allowlist에 주소 추가 함수
 * addItem 함수를 참고
 */
async function addAddressToAllowlist(
    allowlistId: string,
    capId: string,
    addressToAdd: string
): Promise<void> {
    const trimmedAddress = addressToAdd.trim();
    
    if (trimmedAddress === '') {
        throw new Error('Address cannot be empty');
    }

    if (!isValidSuiAddress(trimmedAddress)) {
        throw new Error(`Invalid Sui address: ${trimmedAddress}`);
    }

    console.log(`\n➕ Adding address to allowlist...`);
    console.log(`   Allowlist ID: ${allowlistId}`);
    console.log(`   Cap ID: ${capId}`);
    console.log(`   Address: ${trimmedAddress}`);

    // Transaction 생성
    const tx = new Transaction();
    
    tx.moveCall({
        arguments: [
            tx.object(allowlistId),
            tx.object(capId),
            tx.pure.address(trimmedAddress)
        ],
        target: `${PACKAGE_ID}::allowlist::add`,
    });
    
    tx.setGasBudget(10000000);

    // 트랜잭션 빌드 및 서명
    console.log(`🔨 Building transaction...`);
    const result = await suiClient.signAndExecuteTransaction({
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
 * Allowlist 객체를 가져옴
 */
async function getAllowlist(allowlistId: string) {
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
 * Allowlist 정보 확인 (추가 후 업데이트된 리스트 확인)
 */
async function getAllowlistInfo(allowlistId: string) {
    try {
        const allowlist = await getAllowlist(allowlistId);
        return allowlist;
    } catch (error) {
        console.error(`⚠️  Failed to load allowlist info: ${error}`);
        return null;
    }
}

/**
 * 메인 함수
 */
async function main() {
    console.log(`\n➕ Add Address to Allowlist`);
    console.log(`📝 User Address: ${keypair.toSuiAddress()}`);
    console.log(`📦 Package ID: ${PACKAGE_ID}`);
    console.log(`🌐 Network: ${NETWORK}`);

    // 1. 명령줄 인자 확인 (주소만 받음)
    let addressToAdd: string | undefined;
    
    if (process.argv.length > 2) {
        // 명령줄 인자로 주소 제공
        addressToAdd = process.argv[2];
    } else {
        // 대화형 입력
        console.log('\n📦 Allowlist에 주소 추가');
        console.log('='.repeat(50));
        
        const input = await getUserInput('\n📍 추가할 주소를 입력하세요: ');
        if (!input) {
            console.error('❌ 주소가 입력되지 않았습니다.');
            process.exit(1);
        }
        addressToAdd = input.trim();
    }

    if (!addressToAdd) {
        console.error('❌ 주소가 입력되지 않았습니다.');
        console.log('\n💡 Usage:');
        console.log('   npm run add-allowlist-address <address>');
        console.log('   또는 대화형 모드로 실행');
        process.exit(1);
    }

    // 주소 유효성 검사
    const trimmedAddress = addressToAdd.trim();
    if (!isValidSuiAddress(trimmedAddress)) {
        console.error(`❌ Invalid Sui address: ${trimmedAddress}`);
        process.exit(1);
    }

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

    try {
        // 4. 추가 전 allowlist 정보 확인
        console.log(`\n📋 Checking current allowlist state...`);
        const beforeInfo = await getAllowlistInfo(allowlistId);
        if (beforeInfo) {
            console.log(`   Current name: ${beforeInfo.name}`);
            console.log(`   Current list size: ${beforeInfo.list.length} address(es)`);
            if (beforeInfo.list.includes(trimmedAddress)) {
                console.warn(`\n⚠️  Address ${trimmedAddress} is already in the allowlist!`);
                const confirm = await getUserInput('Continue anyway? (y/n): ');
                if (confirm.toLowerCase() !== 'y') {
                    console.log('Cancelled.');
                    process.exit(0);
                }
            }
        }

        // 5. 주소 추가
        await addAddressToAllowlist(allowlistId, capId, trimmedAddress);

        // 6. 추가 후 allowlist 정보 확인
        console.log(`\n⏳ Waiting for indexer to update...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const afterInfo = await getAllowlistInfo(allowlistId);
        if (afterInfo) {
            console.log(`\n📋 Updated Allowlist Info:`);
            console.log('='.repeat(50));
            console.log(`   Name: ${afterInfo.name}`);
            console.log(`   List Size: ${afterInfo.list.length} address(es)`);
            
            if (afterInfo.list.length > 0) {
                console.log(`\n   Allowed Addresses:`);
                afterInfo.list.forEach((addr: string, index: number) => {
                    const marker = addr === trimmedAddress ? ' ✨ (just added)' : '';
                    console.log(`   ${index + 1}. ${addr}${marker}`);
                });
            }
        }

        // 7. 결과 저장
        const outputDir = path.join(__dirname, '../tmp/walrus');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const resultsPath = path.join(outputDir, 'add_address_results.json');
        const addInfo = {
            timestamp: new Date().toISOString(),
            allowlistId,
            capId,
            addressAdded: trimmedAddress,
            owner: keypair.toSuiAddress(),
            packageId: PACKAGE_ID,
            network: NETWORK,
        };
        
        // 기존 결과가 있으면 배열로 추가
        let allResults: any[] = [];
        if (fs.existsSync(resultsPath)) {
            try {
                const existing = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
                allResults = Array.isArray(existing) ? existing : [existing];
            } catch (e) {
                allResults = [];
            }
        }
        
        allResults.push(addInfo);
        fs.writeFileSync(resultsPath, JSON.stringify(allResults, null, 2));
        
        console.log(`\n💾 Add address info saved to: ${resultsPath}`);
        console.log(`\n✅ Successfully added address to allowlist!`);

    } catch (error: any) {
        console.error(`\n❌ Failed to add address:`, error.message || error);
        if (error.message?.includes('EDuplicate')) {
            console.log(`\n💡 This address is already in the allowlist.`);
        } else if (error.message?.includes('EInvalidCap')) {
            console.log(`\n💡 Invalid Cap ID. Make sure the Cap belongs to this allowlist.`);
        }
        throw error;
    }
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});

