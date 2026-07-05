# 必要ツールをインストールする

## 事前インストール対象

事前に、以下をインストールしてセットアップしてください。

- git
- Node.js / npm
- AWS CLI

## インストール確認

インストールされているかを以下のコマンドで確認します。

```
git --version
node --version
npm --version
aws --version
```

# リポジトリを配置

```
cd <リポジトリを配置するディレクトリ>
git clone https://github.com/hayayu0/aws-infra-dashboard aws-infra-dashboard
```

# npm依存を入れる

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
以下はフルオプションを付けた場合です。値はデフォルト値を記載しています。

- 複数リージョンがある場合は、regional-region にメインとしたいリージョン、other-regions にメイン以外をカンマ区切りで指定します。
- Webツール上で、ドロップダウンで絞り込み切り替えたいタグを tag-category で指定します。
- group-tag はクエリ文字列でフィルターに使いたいタグです。一覧にも列として表示されます。
- enable-ip-allow-list を true にして allowed-ipv4-cidr / allowed-ipv6-cidr に値を入れることで、CloudFrontでIP制限できます。
- tool-name-prefix はあちこちに埋め込まれるため後で変更不可ですが、他は config.js の編集や CloudFront の設定で変更できます。

bash版 

```bash
./tools/deploy-cdk.sh \
  --tool-name-prefix infra-dashboard \
  --account-id 1 \
  --account-display-name "アカ1" \
  --regional-region ap-northeast-1 \
  --other-regions "" \
  --time-zone Asia/Tokyo \
  --tag-category Env \
  --group-tag Application \
  --web-root "./src/web" \
  --enable-ip-allow-list false \
  --allowed-ipv4-cidr "" \
  --allowed-ipv6-cidr "" \
  --profile ""
```

powershell版

```powershell
.\tools\deploy-cdk.ps1 `
  -ToolNamePrefix infra-dashboard `
  -AccountId 1 `
  -AccountDisplayName "アカ1" `
  -RegionalRegion ap-northeast-1 `
  -OtherRegions "" `
  -TimeZone Asia/Tokyo `
  -TagCategory Env `
  -GroupTag Application `
  -WebRoot ".\src\web" `
  -EnableIpAllowList false `
  -AllowedIpV4Cidr "" `
  -AllowedIpV6Cidr "" `
  -Profile ""
```

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

