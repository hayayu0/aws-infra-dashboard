# これは何か

このドキュメントは、aws-infra-dashboard をご自身の AWS アカウントにデプロイして使い始めるまでの手順です。上から順に進めれば完了します。  
所要時間は初回で30分〜1時間ほどです。

# 事前準備

## AWSアカウントのIAM設定

AWS CLI/CDKで、AdministratorAccessに近いIAMユーザーまたはロールが必要です。少なくとも CloudFormation、S3、Lambda、EventBridge Scheduler、CloudFront、WAFv2、IAMロール/ポリシーを作成・更新できる権限が必要です。

## 事前インストール

開発環境に以下をインストールしてセットアップしてください。各プラットフォーム(Linux/Mac/Windows)の標準セットアップ方法は、Web検索で確認ください。  
AWSのCloudShell環境の場合は、インストール済みです。

- git
- Node.js / npm
- AWS CLI
  - `aws configure` で初期設定も実施します。

インストールされているかを以下のコマンドで確認します。

```bash
git --version
node --version
npm --version
aws --version
```

# セットアップ

## リポジトリをクローン

```bash
cd <リポジトリを配置するディレクトリ>
git clone https://github.com/hayayu0/aws-infra-dashboard aws-infra-dashboard
```

## npm依存をインストール

```bash
cd aws-infra-dashboard
npm ci
```

## AWSにログイン

デプロイ作業は、ログイン中のAWS認証情報を使って実行されます。  
AWS CLI/CDK を実行する前に、デプロイ先の AWSアカウントにログインしてください。通常は `aws login` を実行し、その後 `aws sts get-caller-identity` の出力でアカウントIDを確認できます。

```bash
aws login
aws sts get-caller-identity
```

## CDK Bootstrap

CDK は「AWSアカウント × リージョン」ごとに一度だけ bootstrap が必要です。  
このツールではメインとなるリージョンと `us-east-1` の2リージョンにスタックを作成するため、デプロイ先アカウントで bootstrap を2回します。

```bash
npx cdk bootstrap aws://<accountId>/ap-northeast-1 (メインが東京リージョンの場合)
npx cdk bootstrap aws://<accountId>/us-east-1
```

- メインのリージョンは、後のデプロイ処理で `--regional-region` オプションで指定します。(ap-northeast-1 なら省略可)
- `<accountId>` はデプロイ先のAWSアカウントID（12桁）です。
- 2行目の `us-east-1` は CloudFront/WAF用で、`regional-region` に関わらず常に必要です。

## デプロイ

CDKを使ってデプロイします。  
CDKは上記の `npm ci` でインストールされていますので、別途インストールは不要です。  

以下は、オプションを1つも指定しない場合の実行方法です。  
オプションを指定しなくても一応実行できます。

**最小限の例　bash版**

```bash
chmod +x ./tools/deploy-cdk.sh
./tools/deploy-cdk.sh
```

**最小限の例　PowerShell版**

```powershell
.\tools\deploy-cdk.ps1
```

以下は指定可能な全オプションを付けた場合です。値を取るオプションはデフォルト値を記載しています。

**フルオプションの例　bash版**

```bash
chmod +x ./tools/deploy-cdk.sh
./tools/deploy-cdk.sh \
  --tool-name-prefix infra-dashboard \
  --sub-dir "" \
  --additional-service RDS \
  --account-display-name "アカ1" \
  --regional-region ap-northeast-1 \
  --other-regions "" \
  --time-zone Asia/Tokyo \
  --tag-category Env \
  --tag-category-label "環境" \
  --tag-category-selections "*" \
  --tag-category2 Application \
  --allowed-ipv4-cidr "" \
  --allowed-ipv6-cidr "" \
  --enable-ip-allow-list false \
  --profile ""
```

**フルオプションの例　PowerShell版**

```powershell
.\tools\deploy-cdk.ps1 `
  -ToolNamePrefix infra-dashboard `
  -SubDir "" `
  -AdditionalService RDS `
  -AccountDisplayName "アカ1" `
  -RegionalRegion ap-northeast-1 `
  -OtherRegions "" `
  -TimeZone Asia/Tokyo `
  -TagCategory Env `
  -TagCategoryLabel "環境" `
  -TagCategorySelections "*" `
  -TagCategory2 Application `
  -AllowedIpV4Cidr "" `
  -AllowedIpV6Cidr "" `
  -EnableIpAllowList false `
  -Profile ""
```

### オプションの説明

- sub-dir/SubDir は　複数アカウントのデータを同一アカウントのS3バケットに置く場合に、パスが重ならないために付与します。通常は不要です。
- RDSインスタンスが無い場合は、additional-service/AdditionalService の値を "" と指定します。
- tag-category/TagCategory は Web画面上でドロップダウンでフィルターに使用したいタグ名を指定します。アカウントごとに本番・開発が分離されている場合は、あえて、本番・開発の区分用のタグでフィルターしたい要件が無いかもしれません。その場合は、何らかの別のタグを指定するとよいでしょう。
- tag-category-label/TagCategoryLabel は、TagCategoryの画面上の表示名であり、tag-category-selections/TagCategorySelections は tag-category のドロップダウンの選択肢をカンマ区切りで指定します。`*` は「全て(タグ無し含む)」になります。値は `AAA,BBB,CCC,*` のようにカンマ区切りで指定します。
- `tag-category2` はクエリ文字列を使用して、表示用のフィルターに使うことのできるタグです。一覧にも列として表示されます。
 
### オプション設定のポイント

- オプションを1つも付与しなくても動作します。
- `tool-name-prefix` は、EventBridgeやS3バケットやLambda関数など、多くのリソースに埋め込まれるため、後で変更不可の値です。
- 複数リージョンがある場合は、`regional-region` にメインとしたいリージョン、`other-regions` にメイン以外のリージョンをカンマ区切りで指定します。東京リージョンのみの場合は、`regional-region` も `other-regions` も指定する必要がありません。
- このツールは、デプロイした瞬間から日本国内と判定されたアクセス元からCloudFront経由でアクセスできてしまいます。それを防ぐ方法として、接続元IPアドレスで制限する方法があります。`enable-ip-allow-list` を true にし、`allowed-ipv4-cidr` / `allowed-ipv6-cidr` でホワイトリストのIPリストで指定します。CloudFront/WAFでIP制限できます。

## デプロイ完了確認

CDKの出力を確認して、最後まで完了したことを確認します。  
CloudFrontのURLが最後に表示されていればOKです。

```
https://xxxxxxxxxx.cloudfront.net/
```

デプロイ後、URL にアクセスしてページが開くことを確認します。  

途中で `FAILED` や `ROLLBACK` が出た場合は、表示されたエラーとスタックの状態を確認してください。該当リージョンへの十分なIAM権限がない可能性がないかを確認しましょう。  
`ROLLBACK_COMPLETE` になった新規作成失敗スタックは、そのまま更新できないため、スタックを削除してから、デプロイを再実行します。


IP制限を有効にした場合は、許可したIPアドレスからアクセスする必要があります。

**⚠️注意事項**

- CloudFrontには日本からのアクセスだけを許可する地理的制限を設定しています。海外からもアクセスしたい場合は、`lib/global-stack.ts` の `geoRestriction` を変更または削除してから再デプロイしてください。

## CloudFrontのプラン変更

CloudFrontは、CDKの都合上 Billing設定が `Pay-as-you-go` プランになっています。料金を無料に近づけるために Freeプランに変更することも可能です。  
変更したい場合はお手数ですが、CloudFrontコンソールを開いて、直接操作してください。

# カスタム設定

## config.js の編集

画面表示のデフォルト値やタグの扱いを変更したい場合は、必要に応じて以下を編集します。

ソースファイル `src/web/script/config.js` または S3バケット内の `/web/script/config.js`

たとえば、以下のような値を確認します。

- `tagnameFilter` : 表示対象のインスタンスをNameタグで制限できます。正規表現を記述します。
- `tablePageLengthOptions` : インスタンスが非常に多い場合に大きな数字を選択肢に追加します。
- `defaultTablePageLength` : インスタンスが非常に多い場合に1ページの件数を大きな数字にします。
- `tableSortOrder` : デフォルトのソート順序を指定できます。
- `labels` : `停止済み`, `システム異常` 等の表現を変更できます。
- `groupTagFilter` : URLのクエリ文字列で表示対象を絞ることができるタグを指定できます。デフォルト値の場合、URL に `&application=db` のように付与すると、Applicationタグが db のものだけが表示されます。
- `categoryTag` : ドロップダウンで表示対象を絞ることができますが、そのタグ、画面の表現、ドロップダウンの選択肢、等を編集できます。tagValues の配列を使うと、複数のタグがOR条件で含まれているインスタンスを意味する選択項目になります。

設定項目が多く見えますが、必要なものだけ触れば大丈夫です。  
運用の現場で必要に迫られて実装した設定です。

## マルチアカウント対応

1つのダッシュボード画面で、複数のAWSアカウントを表示することもできます。  
各アカウントは独立してデプロイさせるのですが、（アカウントごとに専用のS3バケット・CloudFront・Lambdaを持つ）、それだけだと、Webもそれぞれ分かれてしまいます。それを `config.js` を活用することで1つに統合できます。  
どれかのAWSアカウントを、Webの代表アカウントとして選択してください。

### マルチアカウント対応の手順

1. 表示したいアカウントごとに、これまでと同じ手順（`aws login` → `CDK Bootstrap` → `デプロイ`）を実行します。認証（プロファイル）はアカウントごとに切り替えて、異なるアカウントにデプロイしなければならないことに注意してください。  
デプロイ完了時に出力される CloudFront の URL を控えておきます。

2. 代表アカウントの `src/web/script/config.js` をエディターで開き、`accounts` 配列に各アカウントを登録します。

**編集例**

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
- `urlRoot`: そのアカウントのデータ取得元。代表アカウントは `window.location.origin + "/"` のままとして、他アカウントは手順1で控えた CloudFront の URL `https://yyyyyyyyyy.cloudfront.net/` を指定します。
- `regions`、`additionalService`、`subDir` はデプロイ時に指定したものに合わせます。

3. 代表アカウントを再デプロイして、編集した `config.js` を反映します。(S3バケットを直接書き換えた場合は不要)

**💡補足**

- 各アカウントの画面は、それぞれの CloudFront URL から個別に開くこともできます。IP制限を有効にしている場合は、各アカウントの許可IPからアクセスしてください。
- クロスアカウントで S3バケットを同一（共通）にカスタムしたい場合、手動でのIAMロールやS3バケットポリシーの修正が必要になり、ツール自体では直接は対応していません。ただし、S3のキー名（いわゆるフォルダパス名）が重ならないようにするための、`subDir` で設定できるように準備しています。


# ツールの削除について

不要になった場合は、作成したAWSリソースを以下の順で削除します。

1. バージニア北部リージョン(us-east-1)のglobalスタックを削除します。
2. メインとしたリージョンのEventBridgeのスケジューラーを無効化します。
3. S3バケットが空でないとlocalスタック削除に失敗するため、該当のS3バケットを空にします。(必要に応じてデータを退避しましょう)
4. メインとしたリージョンのlocalスタックを削除します。

