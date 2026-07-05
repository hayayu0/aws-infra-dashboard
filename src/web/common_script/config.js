﻿'use strict';

// デプロイ/環境固有の必須設定 (window.appConfig)
// 新しい環境へ展開する際は、このファイル内の値を編集する
window.appConfig = {
    defaultRegionId: 0,
    timezoneOffset: 9,
    demo: {
        now: null
    },
    tagnameFilter: ".*",
    urlToolRoot: window.location.origin + "/",
    tablePageLengthOptions: [10, 20, 50, 100],
    defaultTablePageLength: 20,
    tableSortOrder: [[1, 'asc'], [0, 'asc']],

    messages: {
        startstopLoadPossiblyFailed: "一部の稼働履歴を取得できなかったため、表示が正しくない可能性があります。"
    },
    labels: {
        reloadTableButton: "表示・更新",
        legendStopped: "停止済み",
        legendRunning: "稼働中",
        legendImpaired: "システム異常",
        legendTerminated: "Terminated",
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
            "selectAccountDisp": "アカ1",
            "instanceRegionId": 0,
            "instanceService": ["EC2", "RDS"],
            "regions": [ "ap-northeast-1", "ap-northeast-3" ],
            "urlRoot": window.location.origin + "/"
        }
    },

    // タグ分類列の定義。label/key/options を変更することで「環境」「システム」など任意の区分にできる
    categoryTag: {
        label: '環境',
        key: 'Env',
        options: [
            { tagValues: ['Production','Development','Staging','Test'], display: '本番・開発・検証・テスト' },
            { tagValues: ['Production'], display: '本番のみ' },
            { tagValues: ['Development','Staging'], display: '開発・検証' },
            { tagValues: ['Development','Staging','Test'], display: '開発・検証・テスト' },
            { tagValues: ['*'], display: '全て(環境タグ無し含む)' }
        ]
    }
};
