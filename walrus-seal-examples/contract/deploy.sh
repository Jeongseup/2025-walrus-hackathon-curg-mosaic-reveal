#!/bin/bash

# Deploy the pdata package and extract package ID
echo "🚀 Deploying pdata package..."

# Deploy and capture JSON output
DEPLOY_OUTPUT=$(sui client publish --json)

# Check if deployment was successful
if [ $? -ne 0 ]; then
    echo "❌ Deployment failed!"
    exit 1
fi

# Extract package ID from JSON response
# Look for "published" type in objectChanges array
PACKAGE_ID=$(echo "$DEPLOY_OUTPUT" | grep -o '"packageId":\s*"[^"]*"' | head -1 | grep -o '0x[^"]*')

if [ -z "$PACKAGE_ID" ]; then
    echo "❌ Failed to extract package ID from deployment output"
    echo "Deployment output:"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

echo "✅ Deployment successful!"
echo "📦 Package ID: $PACKAGE_ID"

# Update .env.public file
ENV_PUBLIC_FILE="../.env.public"

# Create or update .env.public file
if [ -f "$ENV_PUBLIC_FILE" ]; then
    # Update existing PACKAGE_ID if it exists, otherwise append
    if grep -q "^PACKAGE_ID=" "$ENV_PUBLIC_FILE"; then
        # Update existing PACKAGE_ID
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s|^PACKAGE_ID=.*|PACKAGE_ID=$PACKAGE_ID|" "$ENV_PUBLIC_FILE"
        else
            # Linux
            sed -i "s|^PACKAGE_ID=.*|PACKAGE_ID=$PACKAGE_ID|" "$ENV_PUBLIC_FILE"
        fi
    else
        # Append PACKAGE_ID if it doesn't exist
        echo "PACKAGE_ID=$PACKAGE_ID" >> "$ENV_PUBLIC_FILE"
    fi
else
    # Create new .env.public file
    cat > "$ENV_PUBLIC_FILE" << EOF
# Public environment variables for seal-examples
# This file can be committed to git as it contains no sensitive information

# Package ID of deployed pdata contract
# Last updated: $(date)
PACKAGE_ID=$PACKAGE_ID
EOF
fi

echo "✅ Updated $ENV_PUBLIC_FILE with new PACKAGE_ID"
echo ""
echo "📝 Transaction details:"
echo "$DEPLOY_OUTPUT" | jq -r '.digest // "N/A"' | sed 's/^/   Digest: /'
echo ""
echo "🔍 View on SuiScan: https://suiscan.xyz/testnet/object/$PACKAGE_ID"
