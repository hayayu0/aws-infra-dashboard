# aws-infra-dashboard

AWSアカウント内のEC2/RDSの稼働状況を、CloudFront経由のWeb画面で確認するためのダッシュボードです。

EC2/RDSの現在状態、日ごとの起動・停止履歴、CPU使用率、タグによる分類を1つの画面で見られるようにします。AWSコンソールを何画面も移動せず、運用者が「どのインスタンスが、いつ、どの分類で、どれくらい動いていたか」を確認する用途に向いています。

## 主な特徴

- EC2/RDSの稼働状況を一覧表示
- 起動中、停止中、異常、終了済みなどの状態を色分け表示
- 1日単位の稼働履歴をタイムライン表示
- CPU使用率を履歴バー上に重ねて確認
- タグで分類、絞り込み、列表示
- 複数リージョンのEC2/RDSを1つのWeb画面で切り替え表示
- 収集済みデータをS3に保存し、過去日の表示に利用
- CloudFront + S3 + Lambda Function URLでWeb/APIを公開
- CloudFront/WAFによるIP許可リスト設定に対応
- CDKで新規AWSアカウントへ再現可能にデプロイ

現時点では、単一AWSアカウント向けの構成です。マルチリージョンには対応しています。

## 画面でできること

Web画面では、EC2/RDSを同じ表で確認できます。

- 日付を切り替えて過去日の稼働状況を確認
- リージョンを切り替えて対象範囲を確認
- サービス、タグ分類、検索文字列で絞り込み
- 表示列をON/OFF
- CPU使用率の表示ON/OFF
- インスタンス/RDSごとの履歴画面へ遷移

タグ分類はデプロイ時に指定できます。たとえば `Application` タグを `DB,Web,AP,*` の選択肢で分類したり、別のタグをURLフィルター用に使ったりできます。

## AWS構成

CDKで大きく2つのスタックを作成します。

- `*-local`
  - S3バケット
  - Lambda関数
  - Lambda Function URL
  - EventBridge Scheduler
  - Webファイル配置
- `*-global`
  - CloudFront Distribution
  - CloudFront Origin Access Control
  - WAF/IP許可リスト

WebファイルはS3に配置され、ブラウザからはCloudFront経由でアクセスします。API呼び出しは `/api*` でCloudFrontからLambda Function URLへ転送されます。S3バケットとLambda Function URLは直接公開せず、CloudFront経由で利用する構成です。

EventBridge Schedulerは、稼働履歴、CPU使用率、EC2/RDS describe結果の収集を定期実行します。収集したデータはS3に保存され、Web画面がそれを読み込んで表示します。

## セットアップ

詳細な手順は [instructions.md](instructions.md) を参照してください。

最小の流れは以下です。

```powershell
git clone https://github.com/hayayu0/aws-infra-dashboard aws-infra-dashboard
cd aws-infra-dashboard
npm ci
aws login
.\tools\deploy-cdk.ps1
```

PowerShell版のフルオプション例、bash版の例、IP制限、タグ分類、複数リージョン指定などは [instructions.md](instructions.md) にまとめています。

## デプロイ例

単一アカウント、東京リージョン中心でデプロイする最小例です。

```powershell
.\tools\deploy-cdk.ps1
```

複数リージョン、タグ分類、IP許可リストを指定する例です。

```powershell
.\tools\deploy-cdk.ps1 `
  -ToolNamePrefix infra-dashboard `
  -RegionalRegion ap-northeast-1 `
  -OtherRegions "ap-northeast-3,ap-southeast-1" `
  -TagCategory Application `
  -TagCategoryLabel "環境" `
  -TagCategorySelections "DB,Web,AP,*" `
  -TagCategory2 Env `
  -EnableIpAllowList true `
  -AllowedIpV4Cidr "0.0.0.0/1,128.0.0.0/1" `
  -AllowedIpV6Cidr "::/1,8000::/1"
```

`ToolNamePrefix` はAWSリソース名に使われるため、作成後に変更しない前提で決めてください。

## 設定ファイル

Web画面の初期表示やタグ分類は `src/web/common_script/config.js` で管理します。デプロイスクリプトは、指定されたオプションをもとにデプロイ時の `config.js` を生成してS3へ配置します。

主な設定項目です。

- `accounts`
- `groupTagFilter`
- `categoryTag`
- `defaultRegionId`
- `timezoneOffset`
- `demo`

デモ表示では、`demo.now` と `demo.message` を設定することで、特定日を「今日」として表示できます。

## 開発用ファイル

CDKはTypeScriptで記述されています。

- `bin/instance-status.ts`: CDKアプリのエントリポイント
- `lib/local-stack.ts`: リージョン側リソース
- `lib/global-stack.ts`: CloudFront/WAF側リソース
- `src/web`: Web画面
- `src/lambda-python`: Lambda関数コード
- `tools/deploy-cdk.ps1`: Windows/PowerShell用デプロイ
- `tools/deploy-cdk.sh`: bash用デプロイ

`package.json`、`package-lock.json`、`tsconfig.json` は、CDKの依存関係とTypeScript検査を再現するためにリポジトリ直下に置いています。

## 削除・後始末

不要になった場合は、CloudFormation/CDKスタックとS3内のデータを削除します。S3バケットにWebファイルや収集データが残っていると、localスタックの削除に失敗することがあります。

基本方針は以下です。

- CloudFront/WAF側の `*-global` スタックを削除
- S3バケット内のWebファイル、収集データ、キャッシュを削除
- Lambda、Scheduler、S3バケットを含む `*-local` スタックを削除
- CloudFormationに `DELETE_FAILED` が残っていないことを確認
- S3、CloudFront、Lambda、EventBridge Scheduler、WAFに対象リソースが残っていないことを確認

具体的なコマンド例は [instructions.md](instructions.md) を参照してください。

## ライセンス

MIT License です。

## 注意事項

- デプロイするとAWSリソースが作成され、利用状況に応じて課金されます。
- CloudFrontはグローバルサービスのため、関連スタックは `us-east-1` に作成されます。
- `/0` のCIDRはAWS WAFのIPSetでは使えません。全IPv4許可を明示する場合は `0.0.0.0/1,128.0.0.0/1`、全IPv6許可を明示する場合は `::/1,8000::/1` を使います。
- 本ツールは運用可視化を目的としたダッシュボードです。起動・停止などの操作機能は主目的ではありません。
