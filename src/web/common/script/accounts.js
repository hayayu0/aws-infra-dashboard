'use strict';

const accounts = window.normalizeAccountConfigs(window.appConfig?.accounts);
const accountEntries = accounts.map((account, index) => [String(index), account]);
const requestedAccountIndex = new URLSearchParams(window.location.search).get('account');
const currentAccountIndex = (requestedAccountIndex && accounts[requestedAccountIndex]) ? requestedAccountIndex : (accounts[0] ? '0' : '');
const currentAccount = accounts[currentAccountIndex] || {};
const visibleAccountEntries = accountEntries.filter(([index, account]) => index === currentAccountIndex || !account.hideDropDown);
const accountLabel = (account, fallback = '') => account?.accountName || fallback;
const accountIndexByLabel = (label) => accountEntries.find(([index, account]) => accountLabel(account, index) === label)?.[0];
const requestedDisplayAccounts = (new URLSearchParams(window.location.search).get('accounts') || '')
	.split(',')
	.map(v => accountIndexByLabel(v.trim()))
	.filter(v => v && visibleAccountEntries.some(([index]) => index === v));
let selectedAccountIndexes = requestedDisplayAccounts.length > 0 ? [...new Set(requestedDisplayAccounts)] : visibleAccountEntries.map(([index]) => index);

const accountDisplayText = () => selectedAccountIndexes.map(index => accountLabel(accounts[index], index)).join(', ');
const syncSelectedAccountCheckboxes = () => {
	document.querySelectorAll('.sel_accounts_chk').forEach((checkbox) => {
		checkbox.checked = selectedAccountIndexes.includes(checkbox.value);
	});
}
const updateSelectedAccounts = (checkedAccountIndexes) => {
	selectedAccountIndexes = visibleAccountEntries.map(([index]) => index).filter(index => checkedAccountIndexes.includes(index));
	const disp = document.querySelector('#account_disp');
	if(disp) disp.innerText = accountDisplayText();
	const params = new URLSearchParams(location.search);
	params.set('accounts', selectedAccountIndexes.map(index => accountLabel(accounts[index], index)).join(','));
	history.replaceState('', '', location.pathname + '?' + params.toString().replace(/%2C/g, ',') + location.hash);
	if(typeof util !== 'undefined' && util.clickReloadTableButton) util.clickReloadTableButton(10);
}
window.getSelectedAccounts = () => selectedAccountIndexes.map(index => ({ index, account: accounts[index] })).filter(target => target.account);

window.addEventListener('pageshow', (event) => {
	if(!accounts[currentAccountIndex]) return;

	const iconContainer = document.querySelector('#TitleAccountIcon');
	if(iconContainer && currentAccount.icon){
		util.writeHtml(iconContainer, currentAccount.icon);
	}

	const accountAnchor = document.querySelector('#account_disp_anchor');
	if(accountAnchor){
		if(accounts.length <= 1){
			util.writeHtml(accountAnchor, '');
			$('#AccountOptionBox').remove();
			return;
		}

		util.writeHtml(accountAnchor, 'アカウント：[<span id="account_options_open_btn" class="defcol"><span id="account_disp"></span><span style="font-size:0.6em;">▼</span></span>]');
		document.querySelector('#account_disp').innerText = accountDisplayText();
		if(!document.querySelector('#AccountOptionBox')){
			$('body').append(
				'<div id="AccountOptionBox" class="fadeInBox fadeInPre"><div class="red AccountOptionBoxCloseBtn">×</div><div class="AccountOptionBoxCloseBtn green" id="AccountOptionBoxApply">&#10004;</div>' +
				'<div id="AccountOptionBoxMain"><label id="SelAccountsLabel"><span class="spLR">アカウント選択</span><div id="sel_accounts"></div></label></div></div>'
			);
			visibleAccountEntries.forEach(([index, account]) => {
				$('#sel_accounts').append('<label class="nowrap" style="display:block;margin:0 0 4px 0;"><input type="checkbox" class="sel_accounts_chk" value="' + index + '"> ' + accountLabel(account, index) + '</label>');
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
				const checkedAccountIndexes = Array.from(document.querySelectorAll('.sel_accounts_chk:checked')).map(v => v.value);
				if(checkedAccountIndexes.length === 0){
					alert('アカウントを1つ以上選択してください。');
					event.stopImmediatePropagation();
					return false;
				}
				updateSelectedAccounts(checkedAccountIndexes);
			});
			$('.AccountOptionBoxCloseBtn').on('click', () => {
				$('#AccountOptionBox').removeClass('fadeIn');
			});
		}
		return;
	}
});
