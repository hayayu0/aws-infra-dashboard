param(
    [string]$ToolNamePrefix = "infra-dashboard",
    [ValidatePattern('^[A-Za-z0-9,_#-]*$')]
    [string]$SubDir = "",
    [ValidatePattern('^[A-Za-z0-9,]*$')]
    [string]$AdditionalService = "RDS",
    [string]$AccountDisplayName = "",
    [string]$RegionalRegion = "ap-northeast-1",
    [string]$OtherRegions = "",
    [string]$TimeZone = "Asia/Tokyo",
    [string]$TagCategory = "Env",
    [string]$TagCategoryLabel = "環境",
    [string]$TagCategorySelections = "*",
    [string]$TagCategory2 = "Application",
    [string]$AllowedIpV4Cidr = "",
    [string]$AllowedIpV6Cidr = "",
    [ValidateSet("true", "false")]
    [string]$EnableIpAllowList = "false",
    [string]$Profile = "",
    [switch]$SkipInvalidation
)

$ErrorActionPreference = "Stop"

$resolvedAccountDisplayName = if ($AccountDisplayName -ne "") { $AccountDisplayName } else { "アカ1" }

$awsProfileArgs = @()
if ($Profile -ne "") {
    $awsProfileArgs = @("--profile", $Profile)
}

$cdkProfileArgs = @()
if ($Profile -ne "") {
    $cdkProfileArgs = @("--profile", $Profile)
}

$localStackName = "$ToolNamePrefix-local"
$globalStackName = "$ToolNamePrefix-global"

function Invoke-Cdk {
    param(
        [string[]]$Arguments
    )

    & npx @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "npx $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

function Get-StackOutput {
    param(
        [string]$Stack,
        [string]$Region,
        [string]$OutputKey
    )

    $value = aws @awsProfileArgs cloudformation describe-stacks `
        --stack-name $Stack `
        --region $Region `
        --query "Stacks[0].Outputs[?OutputKey=='$OutputKey'].OutputValue | [0]" `
        --output text
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to read output $OutputKey from stack $Stack in $Region."
    }
    return $value
}

function ConvertTo-JsStringLiteral {
    param(
        [string]$Value
    )

    return ($Value | ConvertTo-Json -Compress)
}

function Get-TimeZoneOffsetHours {
    param(
        [string]$TimeZoneName
    )

    $windowsTimeZoneByIana = @{
        "Etc/UTC" = "UTC"
        "UTC" = "UTC"
        "Asia/Tokyo" = "Tokyo Standard Time"
        "America/New_York" = "Eastern Standard Time"
        "America/Chicago" = "Central Standard Time"
        "America/Denver" = "Mountain Standard Time"
        "America/Los_Angeles" = "Pacific Standard Time"
        "Europe/London" = "GMT Standard Time"
        "Europe/Paris" = "Romance Standard Time"
        "Europe/Berlin" = "W. Europe Standard Time"
        "Asia/Seoul" = "Korea Standard Time"
        "Asia/Shanghai" = "China Standard Time"
        "Asia/Singapore" = "Singapore Standard Time"
        "Australia/Sydney" = "AUS Eastern Standard Time"
    }

    $lookupName = if ($windowsTimeZoneByIana.ContainsKey($TimeZoneName)) { $windowsTimeZoneByIana[$TimeZoneName] } else { $TimeZoneName }

    try {
        $timeZoneInfo = [System.TimeZoneInfo]::FindSystemTimeZoneById($lookupName)
    } catch {
        throw "Invalid time zone: $TimeZoneName"
    }

    return [System.Math]::Round($timeZoneInfo.GetUtcOffset([datetime]::UtcNow).TotalHours, 2)
}

function Update-WebConfig {
    param(
        [string]$ConfigPath,
        [string]$ToolRootUrl,
        [string]$SubDir,
        [string]$AdditionalService,
        [string]$AccountDisplayName,
        [string[]]$Regions,
        [string]$TimeZoneName,
        [string]$TagCategoryKey,
        [string]$TagCategoryLabel,
        [string]$TagCategorySelections,
        [string]$TagCategory2Key
    )

    if (!(Test-Path -LiteralPath $ConfigPath)) {
        throw "Web config not found: $ConfigPath"
    }

    $configText = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.UTF8Encoding]::new($true))
    $newLine = if ($configText.Contains("`r`n")) { "`r`n" } else { "`n" }
    $tagCategory2UrlKey = $TagCategory2Key.ToLowerInvariant()
    $regionList = "[$(($Regions | ForEach-Object { ConvertTo-JsStringLiteral $_ }) -join ', ')]"
    $categoryOptions = @()
    foreach ($selection in $TagCategorySelections.Split(",")) {
        $tagValue = $selection.Trim()
        if ($tagValue -eq "") {
            continue
        }

        $display = if ($tagValue -eq "*") { "全て(タグ無し含む)" } else { $tagValue }
        $categoryOptions += "{ tagValues: [$(ConvertTo-JsStringLiteral $tagValue)], display: $(ConvertTo-JsStringLiteral $display) }"
    }
    if ($categoryOptions.Count -eq 0) {
        $categoryOptions += "{ tagValues: ['*'], display: '全て(タグ無し含む)' }"
    }
    $categoryOptionsText = "[$newLine            $($categoryOptions -join ",$newLine            ")$newLine        ]"
    $timezoneOffset = Get-TimeZoneOffsetHours $TimeZoneName
    $additionalServiceJsLiterals = @($AdditionalService.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' } | ForEach-Object { ConvertTo-JsStringLiteral $_ })
    $additionalServiceList = '[' + ($additionalServiceJsLiterals -join ', ') + ']'
    $accountNameRegex = [regex]::new('("accountName"\s*:\s*)[''"][^''"]*[''"]')
    $additionalServiceRegex = [regex]::new('("additionalService"\s*:\s*)\[[^\]]*\]')
    $subDirRegex = [regex]::new('("subDir"\s*:\s*)[''"][^''"]*[''"]')

    if (!$accountNameRegex.IsMatch($configText)) {
        throw "Web config must define an account with accountName."
    }
    if (!$additionalServiceRegex.IsMatch($configText)) {
        throw "Web config must define an account with additionalService."
    }
    if (!$subDirRegex.IsMatch($configText)) {
        throw "Web config must define an account with subDir."
    }

    $configText = [regex]::Replace(
        $configText,
        'urlToolRoot:\s*[^,\r\n]+',
        "urlToolRoot: $(ConvertTo-JsStringLiteral $ToolRootUrl)"
    )
    $configText = $accountNameRegex.Replace(
        $configText,
        { param($match) $match.Groups[1].Value + (ConvertTo-JsStringLiteral $AccountDisplayName) },
        1
    )
    $configText = $additionalServiceRegex.Replace(
        $configText,
        { param($match) $match.Groups[1].Value + $additionalServiceList },
        1
    )
    $configText = $subDirRegex.Replace(
        $configText,
        { param($match) $match.Groups[1].Value + (ConvertTo-JsStringLiteral $SubDir) },
        1
    )
    $configText = [regex]::Replace(
        $configText,
        'timezoneOffset:\s*-?\d+(?:\.\d+)?',
        "timezoneOffset: $timezoneOffset"
    )
    $configText = [regex]::Replace(
        $configText,
        "(groupTagFilter:\s*\{\s*\r?\n\s*key:\s*)['""][^'""]+['""]",
        { param($match) $match.Groups[1].Value + (ConvertTo-JsStringLiteral $TagCategory2Key) }
    )
    $configText = [regex]::Replace(
        $configText,
        "(groupTagFilter:\s*\{(?:.|\r|\n)*?\r?\n\s*value:\s*['""][^'""]*['""],\s*\r?\n\s*keyURL:\s*)['""][^'""]+['""]",
        { param($match) $match.Groups[1].Value + (ConvertTo-JsStringLiteral $tagCategory2UrlKey) }
    )
    $configText = [regex]::Replace(
        $configText,
        "(categoryTag:\s*\{(?:.|\r|\n)*?\r?\n\s*label:\s*)['""][^'""]+['""]",
        { param($match) $match.Groups[1].Value + (ConvertTo-JsStringLiteral $TagCategoryLabel) }
    )
    $configText = [regex]::Replace(
        $configText,
        "(categoryTag:\s*\{(?:.|\r|\n)*?\r?\n\s*key:\s*)['""][^'""]+['""]",
        { param($match) $match.Groups[1].Value + (ConvertTo-JsStringLiteral $TagCategoryKey) }
    )
    $configText = [regex]::Replace(
        $configText,
        "(categoryTag:\s*\{(?:.|\r|\n)*?\r?\n\s*options:\s*)\[[\s\S]*?\r?\n\s*\}",
        { param($match) $match.Groups[1].Value + $categoryOptionsText + "$newLine    }" }
    )
    $regionsRegex = [regex]::new('"regions":\s*\[[^\]]*\]')
    $configText = $regionsRegex.Replace($configText, "`"regions`": $regionList", 1)

    [System.IO.File]::WriteAllText($ConfigPath, $configText, [System.Text.UTF8Encoding]::new($true))
}

function Get-DeployRegions {
    param(
        [string]$PrimaryRegion,
        [string]$AdditionalRegions
    )

    $items = @($PrimaryRegion)
    if ($AdditionalRegions.Trim() -ne "") {
        $items += $AdditionalRegions.Split(",")
    }

    $seen = @{}
    $regions = @()
    foreach ($item in $items) {
        $region = $item.Trim()
        if ($region -ne "" -and !$seen.ContainsKey($region)) {
            $seen[$region] = $true
            $regions += $region
        }
    }

    return $regions
}

$deployRegions = Get-DeployRegions -PrimaryRegion $RegionalRegion -AdditionalRegions $OtherRegions

$deployArgs = @(
    "cdk",
    "deploy",
    $localStackName
)
$deployArgs += $cdkProfileArgs
$deployArgs += @(
    "--require-approval",
    "never",
    "--parameters",
    "$($localStackName):CloudFrontDistributionArn=",
    "--context",
    "toolNamePrefix=$ToolNamePrefix",
    "--context",
    "subDir=$SubDir",
    "--context",
    "additionalService=$AdditionalService",
    "--context",
    "accountDisplayName=$resolvedAccountDisplayName",
    "--context",
    "region=$RegionalRegion",
    "--context",
    "otherRegions=$OtherRegions",
    "--context",
    "timeZone=$TimeZone"
)
Invoke-Cdk $deployArgs

$bucket = Get-StackOutput -Stack $localStackName -Region $RegionalRegion -OutputKey "ToolBucketName"
$lambdaFunctionUrl = aws @awsProfileArgs lambda get-function-url-config `
    --function-name "$ToolNamePrefix-describe-api" `
    --region $RegionalRegion `
    --query "FunctionUrl" `
    --output text
if ($LASTEXITCODE -ne 0) {
    throw "Failed to read Lambda function URL."
}

if (!$bucket -or $bucket -eq "None") {
    throw "ToolBucketName output was not found."
}

if (!$lambdaFunctionUrl -or $lambdaFunctionUrl -eq "None") {
    throw "Lambda function URL was not found."
}

$globalParameters = @(
    "ToolBucketName=$bucket",
    "ToolBucketRegion=$RegionalRegion",
    "LambdaFunctionUrl=$lambdaFunctionUrl",
    "EnableIpAllowList=$EnableIpAllowList",
    "AllowedIpV4Cidr=$AllowedIpV4Cidr",
    "AllowedIpV6Cidr=$AllowedIpV6Cidr"
)

$globalParameterArgs = @()
foreach ($parameter in $globalParameters) {
    $globalParameterArgs += @("--parameters", "$($globalStackName):$parameter")
}

$globalDeployArgs = @(
    "cdk",
    "deploy",
    $globalStackName
)
$globalDeployArgs += $cdkProfileArgs
$globalDeployArgs += @(
    "--require-approval",
    "never"
)
$globalDeployArgs += $globalParameterArgs
$globalDeployArgs += @(
    "--context",
    "toolNamePrefix=$ToolNamePrefix",
    "--context",
    "subDir=$SubDir",
    "--context",
    "additionalService=$AdditionalService",
    "--context",
    "accountDisplayName=$resolvedAccountDisplayName",
    "--context",
    "region=$RegionalRegion",
    "--context",
    "otherRegions=$OtherRegions",
    "--context",
    "timeZone=$TimeZone"
)
Invoke-Cdk $globalDeployArgs

$distributionId = Get-StackOutput -Stack $globalStackName -Region "us-east-1" -OutputKey "CloudFrontDistributionId"
$distributionArn = Get-StackOutput -Stack $globalStackName -Region "us-east-1" -OutputKey "CloudFrontDistributionArn"
$toolUrl = Get-StackOutput -Stack $globalStackName -Region "us-east-1" -OutputKey "ToolUrl"

if (!$distributionArn -or $distributionArn -eq "None") {
    throw "CloudFrontDistributionArn output was not found."
}

if (!$toolUrl -or $toolUrl -eq "None") {
    throw "ToolUrl output was not found."
}
if ($toolUrl -match '/web/index\.html$') {
    $toolRootUrl = $toolUrl -replace '/web/index\.html$', '/'
} else {
    $toolRootUrl = $toolUrl.TrimEnd('/') + '/'
}

$deployArgs = @(
    "cdk",
    "deploy",
    $localStackName
)
$deployArgs += $cdkProfileArgs
$deployArgs += @(
    "--require-approval",
    "never",
    "--parameters",
    "$($localStackName):CloudFrontDistributionArn=$distributionArn",
    "--context",
    "toolNamePrefix=$ToolNamePrefix",
    "--context",
    "subDir=$SubDir",
    "--context",
    "additionalService=$AdditionalService",
    "--context",
    "accountDisplayName=$resolvedAccountDisplayName",
    "--context",
    "region=$RegionalRegion",
    "--context",
    "otherRegions=$OtherRegions",
    "--context",
    "timeZone=$TimeZone"
)
Invoke-Cdk $deployArgs

$stagedWebRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("$ToolNamePrefix-web-" + [guid]::NewGuid().ToString("N"))
Copy-Item -LiteralPath ".\src\web" -Destination $stagedWebRoot -Recurse
Update-WebConfig `
    -ConfigPath (Join-Path $stagedWebRoot "style\config.js") `
    -ToolRootUrl $toolRootUrl `
    -SubDir $SubDir `
    -AdditionalService $AdditionalService `
    -AccountDisplayName $resolvedAccountDisplayName `
    -Regions $deployRegions `
    -TimeZoneName $TimeZone `
    -TagCategoryKey $TagCategory `
    -TagCategoryLabel $TagCategoryLabel `
    -TagCategorySelections $TagCategorySelections `
    -TagCategory2Key $TagCategory2

aws @awsProfileArgs s3 sync $stagedWebRoot "s3://$bucket/web/" --delete
if ($LASTEXITCODE -ne 0) {
    throw "aws s3 sync failed with exit code $LASTEXITCODE."
}

if (!$SkipInvalidation) {
    if (!$distributionId -or $distributionId -eq "None") {
        throw "CloudFrontDistributionId output was not found."
    }

    aws @awsProfileArgs cloudfront create-invalidation `
        --distribution-id $distributionId `
        --paths "/*" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "aws cloudfront create-invalidation failed with exit code $LASTEXITCODE."
    }
}

Write-Host "Deploy complete."
Write-Host "GlobalStack: $globalStackName (us-east-1)"
Write-Host "LocalStack: $localStackName ($RegionalRegion)"
Write-Host "Regions: $($deployRegions -join ',')"
Write-Host "ToolUrl: $toolUrl"
