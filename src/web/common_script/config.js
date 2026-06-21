﻿'use strict';

// =============================================================
// デプロイ/環境固有の必須設定 (window.appConfig)
// 新しい環境へ展開する際は、このファイル内の値を編集する
// =============================================================
window.appConfig = {
    defaultRegionId: 0,
    timezoneOffset: 9,
    tagnameFilter: ".*",
    urlToolRoot: "https://xxxxxxxxxxxxxx.cloudfront.net/",
    tablePageLengthOptions: [10, 20, 50, 100],
    defaultTablePageLength: 20,
    tableSortOrder: [[1, 'asc'], [0, 'asc']],

    messages: {
        startstopLoadPossiblyFailed: "一部の稼働履歴を取得できず、表示内容が正しくない可能性があります。"
    },
    labels: {
        reloadTableButton: "表示・更新",
        statusImpaired: "System異常",
        statusTerminated: "Terminated",
        serviceOptions: [
            { ec2Y_rdsY: 'EC2＆RDS' }
        ]
    },

    groupTagFilter: {
        key: 'Application',
        value: '',
        keyURL: 'application',
        allValue: 'ALL'
    },

    accounts: {
        "1": {
            "titleBarPre": "[Account1]",
            "selectAccountDisp": "アカウント1",
            "instanceRegionId": 0,
            "icon": "<img src=\"../common_script/images/accNo1.png\">",
            "instanceService": ["EC2", "RDS"],
            "regions": [ "ap-northeast-1", "us-east-1" ],
            "s3Dir": {
                "lambda": "lambda",  "stored": "stored"
            }
        }
    },

    // 環境(Env)の定義
    // 環境分類に使うタグのキー (例: 'Env' や 'Environment')
    tagKeys: { env: 'Env' },
    // 文字キー → { tagEnv:タグ値, display:表示名 } (tagEnv を 'Production' 等へ編集可)
    environmentList: {
        p: { tagEnv: 'Production',  display: '本番' },
        d: { tagEnv: 'Development', display: '開発' },
        s: { tagEnv: 'Staging',     display: '検証' },
        t: { tagEnv: 'Test',        display: 'テスト' }
    },
    // 環境フィルタのプリセット。ラベル既定は environmentList の display を '・' 連結 (例 'ds'→開発・検証)。dispOption で上書き可
    environmentOptions: [
        { optValue: 'psdt' },
        { optValue: 'p',  dispOption: '本番のみ' },
        { optValue: 'ds' },
        { optValue: 'dst' },
        { optValue: '*',      dispOption: '全て(環境タグ無し含む)' }
    ],

};
