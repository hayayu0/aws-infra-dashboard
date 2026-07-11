# 事前準備

## AWSアカウントのIAM設定

AWS CLI/CDKで、AdministratorAccessに近いIAMユーザーまたはロールが必要です。少なくとも CloudFormation、S3、Lambda、EventBridge Scheduler、CloudFront、WAFv2、IAMロール/ポリシーを作成・更新できる権限が必要です。

## 事前インストール

開発環境に以下をインストールしてセットアップしてください。プラットフォーム毎の標準セットアップ方法はWeb検索してください。

- git
- Node.js / npm
- AWS CLI
  - `aws configure` で初期設定も実施します。

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

デプロイ作業は、ログイン中のAWS認証情報を使って実行されます。  
AWS CLI/CDK を実行する前に、デプロイ先の AWSアカウントにログインしてください。通常は `aws login` を実行し、その後 `aws sts get-caller-identity` の出力でアカウントIDを確認してください。

```
aws login
aws sts get-caller-identity
```

## CDK Bootstrap

CDK は「AWSアカウント × リージョン」ごとに一度だけ bootstrap が必要です。  
このツールではメインとなるリージョンと `us-east-1` の2リージョンにスタックを作成するため、デプロイ先アカウントで bootstrap を2回します。

```
npx cdk bootstrap aws://<accountId>/ap-northeast-1 (メインが東京リージョンの場合)
npx cdk bootstrap aws://<accountId>/us-east-1
```

- メインのリージョンは、後のデプロイ処理で `--regional-region` オプションで指定します。(ap-northeast-1 なら省略可)
- `<accountId>` はデプロイ先のAWSアカウントID（12桁）です。
- 2行目の `us-east-1` は CloudFront/WAF用で、`regional-region` に関わらず常に必要です。

## デプロイ

CDKを使ってデプロイします。  
CDKは上記の `npm ci` でインストールされていますので、別途インストールは不要です。  
以下は指定可能な全オプションを付けた場合です。値を取るオプションはデフォルト値を記載しています。

**フルオプションの例　bash版**

```bash
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
  --profile "" \
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

オプションの説明

- sub-dir/SubDir は　複数アカウントのデータを同一アカウントのS3バケットに置く場合に、パスが重ならないために付与します。通常は不要です。
- RDSインスタンスが無い場合は、additional-service/AdditionalService の値を "" と指定します。
- tag-category/TagCategory は Web画面上でドロップダウンでフィルターに使用したいタグ名を指定します。アカウントごとに本番・開発が分離されている場合は、あえて、本番・開発の区分用のタグでフィルターしたい要件が無いかもしれません。その場合は、何らかの別のタグを指定するとよいでしょう。
- tag-category-label/TagCategoryLabel は、TagCategoryの画面上の表示名であり、tag-category-selections/TagCategorySelections は tag-category のドロップダウンの選択肢をカンマ区切りで指定します。`*` は「全て(タグ無し含む)」になります。値は `AAA,BBB,CCC,*` のようにカンマ区切りで指定します。
- `tag-category2` はクエリ文字列を使用して、表示用のフィルターに使うことのできるタグです。一覧にも列として表示されます。
 
オプション設定のポイント

- オプションを1つも付与しなくても動作します。
- `tool-name-prefix` は、EventBridgeやS3バケットやLambda関数など、多くのリソースに埋め込まれるため、後で変更不可の値です。
- 複数リージョンがある場合は、`regional-region` にメインとしたいリージョン、`other-regions` にメイン以外のリージョンをカンマ区切りで指定します。東京リージョンのみの場合は、`regional-region` も `other-regions` も指定する必要がありません。
- このツールは、デプロイした瞬間から日本国内と判定されたアクセス元からCloudFront経由でアクセスできてしまいます。それを防ぐ方法として、接続元IPアドレスで制限する方法があります。`enable-ip-allow-list` を true にし、`allowed-ipv4-cidr` / `allowed-ipv6-cidr` でホワイトリストのIPリストで指定します。CloudFront/WAFでIP制限できます。

## デプロイ完了確認

CDKの実行が最後まで完了したことを確認します。  
該当リージョンへの十分な権限がない場合は失敗しますので注意ください。
途中で `FAILED` や `ROLLBACK` が出た場合は、表示されたエラーとスタックの状態を確認してください。`ROLLBACK_COMPLETE` になった新規作成失敗スタックは、そのまま更新できないため、スタックを削除してから再実行します。

デプロイ後、以下の URL にアクセスしてページが開くことを確認します。  
URLのドメインは、デプロイ実行時の途中の出力結果にありますので、そこから取得します。

```
https://xxxxxxxxxx.cloudfront.net/
```

IP制限を有効にした場合は、許可したIPアドレスからアクセスしてください。

注意事項

- CloudFrontには日本からのアクセスだけを許可する地理的制限を設定しています。海外からもアクセスしたい場合は、`lib/global-stack.ts` の `geoRestriction` を変更または削除してから再デプロイしてください。

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

それぞれの設定内容は、なかなか理解するのが簡単ではありませんが、運用の現場で必要に迫られて実装したものばかりです。そのため多少の複雑性を持っていることを、ご了承ください。

## マルチアカウント対応

1つのダッシュボード画面で、複数のAWSアカウントを表示することもできます。  
各アカウントは独立してデプロイさせるのですが、（アカウントごとに専用のS3バケット・CloudFront・Lambdaを持つ）、それだけだと、Webもそれぞれ分かれてしまいます。それを `config.js` を活用することで1つに統合できます。  
どれかのAWSアカウントを、Webの代表アカウントとして選択してください。

### マルチアカウント対応の手順

1. 表示したいアカウントごとに、これまでと同じ手順（`aws login` → `CDK Bootstrap` → `デプロイ`）を実行します。認証（プロファイル）はアカウントごとに切り替えて、異なるアカウントにデプロイしなければならないことに注意してください。  
デプロイ完了時に出力される CloudFront の URL を控えておきます。

2. 代表アカウントの `src/web/script/config.js` をエディターで開き、`accounts` 配列に各アカウントを登録します。

編集例：

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

さらに、クロスアカウントでS3バケットを共通化するようにカスタムしたい場合もあるかと思います。  
その変更は、手動でIAMロールやS3バケットポリシーの修正などが必要になるため、このツール自体では直接は対応していません。ただし、S3のキー名（いわゆるフォルダパス名）が重ならないようにするための、`subDir` の設定を用意しています。

補足

- 各アカウントの画面は、それぞれの CloudFront URL から個別に開くこともできます。IP制限を有効にしている場合は、各アカウントの許可IPからアクセスしてください。

# 削除について

不要になった場合は、作成したAWSリソースを以下の順で削除します。

1. CloudFront/WAF側のglobalスタックを削除します。
2. EventBridgeのスケジューラーを無効化します。
3. S3バケットが空でないとlocalスタック削除に失敗するため、不要なデータであることを確認してからバケット内を空にします。
4. localスタックを削除します。
