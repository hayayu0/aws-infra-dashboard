#!/usr/bin/env bash
set -euo pipefail

TOOL_NAME_PREFIX="infra-dashboard"
ACCOUNT_ID="1"
ACCOUNT_DISPLAY_NAME=""
REGIONAL_REGION="ap-northeast-1"
OTHER_REGIONS=""
TIME_ZONE="Asia/Tokyo"
TAG_CATEGORY="Env"
TAG_CATEGORY_LABEL="環境"
TAG_CATEGORY_SELECTIONS="*"
TAG_CATEGORY2="Application"
WEB_ROOT="./src/web"
ALLOWED_IP_V4_CIDR=""
ALLOWED_IP_V6_CIDR=""
ENABLE_IP_ALLOW_LIST="false"
PROFILE=""
SKIP_INVALIDATION="0"

usage() {
    cat <<'USAGE'
Usage: tools/deploy-cdk.sh [options]

Options:
  --tool-name-prefix NAME       Default: infra-dashboard
  --account-id ID               Default: 1
  --account-display-name NAME   Default: アカ<account-id>
  --regional-region REGION      Default: ap-northeast-1
  --other-regions REGIONS       Comma-separated additional regions. Default: empty
  --time-zone TIME_ZONE         Default: Asia/Tokyo
  --tag-category TAG_KEY        Default: Env
  --tag-category-label LABEL    Default: 環境
  --tag-category-selections CSV Default: *
  --tag-category2 TAG_KEY       Default: Application
  --allowed-ipv4-cidr CIDRS     Default: empty
  --allowed-ipv6-cidr CIDRS     Default: empty
  --enable-ip-allow-list BOOL   Default: false
  --profile PROFILE             Default: AWS CLI default profile
  --skip-invalidation
  -h, --help
USAGE
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --tool-name-prefix) TOOL_NAME_PREFIX="$2"; shift 2 ;;
        --account-id) ACCOUNT_ID="$2"; shift 2 ;;
        --account-display-name) ACCOUNT_DISPLAY_NAME="$2"; shift 2 ;;
        --regional-region) REGIONAL_REGION="$2"; shift 2 ;;
        --other-regions) OTHER_REGIONS="$2"; shift 2 ;;
        --time-zone) TIME_ZONE="$2"; shift 2 ;;
        --tag-category) TAG_CATEGORY="$2"; shift 2 ;;
        --tag-category-label) TAG_CATEGORY_LABEL="$2"; shift 2 ;;
        --tag-category-selections) TAG_CATEGORY_SELECTIONS="$2"; shift 2 ;;
        --tag-category2) TAG_CATEGORY2="$2"; shift 2 ;;
        --allowed-ipv4-cidr) ALLOWED_IP_V4_CIDR="$2"; shift 2 ;;
        --allowed-ipv6-cidr) ALLOWED_IP_V6_CIDR="$2"; shift 2 ;;
        --enable-ip-allow-list) ENABLE_IP_ALLOW_LIST="$2"; shift 2 ;;
        --profile) PROFILE="$2"; shift 2 ;;
        --skip-invalidation) SKIP_INVALIDATION="1"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
    esac
done

if [ ! -d "$WEB_ROOT" ]; then
    echo "Web root not found: $WEB_ROOT" >&2
    exit 1
fi

if [ -n "$ACCOUNT_DISPLAY_NAME" ]; then
    RESOLVED_ACCOUNT_DISPLAY_NAME="$ACCOUNT_DISPLAY_NAME"
else
    RESOLVED_ACCOUNT_DISPLAY_NAME="アカ${ACCOUNT_ID}"
fi

LOCAL_STACK_NAME="${TOOL_NAME_PREFIX}-local"
GLOBAL_STACK_NAME="${TOOL_NAME_PREFIX}-global"

AWS_PROFILE_ARGS=()
CDK_PROFILE_ARGS=()
if [ -n "$PROFILE" ]; then
    AWS_PROFILE_ARGS=(--profile "$PROFILE")
    CDK_PROFILE_ARGS=(--profile "$PROFILE")
fi

DEPLOY_REGIONS=()
add_region() {
    local region="$1"
    local existing

    region="$(printf '%s' "$region" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    if [ -z "$region" ]; then
        return
    fi

    for existing in "${DEPLOY_REGIONS[@]}"; do
        if [ "$existing" = "$region" ]; then
            return
        fi
    done

    DEPLOY_REGIONS+=("$region")
}

add_region "$REGIONAL_REGION"
if [ -n "$OTHER_REGIONS" ]; then
    IFS=',' read -r -a additional_regions <<< "$OTHER_REGIONS"
    for region in "${additional_regions[@]}"; do
        add_region "$region"
    done
fi

get_stack_output() {
    local stack="$1"
    local region="$2"
    local output_key="$3"

    aws "${AWS_PROFILE_ARGS[@]}" cloudformation describe-stacks \
        --stack-name "$stack" \
        --region "$region" \
        --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue | [0]" \
        --output text
}

get_timezone_offset_hours() {
    local time_zone_name="$1"
    local offset sign hours minutes

    if ! offset="$(TZ="$time_zone_name" date +%z 2>/dev/null)"; then
        echo "Invalid time zone: $time_zone_name" >&2
        exit 1
    fi

    sign="${offset:0:1}"
    hours="${offset:1:2}"
    minutes="${offset:3:2}"

    awk -v sign="$sign" -v hours="$hours" -v minutes="$minutes" 'BEGIN {
        value = hours + (minutes / 60)
        if (sign == "-") {
            value = -value
        }
        printf "%g", value
    }'
}

json_array() {
    node -e 'console.log(JSON.stringify(process.argv.slice(1)))' "$@"
}

update_web_config() {
    local config_path="$1"
    local tool_root_url="$2"
    local timezone_offset="$3"
    local tag_category2_url_key
    local regions_json

    if [ ! -f "$config_path" ]; then
        echo "Web config not found: $config_path" >&2
        exit 1
    fi

    tag_category2_url_key="$(printf '%s' "$TAG_CATEGORY2" | tr '[:upper:]' '[:lower:]')"
    regions_json="$(json_array "${DEPLOY_REGIONS[@]}")"

    CONFIG_PATH="$config_path" \
    TOOL_ROOT_URL="$tool_root_url" \
    ACCOUNT_ID="$ACCOUNT_ID" \
    ACCOUNT_DISPLAY_NAME="$RESOLVED_ACCOUNT_DISPLAY_NAME" \
    TIMEZONE_OFFSET="$timezone_offset" \
    TAG_CATEGORY2="$TAG_CATEGORY2" \
    TAG_CATEGORY2_URL_KEY="$tag_category2_url_key" \
    TAG_CATEGORY="$TAG_CATEGORY" \
    TAG_CATEGORY_LABEL="$TAG_CATEGORY_LABEL" \
    TAG_CATEGORY_SELECTIONS="$TAG_CATEGORY_SELECTIONS" \
    REGIONS_JSON="$regions_json" \
    node <<'NODE'
const fs = require('fs');

const configPath = process.env.CONFIG_PATH;
let text = fs.readFileSync(configPath, 'utf8');
const newline = text.includes('\r\n') ? '\r\n' : '\n';

function replaceOrThrow(pattern, replacement, label) {
  if (!pattern.test(text)) {
    throw new Error(`config.js pattern not found: ${label}`);
  }
  text = text.replace(pattern, replacement);
}

function categoryOptionsSource(selections) {
  const values = selections.split(',').map((value) => value.trim()).filter(Boolean);
  const normalized = values.length ? values : ['*'];
  return `[${newline}            ${normalized.map((value) => {
    const display = value === '*' ? '全て(タグ無し含む)' : value;
    return `{ tagValues: [${JSON.stringify(value)}], display: ${JSON.stringify(display)} }`;
  }).join(`,${newline}            `)}${newline}        ]`;
}

replaceOrThrow(/urlToolRoot:\s*[^,\r\n]+/, `urlToolRoot: ${JSON.stringify(process.env.TOOL_ROOT_URL)}`, 'urlToolRoot');
replaceOrThrow(
  /(?<key>"[^"]+")(?<suffix>\s*:\s*\{\s*\r?\n\s*"selectAccountDisp"\s*:\s*)['"][^'"]*['"]/,
  (...args) => {
    const groups = args.at(-1);
    return `${JSON.stringify(process.env.ACCOUNT_ID)}${groups.suffix}${JSON.stringify(process.env.ACCOUNT_DISPLAY_NAME)}`;
  },
  'accounts account key and selectAccountDisp',
);
replaceOrThrow(/timezoneOffset:\s*-?\d+(?:\.\d+)?/, `timezoneOffset: ${process.env.TIMEZONE_OFFSET}`, 'timezoneOffset');
replaceOrThrow(
  /(groupTagFilter:\s*\{\s*\r?\n\s*key:\s*)['"][^'"]+['"]/,
  (_, prefix) => `${prefix}${JSON.stringify(process.env.TAG_CATEGORY2)}`,
  'groupTagFilter.key',
);
replaceOrThrow(
  /(groupTagFilter:\s*\{[\s\S]*?\r?\n\s*value:\s*['"][^'"]*['"],\s*\r?\n\s*keyURL:\s*)['"][^'"]+['"]/,
  (_, prefix) => `${prefix}${JSON.stringify(process.env.TAG_CATEGORY2_URL_KEY)}`,
  'groupTagFilter.keyURL',
);
replaceOrThrow(
  /(categoryTag:\s*\{[\s\S]*?\r?\n\s*label:\s*)['"][^'"]+['"]/,
  (_, prefix) => `${prefix}${JSON.stringify(process.env.TAG_CATEGORY_LABEL)}`,
  'categoryTag.label',
);
replaceOrThrow(
  /(categoryTag:\s*\{[\s\S]*?\r?\n\s*key:\s*)['"][^'"]+['"]/,
  (_, prefix) => `${prefix}${JSON.stringify(process.env.TAG_CATEGORY)}`,
  'categoryTag.key',
);
replaceOrThrow(
  /(categoryTag:\s*\{[\s\S]*?\r?\n\s*options:\s*)\[[\s\S]*?\r?\n\s*\}/,
  (_, prefix) => `${prefix}${categoryOptionsSource(process.env.TAG_CATEGORY_SELECTIONS)}${newline}    }`,
  'categoryTag.options',
);
replaceOrThrow(
  /"regions":\s*\[[^\]]*\]/,
  `"regions": ${JSON.stringify(JSON.parse(process.env.REGIONS_JSON))}`,
  'accounts.1.regions',
);

fs.writeFileSync(configPath, text, 'utf8');
NODE
}

npx cdk deploy "$LOCAL_STACK_NAME" \
    "${CDK_PROFILE_ARGS[@]}" \
    --require-approval never \
    --parameters "${LOCAL_STACK_NAME}:CloudFrontDistributionArn=" \
    --context "toolNamePrefix=$TOOL_NAME_PREFIX" \
    --context "accountId=$ACCOUNT_ID" \
    --context "accountDisplayName=$RESOLVED_ACCOUNT_DISPLAY_NAME" \
    --context "region=$REGIONAL_REGION" \
    --context "otherRegions=$OTHER_REGIONS" \
    --context "timeZone=$TIME_ZONE"

bucket="$(get_stack_output "$LOCAL_STACK_NAME" "$REGIONAL_REGION" ToolBucketName)"
lambda_function_url="$(aws "${AWS_PROFILE_ARGS[@]}" lambda get-function-url-config \
    --function-name "${TOOL_NAME_PREFIX}-describe-api" \
    --region "$REGIONAL_REGION" \
    --query "FunctionUrl" \
    --output text)"

if [ -z "$bucket" ] || [ "$bucket" = "None" ]; then
    echo "ToolBucketName output was not found." >&2
    exit 1
fi

if [ -z "$lambda_function_url" ] || [ "$lambda_function_url" = "None" ]; then
    echo "Lambda function URL was not found." >&2
    exit 1
fi

npx cdk deploy "$GLOBAL_STACK_NAME" \
    "${CDK_PROFILE_ARGS[@]}" \
    --require-approval never \
    --parameters "${GLOBAL_STACK_NAME}:ToolBucketName=$bucket" \
    --parameters "${GLOBAL_STACK_NAME}:ToolBucketRegion=$REGIONAL_REGION" \
    --parameters "${GLOBAL_STACK_NAME}:LambdaFunctionUrl=$lambda_function_url" \
    --parameters "${GLOBAL_STACK_NAME}:EnableIpAllowList=$ENABLE_IP_ALLOW_LIST" \
    --parameters "${GLOBAL_STACK_NAME}:AllowedIpV4Cidr=$ALLOWED_IP_V4_CIDR" \
    --parameters "${GLOBAL_STACK_NAME}:AllowedIpV6Cidr=$ALLOWED_IP_V6_CIDR" \
    --context "toolNamePrefix=$TOOL_NAME_PREFIX" \
    --context "accountId=$ACCOUNT_ID" \
    --context "accountDisplayName=$RESOLVED_ACCOUNT_DISPLAY_NAME" \
    --context "region=$REGIONAL_REGION" \
    --context "otherRegions=$OTHER_REGIONS" \
    --context "timeZone=$TIME_ZONE"

distribution_id="$(get_stack_output "$GLOBAL_STACK_NAME" "us-east-1" CloudFrontDistributionId)"
distribution_arn="$(get_stack_output "$GLOBAL_STACK_NAME" "us-east-1" CloudFrontDistributionArn)"
tool_url="$(get_stack_output "$GLOBAL_STACK_NAME" "us-east-1" ToolUrl)"
tool_root_url="${tool_url%/web/infra-dashboard/index.html}/"

if [ -z "$distribution_arn" ] || [ "$distribution_arn" = "None" ]; then
    echo "CloudFrontDistributionArn output was not found." >&2
    exit 1
fi

if [ -z "$tool_url" ] || [ "$tool_url" = "None" ]; then
    echo "ToolUrl output was not found." >&2
    exit 1
fi

npx cdk deploy "$LOCAL_STACK_NAME" \
    "${CDK_PROFILE_ARGS[@]}" \
    --require-approval never \
    --parameters "${LOCAL_STACK_NAME}:CloudFrontDistributionArn=$distribution_arn" \
    --context "toolNamePrefix=$TOOL_NAME_PREFIX" \
    --context "accountId=$ACCOUNT_ID" \
    --context "accountDisplayName=$RESOLVED_ACCOUNT_DISPLAY_NAME" \
    --context "region=$REGIONAL_REGION" \
    --context "otherRegions=$OTHER_REGIONS" \
    --context "timeZone=$TIME_ZONE"

staged_web_root="$(mktemp -d)"
trap 'rm -rf "$staged_web_root"' EXIT
cp -R "$WEB_ROOT"/. "$staged_web_root"/

timezone_offset="$(get_timezone_offset_hours "$TIME_ZONE")"
update_web_config "$staged_web_root/common_script/config.js" "$tool_root_url" "$timezone_offset"

aws "${AWS_PROFILE_ARGS[@]}" s3 sync "$staged_web_root" "s3://$bucket/web/" --delete

if [ "$SKIP_INVALIDATION" != "1" ]; then
    if [ -z "$distribution_id" ] || [ "$distribution_id" = "None" ]; then
        echo "CloudFrontDistributionId output was not found." >&2
        exit 1
    fi

    aws "${AWS_PROFILE_ARGS[@]}" cloudfront create-invalidation \
        --distribution-id "$distribution_id" \
        --paths "/*" >/dev/null
fi

echo "Deploy complete."
echo "GlobalStack: $GLOBAL_STACK_NAME (us-east-1)"
echo "LocalStack: $LOCAL_STACK_NAME ($REGIONAL_REGION)"
echo "Regions: ${DEPLOY_REGIONS[*]}"
echo "ToolUrl: $tool_url"
