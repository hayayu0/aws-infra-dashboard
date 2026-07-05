
'use strict';

const acc = window.appConfig?.accounts || {};
const requestedAccNo = new URLSearchParams(window.location.search).get('account');
const accNo = (requestedAccNo && acc[requestedAccNo]) ? requestedAccNo : '1';
const accountDisplayOptions = Object.entries(acc).filter(([k, v]) => k === accNo || !v.hideDropDown);
const requestedDisplayAccounts = (new URLSearchParams(window.location.search).get('accounts') || '')
	.split(',')
	.map(v => v.trim())
	.filter(v => acc[v] && accountDisplayOptions.some(([k]) => k === v));
let selectedAccountIds = requestedDisplayAccounts.length > 0 ? [...new Set(requestedDisplayAccounts)] : accountDisplayOptions.map(([k]) => k);

if(!acc[accNo]){
	console.error(`Account config not found: ${accNo}`);
}


const jumptoOtherAccount = (toAccNo) => {

	const currentSearchParams = new URLSearchParams(location.search);
	currentSearchParams.set('account', toAccNo);
	location.href = location.pathname + '?' + currentSearchParams.toString().replace(/%2C/g, ',');
}

const accountDisplayText = () => selectedAccountIds.map(k => acc[k]?.selectAccountDisp || k).join(', ');
const syncSelectedAccountCheckboxes = () => {
	document.querySelectorAll('.sel_accounts_chk').forEach((checkbox) => {
		checkbox.checked = selectedAccountIds.includes(checkbox.value);
	});
}
const updateSelectedAccounts = (accountIds) => {
	selectedAccountIds = accountDisplayOptions.map(([k]) => k).filter(k => accountIds.includes(k));
	const disp = document.querySelector('#account_disp');
	if(disp) disp.innerText = accountDisplayText();
	const params = new URLSearchParams(location.search);
	params.set('accounts', selectedAccountIds.join(','));
	history.replaceState('', '', location.pathname + '?' + params.toString().replace(/%2C/g, ',') + location.hash);
	if(typeof util !== 'undefined' && util.clickReloadTableButton) util.clickReloadTableButton(10);
}
window.getSelectedAccountIds = () => selectedAccountIds.slice();


window.addEventListener('pageshow', (event) => {
	if(!acc[accNo]) return;

	const iconContainer = document.querySelector('#TitleAccountIcon');
	if(iconContainer && acc[accNo].icon){
		util.writeHtml(iconContainer, acc[accNo].icon);
	}

	const accountSelectHtml = (options, selectedValue, firstOptionHtml = '') => {
		const optionHtml = options.map(([k, v]) => `<option value="${k}"${k === selectedValue ? ' selected' : ''}>${v.selectAccountDisp}`).join('');
		return '<select id="SelectAccount" onChange="jumptoOtherAccount(this.value);">' + firstOptionHtml + optionHtml + '</select>';
	};

	const accountAnchor = document.querySelector('#account_disp_anchor');
	if(accountAnchor){
		util.writeHtml(accountAnchor, 'アカウント：[<span id="account_options_open_btn" class="defcol"><span id="account_disp"></span><span style="font-size:0.6em;">▼</span></span>]');
		document.querySelector('#account_disp').innerText = accountDisplayText();
		if(!document.querySelector('#AccountOptionBox')){
			$('body').append(
				'<div id="AccountOptionBox" class="fadeInBox fadeInPre"><div class="red AccountOptionBoxCloseBtn">×</div><div class="AccountOptionBoxCloseBtn green" id="AccountOptionBoxApply">&#10004;</div>' +
				'<div id="AccountOptionBoxMain"><label id="SelAccountsLabel"><span class="spLR">アカウント選択</span><div id="sel_accounts"></div></label></div></div>'
			);
			accountDisplayOptions.forEach(([k, v]) => {
				$('#sel_accounts').append('<label class="nowrap" style="display:block;margin:0 0 4px 0;"><input type="checkbox" class="sel_accounts_chk" value="' + k + '"> ' + (v.selectAccountDisp || k) + '</label>');
			});
			$('#account_options_open_btn').click(() => {
				syncSelectedAccountCheckboxes();
				const button = document.getElementById('account_options_open_btn');
				const box = document.getElementById('AccountOptionBox');
				if(button && box){
					const rect = button.getBoundingClientRect();
					box.style.top = (rect.bottom + 4) + 'px';
					box.style.left = Math.max(4, rect.left - box.offsetWidth + rect.width) + 'px';
				}
				$('#AccountOptionBox').addClass('fadeIn');
			});
			$('#AccountOptionBoxApply').on('click', (event) => {
				const accountIds = Array.from(document.querySelectorAll('.sel_accounts_chk:checked')).map(v => v.value);
				if(accountIds.length === 0){
					alert('アカウントを1つ以上選択してください。');
					event.stopImmediatePropagation();
					return false;
				}
				updateSelectedAccounts(accountIds);
			});
			$('.AccountOptionBoxCloseBtn').on('click', () => {
				$('#AccountOptionBox').removeClass('fadeIn');
			});
		}
		const titleLinkContainer = document.querySelector('#Other_Account_Link');
		if(titleLinkContainer) util.writeHtml(titleLinkContainer, '');
		return;
	}

	// アカウント切替のドロップダウンの表示
    const linkContainer = document.querySelector('#Other_Account_Link');
	if(linkContainer){
		if( new URLSearchParams(location.search).get(groupTagFilter.keyURL) === groupTagFilter.allValue || linkContainer.dataset.show === 'always'){
			const accountOptions = Object.entries(acc).filter(([k, v]) => k !== accNo && !v.hideDropDown);
			if(accountOptions.length === 0){
				util.writeHtml(linkContainer, '');
				return;
			}

			util.writeHtml(linkContainer, '' +
				'<div style="margin: 3px 0 0 3em">' +
				accountSelectHtml(accountOptions, '', '<option selected>-- アカウント切替 --') +
				'</div>');
		}
	}
});
