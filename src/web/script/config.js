'use strict';

window.appConfig = {
    defaultRegionId: 0,
    timezoneOffset: 9,
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
        serviceEc2AndRds: 'EC2＆RDS'
    },

    groupTagFilter: {
        key: 'Application',
        value: '',
        keyURL: 'application',
        allValue: 'ALL'
    },

    accounts: [
      {
        "accountName": "アカ1",
        "instanceRegionId": 0,
        "additionalService": ["RDS"],
        "regions": [ "ap-northeast-1", "ap-northeast-3" ],
        "urlRoot": window.location.origin + "/",
        "subDir": ""
      }
    ],

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
