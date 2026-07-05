# 事前準備

## AWSアカウントのIAM設定

AWS CLIで iam:CreateRole および iam:AttachRolePolicy 権限を付与するほどのIAMユーザーまたはロールが必要です。

## 事前インストール

開発環境に以下をインストールしてセットアップしてください。

- git
- Node.js / npm
- AWS CLI
  - `aws configure` で初期設定します。

インストールされているかを以下のコマンドで確認します。

```
git --version
node --version
npm --version
aws --version
```

# リポジトリをクローン

```
cd <リポジトリを配置するディレクトリ>
git clone https://github.com/hayayu0/aws-infra-dashboard aws-infra-dashboard
```

# npm依存をインストール

```
cd aws-infra-dashboard
npm ci
```

# AWSにログイン

以下は例ですので、各環境で適切な方法でログインしてください。

```
aws login
aws sts get-caller-identity
```

# デプロイ

CDKを使ってデプロイします。  
CDKは上記の `npm ci` でインストールされています。  
以下はフルオプションを付けた場合です。下記のコマンド例の値はデフォルト値を記載しています。

- tag-category-label は Web 画面上の分類ラベルです。
- tag-category-selections は tag-category の選択肢をカンマ区切りで指定します。`*` は「全て(タグ無し含む)」になります。

**フルオプションの例　bash版**

```bash
./tools/deploy-cdk.sh \
  --tool-name-prefix infra-dashboard \
  --account-id 1 \
  --account-display-name "アカ1" \
  --regional-region ap-northeast-1 \
  --other-regions "" \
  --time-zone Asia/Tokyo \
  --tag-category Env \
  --tag-category-label "環境" \
  --tag-category-selections "*" \
  --tag-category2 Application \
  --enable-ip-allow-list false \
  --allowed-ipv4-cidr "" \
  --allowed-ipv6-cidr "" \
  --profile ""
```

**フルオプションの例　Powershell版**

```powershell
.\tools\deploy-cdk.ps1 `
  -ToolNamePrefix infra-dashboard `
  -AccountId 1 `
  -AccountDisplayName "アカ1" `
  -RegionalRegion ap-northeast-1 `
  -OtherRegions "" `
  -TimeZone Asia/Tokyo `
  -TagCategory Env `
  -TagCategoryLabel "環境" `
  -TagCategorySelections "*" `
  -TagCategory2 Application `
  -EnableIpAllowList false `
  -AllowedIpV4Cidr "" `
  -AllowedIpV6Cidr "" `
  -Profile ""
```

オプション設定のポイント

- オプションを1つも付与しなくても動作します。
- `tool-name-prefix` はあちこちのリソースに埋め込まれるため、後で変更不可です。
- 複数リージョンがある場合は、`regional-region` にメインとしたいリージョン、`other-regions` にメイン以外のリージョンをカンマ区切りで指定します。
- Webツール上で、ドロップダウンで絞り込み切り替えたいタグを `tag-category` で指定します。
- `tag-category2` はクエリ文字列でフィルターに使いたいタグです。一覧にも列として表示されます。
- `enable-ip-allow-list` を true にして `allowed-ipv4-cidr` / `allowed-ipv6-cidr` に値を入れることで、CloudFront/WAFでIP制限できます。
- `tag-category` を含むオプションはドロップダウンに関係します。特に `tag-category-selections` の値は `Production,Development,Staging,*` のようにカンマ区切りで指定しますが、デプロイ後に直接 config.js を直接編集してもよいです。

# デプロイ完了確認

CDKの実行が最後まで完了したことを確認します。

途中で `FAILED` や `ROLLBACK` が出た場合は、表示されたエラーを確認してから再実行してください。

確認ポイントは以下です。

- コマンドがエラー終了していないこと
- CloudFormation のスタック作成または更新が完了していること
- CloudFront の URL が出力されていること
- `aws s3 sync` が失敗していないこと

# Webページ確認

デプロイ後、以下の URL にアクセスしてページが開くことを確認します。

```
https://xxxxxxxxxx.cloudfront.net/web/instance_status/index.html
```

以下を確認します。

- ブラウザでページが開くこと
- インスタンス一覧の画面が表示されること
- アカウント、リージョン、タグの表示が想定どおりであること

IP制限を有効にした場合は、許可したIPアドレスからアクセスしてください。

# config.js の編集

画面表示のデフォルト値やタグの扱いを変更したい場合は、必要に応じて以下を編集します。

```
src/web/common_script/config.js
```

たとえば、以下のような値を確認します。

- `defaultRegionId`
- `tablePageLengthOptions`
- `defaultTablePageLength`
- `groupTagFilter`
- `categoryTag`

編集後は、再度 CDK デプロイを実行して Web ファイルを反映してください。

# 削除・後始末

不要になった場合は、作成したAWSリソースを削除します。以下は既定の `infra-dashboard` / `ap-northeast-1` でデプロイした場合の例です。`ToolNamePrefix` や `RegionalRegion` を変えた場合は、同じ値に読み替えてください。

まずS3バケット名を確認します。

```powershell
$ToolNamePrefix = "infra-dashboard"
$RegionalRegion = "ap-northeast-1"
$LocalStackName = "$ToolNamePrefix-local"
$GlobalStackName = "$ToolNamePrefix-global"

$BucketName = aws cloudformation describe-stacks `
  --stack-name $LocalStackName `
  --region $RegionalRegion `
  --query "Stacks[0].Outputs[?OutputKey=='ToolBucketName'].OutputValue | [0]" `
  --output text
```

CloudFront/WAF側のglobalスタックを削除します。

```powershell
npx cdk destroy $GlobalStackName `
  --force `
  --context toolNamePrefix=$ToolNamePrefix `
  --context region=$RegionalRegion
```

S3バケットが空でないとlocalスタック削除に失敗するため、不要なデータであることを確認してからバケット内を空にします。

```powershell
aws s3 rm "s3://$BucketName" --recursive
```

最後にlocalスタックを削除します。

```powershell
npx cdk destroy $LocalStackName `
  --force `
  --context toolNamePrefix=$ToolNamePrefix `
  --context region=$RegionalRegion
```

削除後は、CloudFormationで両方のスタックが消えていることを確認します。

```powershell
aws cloudformation describe-stacks --stack-name $GlobalStackName --region us-east-1
aws cloudformation describe-stacks --stack-name $LocalStackName --region $RegionalRegion
```

削除済みであれば `does not exist` 系のエラーになります。あわせて、S3、CloudFront、Lambda、EventBridge Scheduler、WAFに対象リソースが残っていないことをAWSコンソールで確認してください。
