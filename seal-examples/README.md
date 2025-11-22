# Seal Examples - Private Data Pattern

This directory contains examples of the Private Data pattern using Seal.

> **한국어 문서:** [README.ko.md](./README.ko.md)를 참조하세요.

## Structure

- `pdata/` - Move contract (PrivateData pattern)
- `scripts/` - TypeScript example scripts
  - `encrypt_sui_data.ts` - Encrypt and store data
  - `decrypt_sui_data.ts` - Decrypt stored data

## Prerequisites

### 1. Check Sui Client Active Address

First, verify your Sui client's active address:

```bash
sui client active-address
```

Example output:
```
0xb6c3a4d0b862a77227ec760550a93f5c35ef8d4329d70d03ac2f62670a598dc4
```

This address will be used for encrypting and decrypting data.

## Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Set up environment variables:**
   - Create a `.env` file with the following variable:
   ```bash
   # .env file
   PRIVATE_KEY=sui:ed25519:your_private_key_here
   ```
   
   > **Note:** `PRIVATE_KEY` should correspond to the address from `sui client active-address`.
   > You can export your private key using `sui keytool export <key-name>`.

## Usage

### 1. Deploy Contract (deploy.sh)

Deploy the Move contract to Sui network:

```bash
cd pdata
./deploy.sh
```

This script:
- Deploys the contract using `sui client publish`
- Automatically extracts the Package ID from deployment results
- Saves `PACKAGE_ID` to `../.env.public` file

### 2. Encrypt and Store Data

Encrypt data using Seal and store it on Sui chain:

```bash
npm run encrypt-sui-data
```

This script:
- Generates a random nonce
- Computes encryption ID using `compute_key_id` function
- Encrypts data using Seal SDK
- Stores encrypted data on Sui chain via `store_entry` function
- Outputs the created PrivateData object ID

**Important:** Save the output `PrivateData Object ID` for decryption!

### 3. Decrypt Stored Data

Decrypt encrypted data stored on Sui chain:

```bash
npm run decrypt-sui-data
```

**Usage:**

1. **Interactive input (recommended):**
   ```bash
   npm run decrypt-sui-data
   ```
   Enter the PrivateData object ID when prompted.

2. **Command-line argument:**
   ```bash
   npm run decrypt-sui-data 0x3c61b5bb1e5a621360751696680de2a799e20af319db10a2e829e9d640373580
   ```

3. **Environment variable:**
   ```bash
   OBJECT_ID=0x3c61b5bb1e5a621360751696680de2a799e20af319db10a2e829e9d640373580 npm run decrypt-sui-data
   ```

## Environment Variables

### Public Variables (`.env.public`)
- `PACKAGE_ID`: Deployed pdata package ID (auto-updated)

### Private Variables (`.env`)
- `PRIVATE_KEY`: Sui Ed25519 private key (required)
  - Format: `sui:ed25519:...`
  - Export using `sui keytool export <key-name>`

### Optional Variables
- `OBJECT_ID`: PrivateData object ID to decrypt (for decrypt script)

## Workflow

1. **Prepare:**
   ```bash
   # 1. Check active address
   sui client active-address
   
   # 2. Install dependencies
   npm install
   
   # 3. Set up .env file (PRIVATE_KEY)
   ```

2. **Deploy:**
   ```bash
   cd pdata
   ./deploy.sh
   ```

3. **Encrypt and Store:**
   ```bash
   npm run encrypt-sui-data
   # Copy the output PrivateData Object ID!
   ```

4. **Decrypt:**
   ```bash
   npm run decrypt-sui-data
   # Enter the PrivateData Object ID when prompted
   ```

## Notes

- Never commit `PRIVATE_KEY` to Git!
- `.env.public` file contains only public information and can be committed
- Seal server configuration is hardcoded for testnet
- `compute_key_id` function replicates Move's `compute_key_id` logic in TypeScript

## References

- [Seal Documentation](https://seal-docs.wal.app/)
- [Sui Documentation](https://docs.sui.io/)
- [SuiScan (Testnet)](https://suiscan.xyz/testnet/)

