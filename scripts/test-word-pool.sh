#!/bin/bash

# Test Word Pool + Enrichment Pipeline Locally
# Usage: ./scripts/test-word-pool.sh

set -e

API_BASE="http://localhost:8787/api"
BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Word Pool + Enrichment Pipeline Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if API is running
check_api() {
    echo -e "${YELLOW}Checking if API is running...${NC}"
    if curl -s "$API_BASE/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ API is running${NC}"
        return 0
    else
        echo -e "${RED}✗ API is not running. Start it with: npm run dev${NC}"
        return 1
    fi
}

# Step 1: Apply migrations
apply_migrations() {
    echo ""
    echo -e "${YELLOW}Step 1: Applying migrations...${NC}"
    cd apps/api
    npx wrangler d1 migrations apply word_of_the_day --local
    cd ../..
    echo -e "${GREEN}✓ Migrations applied${NC}"
}

# Step 2: Verify schema
verify_schema() {
    echo ""
    echo -e "${YELLOW}Step 2: Verifying database schema...${NC}"
    cd apps/api

    echo "  Checking word_pool table..."
    npx wrangler d1 execute word_of_the_day --local --command "SELECT COUNT(*) as count FROM word_pool;" 2>/dev/null | grep -q "count" && echo -e "  ${GREEN}✓ word_pool exists${NC}" || echo -e "  ${RED}✗ word_pool missing${NC}"

    echo "  Checking daily_words table..."
    npx wrangler d1 execute word_of_the_day --local --command "SELECT COUNT(*) as count FROM daily_words;" 2>/dev/null | grep -q "count" && echo -e "  ${GREEN}✓ daily_words exists${NC}" || echo -e "  ${RED}✗ daily_words missing${NC}"

    echo "  Checking word_details table..."
    npx wrangler d1 execute word_of_the_day --local --command "SELECT COUNT(*) as count FROM word_details;" 2>/dev/null | grep -q "count" && echo -e "  ${GREEN}✓ word_details exists${NC}" || echo -e "  ${RED}✗ word_details missing${NC}"

    echo "  Checking word_usage_log table..."
    npx wrangler d1 execute word_of_the_day --local --command "SELECT COUNT(*) as count FROM word_usage_log;" 2>/dev/null | grep -q "count" && echo -e "  ${GREEN}✓ word_usage_log exists${NC}" || echo -e "  ${RED}✗ word_usage_log missing${NC}"

    echo "  Checking word_cycle_state table..."
    npx wrangler d1 execute word_of_the_day --local --command "SELECT current_cycle FROM word_cycle_state WHERE id = 1;" 2>/dev/null | grep -q "current_cycle" && echo -e "  ${GREEN}✓ word_cycle_state exists${NC}" || echo -e "  ${RED}✗ word_cycle_state missing${NC}"

    cd ../..
}

# Step 3: Check migrated words
check_migrated_words() {
    echo ""
    echo -e "${YELLOW}Step 3: Checking migrated words...${NC}"
    cd apps/api

    WORD_COUNT=$(npx wrangler d1 execute word_of_the_day --local --command "SELECT COUNT(*) as count FROM word_pool;" 2>/dev/null | grep -oP '\d+' | head -1)
    echo -e "  Word pool count: ${GREEN}$WORD_COUNT${NC}"

    READY_COUNT=$(npx wrangler d1 execute word_of_the_day --local --command "SELECT COUNT(*) as count FROM word_details WHERE status = 'ready';" 2>/dev/null | grep -oP '\d+' | head -1)
    echo -e "  Words with ready status: ${GREEN}$READY_COUNT${NC}"

    echo ""
    echo "  Sample words in pool:"
    npx wrangler d1 execute word_of_the_day --local --command "SELECT id, word, enabled, source FROM word_pool LIMIT 5;" 2>/dev/null

    cd ../..
}

# Step 4: Import test words
import_test_words() {
    echo ""
    echo -e "${YELLOW}Step 4: Importing test words via API...${NC}"

    # Create a test word list
    TEST_WORDS='{"words": ["algorithm", "binary", "compiler", "database", "encryption", "framework", "gradient", "heuristic", "iteration", "javascript"], "source": "test"}'

    # This requires admin auth - skip if not authenticated
    echo -e "  ${YELLOW}Note: Import requires admin authentication${NC}"
    echo -e "  You can import via curl with admin session cookie:"
    echo -e "  ${BLUE}curl -X POST $API_BASE/admin/word-pool/import -H 'Content-Type: application/json' -d '$TEST_WORDS' --cookie 'session=YOUR_SESSION'${NC}"
}

# Step 5: Test /api/word/today endpoint
test_today_endpoint() {
    echo ""
    echo -e "${YELLOW}Step 5: Testing /api/word/today endpoint...${NC}"

    # Create anonymous identity first
    ANON_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
    TZ="America/New_York"

    echo "  Creating anonymous identity..."
    curl -s -X POST "$API_BASE/identity/anonymous" \
        -H "Content-Type: application/json" \
        -d "{\"id\": \"$ANON_ID\", \"timezone\": \"$TZ\"}" > /dev/null

    echo "  Fetching today's word..."
    RESPONSE=$(curl -s "$API_BASE/word/today" \
        -H "X-Anon-Id: $ANON_ID" \
        -H "X-Timezone: $TZ")

    echo ""
    echo -e "  ${BLUE}Response:${NC}"
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

    # Parse response
    if echo "$RESPONSE" | grep -q '"word"'; then
        WORD=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('word', 'N/A'))" 2>/dev/null)
        STATUS=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('detailsStatus', 'N/A'))" 2>/dev/null)
        echo ""
        echo -e "  ${GREEN}✓ Word: $WORD${NC}"
        echo -e "  ${GREEN}✓ Details Status: $STATUS${NC}"
    else
        echo -e "  ${RED}✗ Failed to get today's word${NC}"
    fi
}

# Step 6: Test deterministic selection (same word for multiple requests)
test_deterministic() {
    echo ""
    echo -e "${YELLOW}Step 6: Testing deterministic word selection...${NC}"

    TZ="America/New_York"

    # Create two different anonymous users
    ANON_ID1=$(uuidgen | tr '[:upper:]' '[:lower:]')
    ANON_ID2=$(uuidgen | tr '[:upper:]' '[:lower:]')

    curl -s -X POST "$API_BASE/identity/anonymous" \
        -H "Content-Type: application/json" \
        -d "{\"id\": \"$ANON_ID1\", \"timezone\": \"$TZ\"}" > /dev/null

    curl -s -X POST "$API_BASE/identity/anonymous" \
        -H "Content-Type: application/json" \
        -d "{\"id\": \"$ANON_ID2\", \"timezone\": \"$TZ\"}" > /dev/null

    WORD1=$(curl -s "$API_BASE/word/today" -H "X-Anon-Id: $ANON_ID1" -H "X-Timezone: $TZ" | python3 -c "import sys, json; print(json.load(sys.stdin).get('word', ''))" 2>/dev/null)
    WORD2=$(curl -s "$API_BASE/word/today" -H "X-Anon-Id: $ANON_ID2" -H "X-Timezone: $TZ" | python3 -c "import sys, json; print(json.load(sys.stdin).get('word', ''))" 2>/dev/null)

    echo "  User 1 word: $WORD1"
    echo "  User 2 word: $WORD2"

    if [ "$WORD1" = "$WORD2" ] && [ -n "$WORD1" ]; then
        echo -e "  ${GREEN}✓ Same word for both users - deterministic selection works!${NC}"
    else
        echo -e "  ${RED}✗ Different words - deterministic selection may be broken${NC}"
    fi
}

# Step 7: Check enrichment stats (if admin)
check_enrichment_stats() {
    echo ""
    echo -e "${YELLOW}Step 7: Enrichment stats (requires admin)...${NC}"
    echo -e "  ${YELLOW}Note: This requires admin authentication${NC}"
    echo -e "  You can check via curl with admin session cookie:"
    echo -e "  ${BLUE}curl $API_BASE/admin/enrichment/stats --cookie 'session=YOUR_SESSION'${NC}"
}

# Step 8: Manual enrichment trigger test
test_enrichment_trigger() {
    echo ""
    echo -e "${YELLOW}Step 8: Testing enrichment (background)...${NC}"
    echo "  When you request a word with 'pending' status, enrichment is triggered"
    echo "  via waitUntil(). The cron job also processes pending words every 30 min."
    echo ""
    echo "  To manually trigger cron enrichment, you can:"
    echo -e "  ${BLUE}curl -X POST 'http://localhost:8787/__scheduled?cron=*/30+*+*+*+*'${NC}"
}

# Database inspection commands
show_db_commands() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Useful Database Inspection Commands${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo "# View word pool:"
    echo "cd apps/api && npx wrangler d1 execute word_of_the_day --local --command \"SELECT * FROM word_pool LIMIT 10;\""
    echo ""
    echo "# View daily words:"
    echo "cd apps/api && npx wrangler d1 execute word_of_the_day --local --command \"SELECT * FROM daily_words ORDER BY day DESC LIMIT 5;\""
    echo ""
    echo "# View enrichment status:"
    echo "cd apps/api && npx wrangler d1 execute word_of_the_day --local --command \"SELECT wp.word, wd.status, wd.retry_count FROM word_pool wp JOIN word_details wd ON wp.id = wd.word_pool_id LIMIT 10;\""
    echo ""
    echo "# View current cycle:"
    echo "cd apps/api && npx wrangler d1 execute word_of_the_day --local --command \"SELECT * FROM word_cycle_state;\""
    echo ""
    echo "# View word usage log:"
    echo "cd apps/api && npx wrangler d1 execute word_of_the_day --local --command \"SELECT * FROM word_usage_log ORDER BY id DESC LIMIT 10;\""
}

# Main execution
main() {
    # Check if we're in the right directory
    if [ ! -f "package.json" ] || [ ! -d "apps/api" ]; then
        echo -e "${RED}Error: Run this script from the project root directory${NC}"
        exit 1
    fi

    apply_migrations
    verify_schema
    check_migrated_words

    if check_api; then
        import_test_words
        test_today_endpoint
        test_deterministic
        check_enrichment_stats
        test_enrichment_trigger
    fi

    show_db_commands

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Test Complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
}

# Run with specific step if provided
case "${1:-}" in
    migrate)
        apply_migrations
        ;;
    schema)
        verify_schema
        ;;
    words)
        check_migrated_words
        ;;
    today)
        check_api && test_today_endpoint
        ;;
    deterministic)
        check_api && test_deterministic
        ;;
    commands)
        show_db_commands
        ;;
    *)
        main
        ;;
esac
