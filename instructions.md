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

# セットアップ

## リポジトリをクローン

```
cd <リポジトリを配置するディレクトリ>
git clone https://github.com/hayayu0/aws-infra-dashboard aws-infra-dashboard
```

## npm依存をインストール

```
cd aws-infra-dashboard
npm ci
```

## AWSにログイン

以下は例ですので、各環境で適切な方法でログインしてください。

```
aws login
aws sts get-caller-identity
```

## CDK Bootstrap

CDK は「AWSアカウント × リージョン」ごとに一度だけ bootstrap が必要です。  
このツールはメインリージョンと `us-east-1` の2リージョンにスタックを作成するため、デプロイ先アカウントで両方を bootstrap します。

```
npx cdk bootstrap aws://<accountId>/メインのリージョン(例：ap-northeast-1)
npx cdk bootstrap aws://<accountId>/us-east-1
```

- メインのリージョンは、後のデプロイ処理で `--regional-region` オプションで指定します。
- `<accountId>` はデプロイ先の AWS アカウントID（12桁）。`aws sts get-caller-identity` の `Account` で確認できます。
- 2行目の `us-east-1` は CloudFront/WAF（`-global` スタック）用で、`regional-region` に関わらず常に必要です。

## デプロイ

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

## デプロイ完了確認

CDKの実行が最後まで完了したことを確認します。  
途中で `FAILED` や `ROLLBACK` が出た場合は、表示されたエラーを確認してから再実行してください。

デプロイ後、以下の URL にアクセスしてページが開くことを確認します。  
URLのドメインは、デプロイ実行時の途中の出力結果にありますので、そこから取得します。

```
https://xxxxxxxxxx.cloudfront.net/web/infra_dashboard/index.html
```

IP制限を有効にした場合は、許可したIPアドレスからアクセスしてください。

# カスタム設定

## config.js の編集

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

## マルチアカウント対応

複数のAWSアカウントを、1つのダッシュボード画面から切り替えて表示できます。  
各アカウントは独立してデプロイし（アカウントごとに専用のS3バケット・CloudFront・Lambdaを持つ）、入口にする代表AWSアカウントの `config.js` に全アカウントを登録します。

1. 表示したいアカウントごとに、これまでと同じ手順（`aws login` → `CDK Bootstrap` → `デプロイ`）を実行します。認証（プロファイル）はアカウントごとに切り替えます。`--account-display-name` に画面表示名を指定し、デプロイ完了時に出力される CloudFront の URL を控えておきます。

2. 入口にするアカウントの `src/web/common_script/config.js` をエディターで開き、`accounts` 配列に各アカウントを登録します。

```js
accounts: [
  {
    "accountName": "アカ1",
    "additionalService": ["RDS"],
    "regions": [ "ap-northeast-1", "ap-northeast-3" ],
    "urlRoot": window.location.origin + "/",
    "subDir": ""
  },
  {
    "accountName": "アカ2",
    "additionalService": ["RDS"],
    "regions": [ "ap-northeast-1" ],
    "urlRoot": "https://yyyyyyyyyy.cloudfront.net/",
    "subDir": ""
  }
]
```

- `accountName`: 画面のアカウント切替に表示する名前。
- `urlRoot`: そのアカウントのデータ取得元。入口アカウント自身は `window.location.origin + "/"`、他アカウントは手順1で控えた CloudFront の URL（末尾スラッシュ必須）を指定します。
- `regions`: そのアカウントで表示するリージョン。
- `additionalService`: 取得する追加サービス。RDSが不要なら `[]` にします。
- `subDir`: 通常は空。1つのバケットを用途別に分ける場合のみ指定します。

3. 入口アカウントを再デプロイして、編集した `config.js` を反映します。

補足

- `accounts` の先頭エントリは、デプロイ時に `--account-display-name` などの指定値で上書きされます。追加するアカウントは2件目以降に記述してください。
- 各アカウントの画面は、それぞれの CloudFront URL から個別に開くこともできます。IP制限を有効にしている場合は、各アカウントの許可IPからアクセスしてください。

# 削除

不要になった場合は、作成したAWSリソースを以下の順で削除します。

1. CloudFront/WAF側のglobalスタックを削除します。
2. Eventbridgeのスケジューラーを無効化します。
3. S3バケットが空でないとlocalスタック削除に失敗するため、不要なデータであることを確認してからバケット内を空にします。
4. localスタックを削除します。
