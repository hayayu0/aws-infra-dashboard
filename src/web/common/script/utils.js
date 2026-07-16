﻿'use strict';

const util = {
	writeHtml: (selectorOrElem, html) => {
		const el = (typeof selectorOrElem === 'string') ? document.querySelector(selectorOrElem) : selectorOrElem;
		if (el) el.innerHTML = html;
	},

	config: {
		regions: [
			{id:"ap-northeast-1", grp:"アジアパシフィック", location:"東京"},
			{id:"ap-northeast-3", grp:"アジアパシフィック", location:"大阪"},
			{id:"ap-southeast-1", grp:"アジアパシフィック", location:"シンガポール"},
			{id:"ap-northeast-2", grp:"アジアパシフィック", location:"ソウル"},
			{id:"ap-southeast-2", grp:"アジアパシフィック", location:"シドニー"},
			{id:"ap-south-1", grp:"アジアパシフィック", location:"ムンバイ"},
			{id:"us-east-1", grp:"米国東部", location:"バージニア北部"},
			{id:"us-west-1", grp:"米国西部", location:"北カリフォルニア"},
			{id:"us-east-2", grp:"米国東部", location:"オハイオ"},
			{id:"us-west-2", grp:"米国西部", location:"オレゴン"},
			{id:"ca-central-1", grp:"カナダ", location:"中部"},
			{id:"eu-central-1", grp:"欧州", location:"フランクフルト"},
			{id:"eu-west-1", grp:"欧州", location:"アイルランド"},
			{id:"eu-west-2", grp:"欧州", location:"ロンドン"},
			{id:"eu-west-3", grp:"欧州", location:"パリ"},
			{id:"eu-north-1", grp:"欧州", location:"ストックホルム"},
			{id:"sa-east-1", grp:"南米", location:"サンパウロ"}
		],

		darkMode: {
			selectors: 'body, .dataTable > tbody td, .HeaderBarBlock, .dataTables_filter label, .dataTables_length, .dataTables_info, .dataTables_paginate, .dataTables_filter label, .dataTables_length, .dataTables_info, .defcol, .blue, .red, .green, .fadeInBox, #ColumnVisibleChecks',
			defaultColorSelectors: 'body, .dataTable > tbody td, .dataTables_filter label, .dataTables_length, .dataTables_info, .fadeInBox'
		}
	}
};

if(!window.appConfig){
	throw new Error('config.js must be loaded before utils.js');
}

const normalizeAccountConfigs = (accountsConfig) => (accountsConfig || []).map((accountConfig) => {
	const config = accountConfig || {};
	// additionalService: 未定義なら ['RDS']、配列なら空文字要素を除去（[] や [""] は「追加サービスなし」）
	const additionalService = Array.isArray(config.additionalService)
		? config.additionalService.map((value) => String(value).trim()).filter((value) => value !== '')
		: ['RDS'];
	return { ...config, additionalService };
});
window.normalizeAccountConfigs = normalizeAccountConfigs;

const demoNow = window.appConfig.demo?.now || null;

// ページごとに独立したLocalStorageキーを生成するヘルパー
const reversePath = location.pathname.split('/').reverse();
const createLocalStorageKey = (key) => reversePath[1] + '-' + reversePath[0].split('.')[0] + '-' + key;

// URLのホームディレクトリ  このスクリプト自身のURLから切り出して生成
const urlHome = document.currentScript.src.replace(/(.*)\:\/\/(.*?)\/(.*)\/(.*?)\/(.*)$/, '/$3');

const requestedAccountForRegions = new URLSearchParams(window.location.search).get('account');
const accountsForRegions = normalizeAccountConfigs(window.appConfig.accounts);
const defaultAccountIndexForRegions = accountsForRegions[0] ? '0' : '';
const accountForRegions = accountsForRegions[requestedAccountForRegions] || accountsForRegions[defaultAccountIndexForRegions] || {};
const configuredRegionIds = accountsForRegions.flatMap(account => Array.isArray(account.regions) ? account.regions : []);
const ownRegionId = (() => {
	const ownRegions = Array.isArray(accountForRegions.regions) ? accountForRegions.regions : [];
	return ownRegions[accountForRegions.instanceRegionId || 0] || ownRegions[0] || util.config.regions[window.appConfig.defaultRegionId]?.id || util.config.regions[0]?.id || '';
})();
const availableRegionIds = [...new Set([...configuredRegionIds, ownRegionId].filter(v => v))];
const availableRegions = (availableRegionIds.length > 0 ? availableRegionIds : util.config.regions.map(region => region.id))
	.map(regionId => util.config.regions.find(region => region.id === regionId) || { id:regionId, grp:'', location:regionId })
	.filter(region => region.id);
const selectedRegionIdFromUrl = (() => {
	const regionParam = new URLSearchParams(window.location.search).get('region');
	return regionParam ? regionParam.trim() : '';
})();
const createSelectedRegions = (regionIds) => availableRegions.filter(region => regionIds.includes(region.id));
let regions = availableRegions.slice();
let regionId = Math.max(regions.findIndex(region => region.id === ownRegionId), 0);   // 自アカウントの既定リージョンで初期化
if(selectedRegionIdFromUrl){
	const urlRegionIndex = regions.findIndex(region => region.id === selectedRegionIdFromUrl);
	if(urlRegionIndex >= 0) regionId = urlRegionIndex;
}

// Nameタグ(tagname)のフィルター(正規表現文字列)
let tagnameFilter = window.appConfig.tagnameFilter;
let tagnameFilterRegExp = new RegExp(tagnameFilter);

// テーブル読み込みボタンが押されたときの呼び出すコールバック関数 空で初期化
let callbackOnClickReloadTableButton = () => {};

// 選択されたリソース(EC2/RDS)のValue
let selectedSvcVal = '';
const hasRdsAccount = accountsForRegions.some(account => (account.additionalService || []).includes('RDS'));
const serviceOptions = hasRdsAccount ? [
	{ optValue: 'ec2Y_rdsY', display: window.appConfig.labels.serviceEc2AndRds },
	{ optValue: 'ec2Y_rdsN', display: 'EC2' },
	{ optValue: 'ec2N_rdsY', display: 'RDS' }
] : [
	{ optValue: 'ec2Y_rdsN', display: 'EC2' }
];
const serviceIndexRegexp = '(' + serviceOptions.map((_, idx) => idx).join('|') + ')';

// グループタグフィルター
const groupTagFilter = window.appConfig.groupTagFilter;

// DataTableの検索ボックスでフィルターするテキスト ページリロード時にボックスにセットする
let filteredText = '';

// 曜日の文字とCSS色(ブランクはデフォルト色)
const youbiArr = '日月火水木金土';
const youbiColorStyle = [ 'color:#ff5555;', '', '', '', '', '', 'color:#5555ff' ];

// Darkモード用
// html側で以下の2つの変数を設定しておくことで対象セレクタの色をカスタム可能
//
// const darkselector = "セレクタ1, セレクタ2, セレクタ3, ....";
// const darkselectordefcolor = "セレクタ1, セレクタ2, セレクタ3, ....";
//
// darkselector が設定されたセレクタは、darkモードON/OFFに対応して、class="dark"のadd(付与)とremove(外し)がおこなわれ、色が変わる対象になる
// darkselector をセットする前提としてcssファイルに セレクタ1.dark { color:red, background-color:yellow; }  のようにdarkモード用の色を準備しておく
// darkselector に記述した中で、背景を黒(#111)、文字を白(#fafafa)、で十分なセレクタがあれば darkselectordefcolor への記述は不要
// darkselectorに指定しなくても、body、DataTable関連、色系クラス、.fadeInBox、#ColumnVisibleChecks あたりは組み込み済み
//
// Darkモード対応のデフォルトセレクタ
let dk_slr = util.config.darkMode.selectors;
// Darkモード対応かつデフォルト色(黒白)用のデフォルトセレクタ
let dk_slrdef = util.config.darkMode.defaultColorSelectors;

let tblcolCache = null;

// 現在日時
const _today = demoNow || new Date();

// Darkモード状態(local storageから読み出して初期化)
const darkSwitch = localStorage.getItem('dark');

// -------------------------------------------------------------
// URLの非同期読み込みfetch()のラップ関数
// opt.type: 'text', 'raw', 'json' (default: 'json')
// opt.header: true / false (default: false)
// -------------------------------------------------------------
util.fetch = async (url, opt) => {

	const response = await fetch(url);

	if(opt?.type === 'text' && opt?.header !== true){
		return response.text();
	}
	else if(opt?.type === 'raw'){
        return response;
	}
	else if((opt?.type === 'json' || !opt?.type) && opt?.header === true){
        const data = await response.json();
        return [ response.headers, data ];
	}
	else if(opt?.type === 'text' && opt?.header === true){
        const data = await response.text();
        return [ response.headers, data ];
	}
	// default (opt.type === 'json' && opt.header === false)

	try {
		return await response.json();
	}catch (error){
		if(error instanceof SyntaxError){
		    return { "Error_Message": "Failed to parse JSON" };
		}
	    return { "Error_Message": "Unknown Error" };
	}
}
// -------------------------------------------------------------
// Nameタグフィルターを更新
// filter: フィルタしたい文字
// opt.retry: 正規表現がエラーだった場合にボックスを再表示するフラグ
// -------------------------------------------------------------
util.updateTagnameFilter = (filter, opt) => {

    const input = document.getElementById('tagname_filter_textbox');
	try{
		if(new RegExp(filter)){
			// 正規表現として正しいならグローバル変数に保管
			tagnameFilter = filter;
			tagnameFilterRegExp = RegExp(tagnameFilter);
			if(!opt?.retry && input) input.value = filter;
		}
		if(input) input.style.backgroundColor = 'white';
	}catch(e){
		if(opt?.retry && input){
			input.style.backgroundColor = '#f77';
		}
	}
}


// -------------------------------------------------------------
// タグを削除する
// 例: "<div><p>text123</p></div>" → "text123"
// -------------------------------------------------------------
util.removeTag = (str) => {
	return str.toString().replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/ig,'').replace(/<[^>]*>/g,'');
}


// -------------------------------------------------------------
// Excel出力用にセル値を整形する
// -------------------------------------------------------------
util.formatExcelExportBody = (dat) => {
	const str = (typeof dat === 'string') ? dat.replace(/<br>/ig, '\r\n') : dat;
	return util.removeTag(str).replace(/^0([0-9][%％])$/, '$1');
}


// -------------------------------------------------------------
// 安全な文字列に変更
// -------------------------------------------------------------
util.escapeHTML = (str) => {
	if (typeof str !== 'string') return '';
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}


// -------------------------------------------------------------
// 「何日前 mm/dd(曜日)」のドロップダウンの生成
// selector: 出力先のセレクタ
// ago: 0以上=初回に選択する値
// maxago: 最大日数
// -------------------------------------------------------------
util.createDropdownDate = (selector, ago, maxago = 365) => {
    const target = document.querySelector(selector);
    if(!target) return;

	let html = '<select id="sel_oldday" class="sel_pad">';
	html += `<option value="0">今日 ${_today.getMonth()+1}/${_today.getDate()}(${youbiArr.charAt(_today.getDay())})`;
	
    let oldday = new Date(_today.getFullYear(), _today.getMonth(), _today.getDate() - 1);
	html += `<option value="1">昨日 ${oldday.getMonth()+1}/${oldday.getDate()}(${youbiArr.charAt(oldday.getDay())})`;

	for(let n=2; n<=maxago; n++){
		oldday = new Date(_today.getFullYear(), _today.getMonth(), _today.getDate() - n);
		html += `<option value="${n}">${n}日前 ${oldday.getMonth()+1}/${oldday.getDate()}(${youbiArr.charAt(oldday.getDay())})`;
	}

	html += '</select>';
	util.writeHtml(target, html);

    const select = target.querySelector('select');
	if(!isNaN(ago) && ago >= 0 && select){   // URLパラメータdateで指定された日付を選択
		select.selectedIndex = ago;
	}
}


// -------------------------------------------------------------
// テキストをクリップボードにコピー
// opt.appendTo: クリップボード出力用textareaに一時追加するセレクタ
//               デフォルト値'body'だと勝手に一番上にスクロールされる場合があるため何か指定した方が良い
// opt.msgTo: メッセージ出力先のセレクタ
// opt.msg: 「Copied」等のテキスト(デフォルト値は「コピーしました」)
// -------------------------------------------------------------
util.copyToClipboard = (text, opt) => {

	// テキストエリアを作成し、テキストを入力(画面には出さない)
	let $textarea = $('<textarea></textarea>');
	$textarea.text(text);

	// テキストエリアを既存DOMに追加
	if(opt?.appendTo){
		$(opt.appendTo).prepend($textarea);
	}else{
		$('body').prepend($textarea);
	}

	// テキストエリアを選択状態にして、コピー
	$textarea.select();
	document.execCommand('copy');

	// テキストエリアの削除
	$textarea.remove();

	if(opt?.msgTo){
		$(opt.msgTo).text( opt?.msg || 'コピーしました' );
		$(opt.msgTo).css('display', '').delay(600).fadeOut(400);
	}
}


// -------------------------------------------------------------
// Dark Modeに合わせた色変更
// DarkmodeスイッチのOn/Off切り替えイベントで呼び出される
// DataTables内への色反映のため、DataTableWrap の drawcallbackでも呼び出される
// 引数 onoff は初回のみ指定（前回のDarkモードの状態を呼び出して指定）
// -------------------------------------------------------------
util.drawDarkMode = (onoff) => {

	if(onoff === 'on' || $('#dk_ck').prop('checked')){
		$(dk_slr).addClass('dark');
		$(dk_slrdef).css({'color':'#fafafa', 'background-color':'#111'});
	}else{
		$(dk_slr).removeClass('dark');
		$(dk_slrdef).css({'color':'', 'background-color':''});
	}

	localStorage.setItem('dark', ($('body').hasClass('dark') ? 'on' : 'off'));
}


// -------------------------------------------------------------
// ローカルストレージに保存
// selobj: ドロップダウンのセレクタ名の配列
// chkobj: チェックボックスのセレクタ名の配列
// -------------------------------------------------------------
util.saveControlToLocalStorage = (selobj, chkobj) => {

    let combinedSel = selobj || [];
	// 引数に指定していなくてもドロップダウンがあれば保存するパラメータ
	for(let sel of ['sel_svc', 'sel_category']){
		if(document.getElementById(sel)){
			if(!combinedSel.includes(sel)) combinedSel.push(sel);
		}
	}

	combinedSel.forEach((id) => {
		const el = document.getElementById(id);
        if(el) localStorage.setItem(createLocalStorageKey(id + '_index'), el.selectedIndex);
	});

	if(chkobj){
		chkobj.forEach((id) => {
			const el = document.getElementById(id);
            if(el) localStorage.setItem(createLocalStorageKey(id + '_checked'), el.checked ? 1 : 0);
		});
	}
}


// -------------------------------------------------------------
// 表示・非表示のチェックボックスを追加
// domid: tableセレクタID。'#xxxx'形式
// tblcol: 値の書式は、{ 識別名:{no:列番号, visible:true/false, checkbox: 'チェックボックスのラベル名' }, }
//       識別名は chk_識別名 でチェックボックスのIDとして使われ、chk_識別名_checked でlocalstorageのキー名としても使われる
//       noは列番号で0から始まる数字 0から詰めて記述して空き番号は作らないこと
//       visibleは、初期表示のデフォルト値。LocalStorageで chk_識別名_checked = '1' であればLocalStorageが優先される
//       checkboxは、#ColumnVisibleChecks の個所にチェックボックスを表示する際のラベル名  未定義ならチェックボックスを表示しない
// type: 'init' or 'update'
// -------------------------------------------------------------
util.showHideColumnCheckBox = function(domid, tblcol, type){

	tblcolCache = tblcol || tblcolCache;

	if(!tblcolCache) return;

	if(type === 'init' && $('#ColumnVisibleChecks input').length === 0){

		$.each(tblcolCache, (i, v) => {
			if(v.checkbox){
				const chkId = 'chk_' + i;
				$('#ColumnVisibleChecks').append('<label><input type="checkbox" class="InputColChecks sp" id="' + chkId + '">' + v.checkbox + '</label>');

				// 保存キーをページごとに分離
				const storageKey = createLocalStorageKey(chkId + '_checked');
				if(localStorage.getItem(storageKey) == '1' && $('#' + chkId).length){
					$('#' + chkId).prop('checked', true);
				}
				else if(localStorage.getItem(storageKey) != '0' && v.visible === true){
					$('#' + chkId).prop('checked', true);
				}
				$('#ColumnVisibleChecks').css('visibility', 'visible');
			}
		});
	}

	if(type === 'update'){

		let selector = '';

		$.each(tblcolCache, (i, v) => {
			selector += (v.checkbox ? (selector ? ',' : '') + '#chk_' + i : '');
		});

		// 表示・非表示を実施する関数定義
		let showhidecolumn = (id) => {

			if(!$(domid + ' > tbody') || !$(domid + ' > tbody').length) return;

			$(domid).css('visibility', 'hidden');

			setTimeout(() => {

				$.each(tblcolCache, (i, v) => {
					if(v.checkbox){
						tblcolCache[ i ].visible = $('#chk_' + i).prop('checked');
					}
				});

				if(id){
					let colname = id.replace('chk_', '');
					$(domid).DataTable().column(tblcolCache[colname].no).visible(tblcolCache[colname].visible);
				}else{
					let hide_list = [];
					$.each(tblcolCache, (i, v) => {   // 非表示の列のリストを作成
						if(v.visible === false && !isNaN(v.no)) hide_list[ hide_list.length ] = v.no;
					});

					// column(col1).visible()で1列ずつせずに columns([col1, col2]).visible()で一括で非表示に
					if(hide_list.length > 0) $(domid).DataTable().columns(hide_list).visible(false);
				}

				$(domid).css('visibility', 'visible');   // テーブルを再表示
			}, 30);
		}

		// 該当チェックボックスが押されたら列の表示・非表示を更新  このイベントはTableが再作成されるたびに合わせて更新
		$(document).on('click', selector, function(){
			showhidecolumn($(this)[0].id);

			// ローカルストレージに「チェックボックス名_checked = チェック状態」を保存
			localStorage.setItem(createLocalStorageKey($(this)[0].id + '_checked'), ($('#' + $(this)[0].id).prop('checked') ? '1' : '0'));
		});

		// Tableロード直後に即時実施
		showhidecolumn();
	}
}


// -------------------------------------------------------------
// アドレスバーのURL書き換え
// urlparam: [ [ "key1", "value1"], [ "key2", "value2"], ... ]
// addhistoryflg: true=URL履歴を追加して書き換える  基本は初回呼び出しの時のみtrueを指定する  履歴だらけになることを防ぐ
// opt.searchtable: 検索ボックスをURL履歴に含める場合のTableのセレクタ '#myTable'等
// -------------------------------------------------------------
util.replaceAddressBarURL = (urlparam, addhistoryflg, opt) => {
	let newlocation = [ location.pathname , location.hash , '?' ];   // path, #xxxx, ?categoryIdx=0&svcIdx=0&
	let searchcount = 0;

	if(addhistoryflg){
		history.pushState('', '', location.href);   // 書き換え用に履歴を追加
	}

	if(opt?.searchtable){
        const searchInput = document.querySelector(`${opt.searchtable}_filter label input`);
        if(searchInput){
            filteredText = searchInput.value || '';
            urlparam.push([ 'search', filteredText ]);
        }
	}

	if( location.search.search(/\?/) !== -1 ){
		location.search.split('?')[1].split('&').forEach((val) => {
			let searchfound = false;

			// 既存URLに含まれるURLパラメータの上書き更新
			for(let i=0; i<urlparam.length; i++){
				if(val.startsWith(urlparam[i][0] + '=')){

					// 値があればURLパラメータ追加 なければURLパラメータ追加しない(過去あっても削除される)
					if(urlparam[i][1] != null && urlparam[i][1] !== '' && urlparam[i][1] != 'undefined'){

						val = ((searchcount>0) ? '&' : '') + urlparam[i][0] + '=' + encodeURIComponent( urlparam[i][1] );
						newlocation[2] += val;
						searchcount++;
					}
					urlparam[i][2] = true;
					searchfound = true;
				}
			}

			// 指定以外のパラメータはそのまま移行
			if(!searchfound){
				newlocation[2] +=  ((searchcount>0) ? '&' : '') + val;
				searchcount++;
			}
		});
	}

	for(let i=0; i<urlparam.length; i++){
		// 指定のURLパラメータが既存のURL内に存在しなかったので追加
		if(!urlparam[i][2] && urlparam[i][1] !== ''){
			newlocation[2] += ((searchcount>0) ? '&' : '') + urlparam[i][0] + '=' + encodeURIComponent( urlparam[i][1] );
			searchcount++;
		}
	}

	// 完成したURLをアドレスバーに表示
	history.replaceState('','', newlocation[0]+newlocation[1]+newlocation[2]);
}


// -------------------------------------------------------------
// テーブル読み込みボタンの表示を初期化
// opt.selector: セレクタの内容が変更またはクリックされたらボタンを再表示する、その対象セレクタ
// opt.selector_change: セレクタの内容が変更されたらボタンを再表示する、その対象セレクタ
// opt.btnname：表示するボタン名
// opt.clickCallback: ボタンが押されたときの呼び出すコールバック関数
// opt.runWait: 指定したミリ秒待ってから即時実行(1以上の場合)
// -------------------------------------------------------------
util.initReloadTableButton = (opt) => {

	let sel = '#region_disp, #tagname_filter_textbox, #_check_nocache' + (opt.selector ? ', ' + opt.selector : '');
	let sel_change = '#sel_svc, #sel_category' + (opt.selector_change ? ', ' + opt.selector_change : '');

	// コールバック関数のセット
	if(opt.clickCallback){
		callbackOnClickReloadTableButton = opt.clickCallback;
	}

	// <div id="Main">の先頭にボタンを追加  ボタンの前にコンテンツを置きた場合は "MainBlock"の子要素を"PreMain","Main"のように分ける
	$('#Main').prepend('<div id="_reloadTableControl"><input type="button" id="reloadTableButton" value="' + (opt.btnname || 'テーブル読み込み')+ '"></div>');

	if(opt.runWait && opt.runWait >= 1){
		$('#_reloadTableControl').css('display', 'none');

		setTimeout(() => {
			callbackOnClickReloadTableButton();
		}, parseInt(opt.runWait));
	}

	// イベント設定　対象セレクター操作時はテーブル読み込みボタンを表示
	$(document).on('change click', sel, () => {
		$('#_reloadTableControl').css('display', 'block');
	});
	$(document).on('change', sel_change, () => {
		$('#_reloadTableControl').css('display', 'block');
	});
}


// -------------------------------------------------------------
// テーブル読み込みボタンをクリック(発火)
// delay: コールバックまでに遅延ミリ秒  デフォルト値は200ミリ秒
// -------------------------------------------------------------
util.clickReloadTableButton = (delay) => {

	setTimeout(() => {
        document.getElementById('_reloadTableControl').style.display = 'none';
		callbackOnClickReloadTableButton();
	}, (delay || 200));
}


// -------------------------------------------------------------
// 曜日 (日)～(土) を色付きCSSで返す
// dt：必要な日付のDateオブジェクト（nullなら今日）
// -------------------------------------------------------------
util.getYoubiWithColor = (dt = _today) => {

	return '<span style="' + youbiColorStyle[dt.getDay()] + '">(' + youbiArr.charAt(dt.getDay()) + ')</span>';
}


// -------------------------------------------------------------
// フィルター対象のNameタグかを判定する
// tagname: 表示判定対象のNameタグ(EC2のNameタグ, RDS名)
// 戻り値: true=表示対象, false=非表示対象
// -------------------------------------------------------------
util.dispFilterTagname = (tagname) => {

	// ツールオプションのフィルタで対象外
	if(tagnameFilter && tagname.search(tagnameFilterRegExp) === -1){
		return false;
	}

	// 表示対象
	return true;
}


// -------------------------------------------------------------
// URLパラメータとローカルストレージを読み込んで各種コントロールに反映
//
// selobj: ドロップダウンのセレクタのオブジェクト
// chkobj: チェックボックスのセレクタ名のオブジェクト
// selobj['セレクタ'].defvalue: LocalStorageもURLパラメータも指定が無い場合のデフォルト値 (chkobjも同様)
// selobj['セレクタ'].param: セレクタに対するURLパラメータの名称 (同一なら省略可能) (chkobjも同様)
// selobj['セレクタ'].regexp: URLパラメータの値の範囲 (chkobjは "[01]"が自明なので無し)

// opt.reqGroupTag  true=グループタグが無い場合に警告メッセージを表示
// opt.search  DataTable読み込み後に検索ボックスへリストアする文字
// opt.loadnow  true=ページロード直後にTable読み込みするURLパラメータ「loadnow」を有効化する
// -------------------------------------------------------------
util.getUrlParameterAndLocalStorageToControl = (selobj, chkobj, opt = {}) => {

	selobj = selobj || {};
	chkobj = chkobj || {};
	opt = opt || {};

	// 引数に指定していなくてもチェックするパラメータ
	selobj['sel_svc'] = { 'param': 'svcIdx', 'regexp': serviceIndexRegexp }
	selobj['sel_category'] = { 'param': 'categoryIdx', 'regexp': '[0-9]' }

	// URLパラメータ
	let locationSearch = ( $(location).attr('search').substring('?') ) ? $(location).attr('search').split('?')[1].split('&') : [];

	// ドロップダウン
	$.each(selobj, (k, v) => {

		let selparam = selobj[k].param || k;
		let selregexp = (selobj[k].regexp && selobj[k].regexp.length) ? selobj[k].regexp : '.*';
		let resultval = (selobj[k].defvalue === '0' || selobj[k].defvalue) ? selobj[k].defvalue : null;

		const storageKey = createLocalStorageKey(k + '_index');

		// ローカルストレージから読み込んで設定
		if(localStorage.getItem(storageKey) != null && localStorage.getItem(storageKey).match(new RegExp(selregexp))){
			resultval = localStorage.getItem(storageKey);
		}

		// URLパラメータから読み込んで設定
		$.each(locationSearch, (idx, val) => {

			if(val.match( new RegExp('^' + selparam + '=' + selregexp + '$') )){
				resultval = val.substring( val.indexOf('=') + 1 );
			}
		});

		if(resultval !== null){
			// #sel_svcと#sel_categoryの準備完了後にtrigger発火が必要なため遅延させる
			setTimeout(() => { $('#' + k).prop('selectedIndex', resultval).trigger('change');  }, 250);
		}

	});

	// チェックボックス
	$.each(chkobj, (k, v) => {

		let selparam = chkobj[k].param || k;
		let resultval = (chkobj[k].defvalue === '0' || chkobj[k].defvalue) ? chkobj[k].defvalue : null;

		const storageKey = createLocalStorageKey(k + '_checked');

		// ローカルストレージから読み込んで設定
		if(localStorage.getItem(storageKey) != null && localStorage.getItem(storageKey).match(/^[01]$/)){
			resultval = localStorage.getItem(storageKey);
		}

		// URLパラメータから読み込んで設定
		$.each(locationSearch, (idx, val) => {

			if(val.match( new RegExp('^' + selparam + '=[01]$') )){
				resultval = val.substring( val.indexOf('=') + 1 );
			}
		});

		if(resultval !== null){
			// ドロップダウンと合わせてチェックボックスも同様に遅延させる
			setTimeout(() => { $('#' + k).prop('checked', ((resultval == 0) ? false : true));  }, 250);
		}

	});

	const groupTagRegex = new RegExp(`^${groupTagFilter.keyURL}=.+$`, '');

	// その他URLパラメータ
	$.each( locationSearch, (idx, val) => {

		if(val.search(groupTagRegex) === 0){
			groupTagFilter.value = val.substring(groupTagFilter.keyURL.length + 1);   // 特定グループタグがあればフィルターするように準備
		}
		else if(opt.search === true && val.search(/^search=.*$/) !== -1){
			filteredText = decodeURIComponent( val.substring(7) );
		}
		else if(opt.loadnow === true && val.search(/^loadnow$/) !== -1){
			// テーブルを即時表示(即時とは言ってもドロップダウンの準備に600ミリ秒かかるようにしているため余裕をもって750ミリ秒のdelay)
			util.clickReloadTableButton(750);
		}
	});

	// 必須のタグがURLパラメータにない場合の警告
	if(opt.reqGroupTag === true && groupTagFilter.value === ''){
		$('body').prepend('<div id="_acwarn" style="color:red; background-color:#dcc; width:98%; margin:0 auto; text-align:center; position:absolute; top:80px; padding:6px 0; z-index:200" class="fontbig25">' + 
		`エラー! URLパラメータに ${groupTagFilter.keyURL}=xxxx が正しく指定されていないため表示できません！</div>`);
	}
}


// -------------------------------------------------------------
// DataTable()のWrap関数
// -------------------------------------------------------------
util.DataTableWrap = (tbl, opt) => {

	$.extend(opt, {
		language: {
			buttons:{ copyTitle:'クリップボードへコピー', copySuccess:{_:' %d 行をコピーしました'} },
			search: '検索',
			sInfo: '合計 _TOTAL_ 件 (_START_ ～ _END_ を表示)',
			sLengthMenu: '　_MENU_ 件ずつ表示'
		}
	});

	// DataTables 2 では dom より layout が標準のため、既存で使っている2パターンだけ最小変換する
	if(opt.dom === 'Blfrtip'){
		opt.layout = {
			topStart: [ 'buttons', 'pageLength' ],
			topEnd: 'search',
			bottomStart: 'info',
			bottomEnd: 'paging'
		};
		delete opt.dom;
	}else if(opt.dom === 'Bfrti'){
		opt.layout = {
			topStart: 'buttons',
			topEnd: 'search',
			bottomStart: 'info',
			bottomEnd: null
		};
		delete opt.dom;
	}

	// opt.buttontype が ['xxx']または['xxx', 'xxx'] のどちらかの場合、opt.buttonをプリセットに書き換える
	if(opt.buttontype){
		opt.buttons = [ { extend:'copyHtml5', title:null } ];
		if(opt.buttontype.length == 1){
			opt.buttons.push( { extend:'excelHtml5', text:'Excel出力', filename:opt.buttontype[0], title:null, exportOptions: { format: { body: function(dat, col, row){ return util.formatExcelExportBody(dat) } } } } );
		}
		else if(opt.buttontype.length === 2){
			opt.buttons.push( { extend:'excelHtml5', text:'Excel出力（表示列のみ）', filename:opt.buttontype[0], title:null, exportOptions: { columns:':visible', format: { body: function(dat, col, row){ return util.formatExcelExportBody(dat) } } } } );
			opt.buttons.push( { extend:'excelHtml5', text:'Excel出力（全ての列）', filename:opt.buttontype[1], title:null, exportOptions: { format: { body: function(dat, col, row){ return util.formatExcelExportBody(dat) } } } } );
		}
		delete opt.buttontype;
	}

	// InitComplete用 local関数
	const InitCompleteDefault = (tbl) => {

		setTimeout(() => {

			util.showHideColumnCheckBox('#' + tbl[0].id, null, 'update');

			// テーブルロード完了時に実行したい処理が opt.loadComplete にセットされているのでここに設定する
			if(opt.loadComplete){
				opt.loadComplete();
			}

			// 最新の情報を読み込むチェックボックスをOFFにする
			if( $('#_check_nocache').length ){
				$('#_check_nocache').prop('checked', false);
			}

			// 更新前に入力されていた検索文字を検索ボックスに再設定する
			if(filteredText){
				setTimeout( () => {
					// ＃ dataTablesのフィルター強制作動には .change() や keypress,keydownイベントではNGで、keyupイベントだとOKだった
					$('#' + tbl[0].id + '_filter input').val(filteredText).trigger('keyup');
				}, 250);
			}

		}, 200);
	}

	// initComplete があれば InitCompleteDefault() を付与する
	// カスタム処理を入れたい場合は opt.initComplete ではなく opt.loadComplete で記述すると呼び出し元で記述が簡潔にできる(2021/10～)
	if(opt.initComplete){
		let f = opt.initComplete;
		opt.initComplete = () => { f();  InitCompleteDefault(tbl);  }
	}else{
		opt.initComplete = () => { InitCompleteDefault(tbl); }
	}

	// drawCallbackを省略したら util.drawDarkMode() を呼ぶ
	if(opt.drawCallback){
		let fu = opt.drawCallback;
		opt.drawCallback = () => { fu(); util.drawDarkMode(); }
	}else{
		opt.drawCallback = () => { util.drawDarkMode(); }
	}

	return tbl.DataTable(opt);
}


// -------------------------------------------------------------
// グループタグがURLで指定した表示対象かを判定
// grpVal：チェック対象の値
// -------------------------------------------------------------
util.IsGroupTagFilterOk = (grpVal) => {

	let dispok = true;

	if(!(groupTagFilter.value && groupTagFilter.value.split(',').indexOf(groupTagFilter.allValue) >= 0) && grpVal){
		if(!groupTagFilter.value){
			dispok = false;
		}else{
			dispok = false;
			$.each(groupTagFilter.value.split(','), (i, v) => {
				if(v == grpVal){
					return (dispok = true);
				}
			});
		}
	}
	return dispok;
}


// -------------------------------------------------------------
// -------------------------------------------------------------
// キャッシュ秒数を指定するURLパラメーターを生成する
// 't=nnnnn' はWebブラウザのキャッシュへの対策 nnnnnはUNIX時間(秒)をsec*2で割った値
// 'cache=nnn' はLambda関数のキャッシュ期限切れ判定で利用 nnnはキャッシュ有効期間(秒)
// sec: キャッシュ有効期間の秒数 (1～)
// paramType: 'tc'なら't=nnnnn&cache=nnn' を返し 't'なら't=nnnnn' を返す
// 戻り値：URLパラメーターの文字列 (例："t=28768301&cache=60")
// -------------------------------------------------------------
util.cacheParam = (sec, paramType = 'tc') => {

	if(sec === 0) return '';
	let params = '';
	if(paramType.includes('t')) params = 't=' + Math.floor(new Date().getTime() / 1000 / sec) * sec;
	if(paramType === 'tc') params = params + '&cache=' + sec;
	return params;
}


// -------------------------------------------------------------
// regionId変数と右上のリージョン表示とを更新する
// -------------------------------------------------------------
util.updateRegionDisp = (newRegionId) => {

	regionId = newRegionId;
	const regionText = regions[regionId]?.location || regions[regionId]?.id || '';
	if($('#region_disp').html() !== regionText){
		$('#region_disp').html(regionText + ' ').change();   // リージョン表示を更新
	}
}

util.getSelectedRegionIds = () => (regions[regionId]?.id ? [regions[regionId].id] : []);

util.getSelectedRegionDispText = () => regions[regionId]?.location || regions[regionId]?.id || '';

util.syncSelectedRegionsDisp = (triggerChange = true) => {
	const regionText = util.getSelectedRegionDispText();
	if(document.getElementById('region_disp') && $('#region_disp').html() !== regionText){
		$('#region_disp').html(regionText + ' ');
		if(triggerChange) $('#region_disp').change();
	}
	if(document.getElementById('DispRegion')){
		document.getElementById('DispRegion').innerText = regionText;
	}
}

util.syncSelectedRegionCheckboxes = () => {
	document.querySelectorAll('.sel_regions_chk').forEach((checkbox) => {
		checkbox.checked = util.getSelectedRegionIds().includes(checkbox.value);
	});
}

util.updateSelectedRegions = (newRegionIds, opt = {}) => {
	regions = createSelectedRegions(newRegionIds || []);
	regionId = Math.min(regionId, Math.max(regions.length - 1, 0));
	util.syncSelectedRegionsDisp(opt.triggerChange !== false);
}

util.positionToolOptionBox = () => {
	const button = document.getElementById('tool_options_open_btn');
	const box = document.getElementById('ToolOptionBox');
	if(!button || !box) return;

	const rect = button.getBoundingClientRect();
	const scrollX = window.scrollX || window.pageXOffset;
	const scrollY = window.scrollY || window.pageYOffset;
	const maxLeft = scrollX + window.innerWidth - box.offsetWidth - 12;
	const left = Math.max(scrollX + 8, Math.min(scrollX + rect.left, maxLeft));
	const top = scrollY + rect.bottom + 4;

	box.style.left = left + 'px';
	box.style.top = top + 'px';
	box.style.right = 'auto';
}


// -------------------------------------------------------------
// indexedDBの各種定義
// -------------------------------------------------------------
const iDB = { 
    dbName: 'CacheDB', 
    storeName: { json: 'json', text: 'text' },
    version: 1
};

util.dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(iDB.dbName, iDB.version);
    req.onupgradeneeded = () => {
        Object.values(iDB.storeName).filter(store => !req.result.objectStoreNames.contains(store)).map((store) => {
            req.result.createObjectStore(store, { keyPath: 'url' });
        });
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
});

// myOpt:
//   timeout:nn -> nnミリ秒経過しても実データが取得できない場合でかつindexedDBにdataがあればdataをcacheとして返す。デフォルト値は1000
//   header:true -> 実データ[0]とヘッダ[1] の配列を返す。ヘッダは Last-Modified取得用のみ。後続で get('Last-Modified') されてもいいように疑似処理。デフォルト値はfalse
//   ignoreParams:['t'] -> URLの xxx.com/xxx.html?t=100&u=200&v=300 のうち t=100 を削った文字列をindexedDBのキーにする。デフォルト値は ['t', 'cache']
util.cacheFetch = async (url, myOpt = {}) => {

    const config = {
        filetype: 'json', timeout: 1000, header: false, ignoreParams: ['t', 'cache'],
        ...myOpt
    };

    const urlObj = new URL(url, location.href);
    config.ignoreParams.forEach(p => urlObj.searchParams.delete(p));
    const cacheKey = urlObj.host + urlObj.pathname + urlObj.search;

    const networkPromise = fetch(url).then(async r => {
        if (!r.ok) return Promise.reject(new Error(`HTTP ${r.status}`));
        const data = (config.filetype === 'json') ? await r.json() : await r.text();

        await util.saveCache(cacheKey, data, config.filetype);

        return config.header ? [r.headers, data] : data;
    });

    const timeoutPromise = new Promise(res => setTimeout(() => {
        res({ isFetchTimeout: true });
    }, config.timeout));

    const result = await Promise.race([networkPromise, timeoutPromise]);   // 実データとタイムアウトを競わせる

    if (!result?.isFetchTimeout) return result;   // 実データやブラウザキャッシュがTimeout内の場合はそれを返す

    // タイムアウトした場合：ここで初めてIndexedDBを読みに行く
    const db = await util.dbPromise;
    let cachedResult = null;

    if (db) {
        cachedResult = await new Promise(res => {
            const tx = db.transaction(iDB.storeName[config.filetype], 'readonly');
            const req = tx.objectStore(iDB.storeName[config.filetype]).get(cacheKey);
            req.onsuccess = () => {
                if (!req.result) return res(null);
                if (config.header) {
                    const imHeaders = { get: (name) => (name.toLowerCase() === 'last-modified' ? req.result.timestamp : null) };
                    res([imHeaders, req.result.data]);
                } else {
                    res(req.result.data);
                }
            };
            req.onerror = () => res(null);
        });
    }

    if (cachedResult) return cachedResult;   // キャッシュがあれば返し、実データの待機を終了する

    const netData = await networkPromise;   // 実データが来るまで待つ
    return netData;
};


util.saveCache = async (cacheKey, data, filetype = 'json') => {
    const db = await util.dbPromise;
    if (!db || data == null) return;
    return new Promise((resolve) => {
        const tx = db.transaction(iDB.storeName[filetype], 'readwrite');
        const store = tx.objectStore(iDB.storeName[filetype]);
        const req = store.put(
            { data: data, url: cacheKey, timestamp: new Date().toUTCString() }
        );
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => resolve();
    });
};


// -------------------------------------------------------------
// ページ読み込み完了時に実行するもの色々
// -------------------------------------------------------------
$(function(){

	// Darkモード用切替スイッチを追加
	$('#darkbtn').append('<table id="dk_t"><tbody><tr><td id="dk_t_c1"></td><td id="dk_t_c2"></td></table>');
	$('#dk_t_c1').append('<div class="dark-switch-moon"></div>');
	$('#dk_t_c2').append('<input type="checkbox" id="dk_ck" ' + (darkSwitch === "on" ? "checked" : "") + '><label class="check" for="dk_ck"><div></div></label>');

	// 背景のみをクイックに設定
	if(darkSwitch === 'on') document.body.style.backgroundColor = '#111';

	// クリップボードへコピーする関連処理
	// 対象文字(セレクタ class="toClip" or class="toClipDel")にカーソルが入る
	$(document).on('mouseenter', '.toClip, .toClipDel', function(){

		// 既にフェードアウト開始中ではないこと
		if($(this).data('copied') !== 'true'){
			// クリップボードへコピーするボタンを追加
			$(this).append('<div style="display:inline-block; padding-left:5px; font-size:11px; cursor:default;" class="toClipBtn"><img src="' + urlHome + '/images/toclip.png"><span class="toClipMsg"></span></div>');
		}
	});
	// 対象文字(セレクタ class="toClip" or class="toClipDel")からカーソルが外れる
	$(document).on('mouseleave', '.toClip, .toClipDel', function(){

		// 既にフェードアウト開始中ではないこと
		if($(this).data('copied') !== 'true'){
			// クリップボードへコピーするボタンを除去
			$(this).children('.toClipBtn').remove();
		}
	});
	// クリップボードへコピーするボタンをクリック
	$(document).on('click', '.toClipBtn', function(){

		if($(this).parent().data('copied') === 'true') return;

		// クリップボードへコピーを実施
		util.copyToClipboard($(this).parent().text(), {msgTo:'.toClipMsg', appendTo:$(this).parent() });
		$(this).parent().data('copied', 'true');

		let $this = $(this);
		setTimeout(function(){
			$this.parent().data('copied', 'false');
			// toClipMsgのフェードアウトのタイミングに合わせてボタンもフェードアウト
			$('.toClipBtn').fadeOut(400);
			if($this.closest('.toClipDel')[0]){
				$($this.closest('.toClipDel')[0]).remove();
			}
		}, 600);
	});

	// Darkモード切替
	$('#dk_ck').click(
		() => { util.drawDarkMode(); }
	)
	setTimeout(() => {
		// Darkモード用セレクタの個別追加（呼び出し元htmlで指定している場合）
		if(typeof darkselector != 'undefined' && darkselector){ dk_slr += ', ' + darkselector; }
		if(typeof darkselectordefcolor != 'undefined' && darkselectordefcolor){
			dk_slrdef += ', ' + darkselectordefcolor;
		}
		// Darkモード初回設定
		util.drawDarkMode(darkSwitch);
	} ,50);

	// テーブル再読み込みボタン
	$(document).on('click', '#reloadTableButton', () => {

		callbackOnClickReloadTableButton();
		$('#_reloadTableControl').css('display', 'none');
	});

	// EC2/RDS選択のドロップダウンを追加
	if(document.querySelector('#SelSvcLabel')){
		let svcOptHtml = '';
		serviceOptions.forEach((svc) => {
			const svcValue = util.escapeHTML(String(svc.optValue || ''));
			const svcDisplay = util.escapeHTML(String(svc.display || svc.dispOption || svc.optValue || ''));
			svcOptHtml += '<option value="' + svcValue + '">' + svcDisplay + '</option>';
		});

		$('#SelSvcLabel').html(
			'<span>インスタンス：</span>' + 
			'<select id="sel_svc" class="sel_pad">' + svcOptHtml + '</select>' + 
			'<span class="sp"></span>'
		);

		$('#sel_svc').on('change', function(){
			selectedSvcVal = $('#sel_svc').val();
		});
	}

	// タグ分類選択のドロップダウンを追加
	if(document.querySelector('#SelCategoryLabel')){

		const categoryTag = window.appConfig.categoryTag || {};
		const categoryOpts = categoryTag.options || [];
		let optHtml = '';
		categoryOpts.forEach((opt, idx) => {
			optHtml += '<option value="' + idx + '">' + (opt.display || (opt.tagValues || []).join('・'));
		});

		$('#SelCategoryLabel').after(
			'<span>' + util.escapeHTML(categoryTag.label || '分類') + '：</span>' + 
			'<select id="sel_category" class="sel_pad">' + optHtml + '</select><span class="sp"></span>'
		);

	}

	// ページ表示＋'#sel_svc','#sel_category'の値セットから十分経過したと思われる時間(0.6秒)待ってから実行
	// '#sel_svc'の場合は selectedSvcVal変数を更新
	// ＃ 呼び出し元Javascriptで $('#sel_XXXX').trigger('change'); を実装し忘れた場合でも 0.6秒待ちさえすれば表示される
	setTimeout(() => {

		if(document.querySelector('#sel_svc')){
			selectedSvcVal = $('#sel_svc').val();
		}
	}, 600);

	// 最新情報を読み込むチェックボックスの追加
	if(document.querySelector('#CheckLatest')){
		$('#CheckLatest').after(
			'<label><input type="checkbox" id="_check_nocache">最新の' + ($('#CheckLatest').data('whatinfo') || '') + '情報を読み込む</label>'
		);
	}

	// ツールオプションの初期化
	if(document.querySelector('.ToolOptions')){

		let region_mode = $('.ToolOptions').data('region');
		let region_show = (region_mode === 'no') ? false : true;
		let region_multi = (region_mode === 'multi');
		let hostfilter_show = ($('.ToolOptions').data('hostfilter') === 'no') ? false : true;

		if(region_show){
			const regionOpenBtnHtml = '<span id="tool_options_open_btn" class="defcol">[<span id="region_disp"></span><span style="font-size:0.6em;">▼</span>]</span>';
			if(document.querySelector('#region_disp_anchor')){
				$('#region_disp_anchor').html(regionOpenBtnHtml);
			}else{
				$('.ToolOptions').after(regionOpenBtnHtml);
			}
		}

		// ツールオプションの設定
		if(!document.querySelector('#ToolOptionBoxMain')){

			$('body').append(
				'<div id="ToolOptionBox" class="fadeInBox fadeInPre"><div class="red OptionBoxCloseBtn">×</div><div class="OptionBoxCloseBtn green" id="ToolOptionBoxApply">&#10004;</div>' +
				'<div id="ToolOptionBoxMain">' +
				(region_show ? '<label id="SelRegionsLabel"></label><br><br>' : '') +
				'</div></div>');
			$('#tool_options_open_btn').click(() => {
				if(region_multi) util.syncSelectedRegionCheckboxes();
				util.positionToolOptionBox();
				$('#ToolOptionBox').addClass('fadeIn');
			});

			$('#ToolOptionBoxApply').on('click', (event) => {   // チェックボタンで閉じる
				// リージョン変数の更新
				if(document.querySelector('#sel_regions')){
					if(region_multi){
						const selectedRegionIds = Array.from(document.querySelectorAll('.sel_regions_chk:checked')).map(v => v.value);
						if(selectedRegionIds.length === 0){
							alert('リージョンを1つ以上選択してください。');
							event.stopImmediatePropagation();
							return false;
						}
						util.updateSelectedRegions(selectedRegionIds);
					}else{
						util.updateRegionDisp( $('#sel_regions').prop('selectedIndex') );
					}
				}
			});
			$('.OptionBoxCloseBtn').on('click', () => {   // ×ボタンで閉じる
				$('#ToolOptionBox').removeClass('fadeIn');
			});

			// リージョンの選択UIを作成
			if(region_show){
				if(region_multi){
					$('#SelRegionsLabel').append('<span class="spLR">リージョン選択</span><div id="sel_regions"></div>');
					$.each(availableRegions, (i,d) => {
						$('#sel_regions').append('<label class="nowrap" style="display:block;margin:0 0 4px 0;"><input type="checkbox" class="sel_regions_chk" value="' + d['id'] + '"> ' + (d['name'] || d['id']) + '_' + d['location'] + ' (' + d['id'] + ')</label>');
					});
					util.syncSelectedRegionsDisp(false);
				}else{
					$('#SelRegionsLabel').append('<span class="spLR">リージョン選択</span><select id="sel_regions" class="sel_pad"></select>');
					$.each(regions, (i,d) => {
						$('#sel_regions').append('<option value="' + d['id'] + '">' + (d['name'] || d['id']) + '_' + d['location'] + " \t(" + d['id'] + ")");
					});
					$('#region_disp').html(regions[regionId]['location']);
				}
			}

			// Nameタグフィルターを作成
			if(hostfilter_show){
				if(document.querySelector('.HeaderControlBlock')){
					const tagnameFilterExampleOptions = [tagnameFilter].filter(v => v).map(v => '<option value="' + util.escapeHTML(v) + '">').join('');
					$('.HeaderControlBlock').prepend(
						'<span class="spR lightcol nowrap">Nameタグフィルター</span><input type="text" id="tagname_filter_textbox" list="tagname_filter_example">' +
						'<datalist id="tagname_filter_example">' + tagnameFilterExampleOptions + '</datalist>'
					);

					$('#tagname_filter_textbox').on('keyup change', () => {
						// Nameタグフィルタの更新
						util.updateTagnameFilter($('#tagname_filter_textbox').val(), {retry:true});
					});
				}
			}
		}
		const hFilter = document.getElementById('tagname_filter_textbox');
        if(hFilter) hFilter.value = tagnameFilter;
	}

	// インスタンスがメインで存在するリージョンをセット
	if(document.getElementById('region_disp')){
		if($('.ToolOptions').data('region') === 'multi'){
			util.syncSelectedRegionsDisp(false);
		}else{
			util.updateRegionDisp(regionId);
		}
	}

});


window.addEventListener('load', () => {

    Array.from(document.querySelectorAll('.LoadingAni')).map((x) => {
    	util.writeHtml(x, '<div class="loading-spin"></div>');
		x.style.display = 'none';
		x.style.margin = '10px';
    });
});
