
'use strict';

const acc = window.appConfig?.accounts || {};
const requestedAccNo = new URLSearchParams(window.location.search).get('account');
const accNo = (requestedAccNo && acc[requestedAccNo]) ? requestedAccNo : '1';

if(!acc[accNo]){
	console.error(`Account config not found: ${accNo}`);
}


const jumptoOtherAccount = (toAccNo) => {

	const currentSearchParams = new URLSearchParams(location.search);
	currentSearchParams.set('account', toAccNo);
	location.href = location.pathname + '?' + currentSearchParams.toString().replace(/%2C/g, ',');
}


window.addEventListener('pageshow', (event) => {
	if(!acc[accNo]) return;

    const iconContainer = document.querySelector('#TitleAccountIcon');
	if(iconContainer && acc[accNo].icon){
		iconContainer.innerHTML = acc[accNo].icon;
	}

	// アカウント切替のドロップダウンの表示
    const linkContainer = document.querySelector('#Other_Account_Link');
	if(linkContainer){
		if( new URLSearchParams(location.search).get(groupTagFilter.keyURL) === groupTagFilter.allValue || linkContainer.dataset.show === 'always'){
			const accountOptions = Object.entries(acc).filter(([k, v]) => k !== accNo && !v.hideDropDown);
			if(accountOptions.length === 0){
				linkContainer.innerHTML = '';
				return;
			}

			// 個々の<option>を生成
			const optionHtml = accountOptions.map(([k, v]) => `<option value="${k}">${v.selectAccountDisp}`).join('');

			linkContainer.innerHTML = '' +
				'<div style="margin: 3px 0 0 3em">' +
				'<select id="SelectAccount" onChange="jumptoOtherAccount(this.value);">' +
				'<option selected>-- アカウント切替 --' +
				optionHtml +
				'</div>';
		}
	}
});