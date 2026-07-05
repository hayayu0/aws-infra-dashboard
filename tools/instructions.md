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

