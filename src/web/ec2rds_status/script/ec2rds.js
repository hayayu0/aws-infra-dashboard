'use strict';

const mystat = {

	now: new Date(),
	svgIdPre: 'svg_',
	tableId: '#statTable', 
	rdsList: null,
	ec2LiteList:  null,
	pageLength: window.appConfig.defaultTablePageLength || 100,   // 1ページ当たりの表示件数の初期値
	ec2StartStopList: {},    // EC2起動停止JSON { region: { Nameタグ: { resourceId: { HHMM:state, latest:state } } } }
	rdsStartStopList: {},    // RDS起動停止JSON { region: { Nameタグ: { resourceId: { HHMM:state, latest:state } } } }
	cpuDataInterval: 5,  // CPU使用率のデータ間隔(CloudWatchの標準なので固定値)
	latestStatusLoadNum: 0,
	historyBarDrawWaitNum: -1,   // history.htmlの24時間バー描画待ち行数。対象無し(=-1)、行描画ごとに1ずつ減算して0で追加操作を有効化
	sem: { fullLoad: false, latestLoad: false, cpuLoad: false },   // 排他制御。true=該当処理中に新規処理を無視する
	fromPattern : [ 'index.html', 'history.html' ],   // index.htmlとhistory.htmlの共通Javascirptのためどちらのhtmlで読み込まれているかにより処理分岐させる
	preOlddayIndex: -1,   // 何日前を表示するかの選択肢 直前の選択の保持
	targetHistTagname: '',  // 対象Nameタグ(history.html用)
	daysAgo: -1,   // 描画対象の日付と今日との差。(=-1)で初期化。
	minutesPerDot: 2,   // 描画領域の1ドット幅が何minuteか (1 or 2)
	targetDate: null,   // 表示対象日(Dateオブジェクト)
	maxSlideMonth: 24,   // history.html の最大過去月
	maxAgo: 730,   // もっとも古いxx日前
	dispenv: 'all',   // 本番・開発・検証などの環境のいずれを表示するか
	rowsTop25Index: [],   // 表の先頭25行(スクロールバーが一番上の状態で見える範囲)の初期表示アニメーション対象
	targetInstanceId: '',   // history.html: 特定のインスタンスID
	monthSlide: 0,   // history.html: 前月・翌月ボタンが押された状態の位置
	firstHistDays: 14,   // history.htmlで何日前まで表示するかの最初の日数
	currentHistDays: 14,   // history.htmlでどこまで描画されたかの日数
	cpuDataAll: {},   // CPU使用率  データ構造は { 'yyyymmdd': { Nameタグ: { resourceId: [0,0,0,...] } } }
	orgRowId: {},   // 行更新用の行番号(ソート前のID)。index.htmlはresourceId、history.htmlはyyyymmddをキーにする
	ec2rdsStatData: {},
	vpcIdData: {},
	historyInstanceSvc: null, // history.htmlでURLパラメータsvcから指定されたサービスを記録する  null,EC2,RDS
	historyRegion: '', // history.htmlでURLパラメータregionから指定されたリージョン
	startstopHistData: {}, // history.htmlでCPU後追い描画時にstart/stop JSONを再取得しないための保持データ
	startstopEmptyFetches: [], // start/stop JSONを取得できたが中身が0件だったサービス/リージョン
	demoNow: new Date(2026, 6-1, 18, 23, 55, 0),

};

mystat.bar24hWH = { width: 60 * 24 / mystat.minutesPerDot, height: 16, cpu_height:12, cpu_top:2 };   // 起動状態の描画領域の大きさ
mystat.fromHtml = mystat.fromPattern[0];   // 'index.html', 'history.html' のどちらから呼ばれたか (このjavascriptをindex.htmlとhistory.htmlで共通化しているため処理の分岐に利用)

if(mystat.demoNow) mystat.now = mystat.demoNow;

let yyyy, mm, dd, strymd;   // 処理対象日  yyyy,mm,ddは数値、strymdはyyyymmddの8文字
let tbl = null;   // DataTable()の戻り値で受け取る DataTablesのAPIの操作に利用

// CPU使用率の色　起動はうす緑、停止は灰色、CPU使用率で色が変化 緑～黄色～赤～ピンク
const statColor = {
	on0: '#3f0', on1: '#6f0', on2: '#9e0', on3: '#bc1', on4: '#db1', on5: '#e92', on6: '#e72', on7: '#e53', on8: '#f22', on9: '#d1d',
	on:'#7db', off: 'gray', que: 'a0a0a0', nul: 'white', 
	full:'#d97', fullText:'red', impaired:'#938', impairedText:'#620', terminated:'#433', terminatedText:'#808080'
};
const statusLabel = {
	impaired: window.appConfig.labels.statusImpaired,
	terminated: window.appConfig.labels.statusTerminated
};
const tablePageLengthOptions = window.appConfig.tablePageLengthOptions || [25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000];
const tableSortOrder = window.appConfig.tableSortOrder || [[1, 'asc'], [0, 'asc']];
const statusCriticalText = { '2':['FULL', statColor.fullText], '3':[statusLabel.impaired, statColor.impairedText], '4':[statusLabel.terminated, statColor.terminatedText] };   // 24時間バー上に描画する特殊ステータスの文字

// jsonに含まれるIDとHTML色コードの対応
const colorId = { '0': statColor.off, '1': statColor.on, '2': statColor.full, '3': statColor.impaired, '4': statColor.terminated };

// テーブルの列
// キー名は識別用、no=列番号、visible=初期状態の表示/非表示 index.html用でありhistory.html用は列が異なるので後で上書きする
let tableCol = {
	_meta: { initcols:12 },
	tagname: { no:0, visible:true },
	region: { no:1, visible:true, checkbox:'リージョン' },
	env: { no:2, visible:true, checkbox:'環境' },
	ac: { no:3, visible:true, checkbox:groupTagFilter.key + 'タグ' },
	instancetype: { no:4, visible:true, checkbox:'インスタンスタイプ' },
	vpc: {no:5, visible:false, checkbox:'VPC' },
	az: {no:6, visible:false, checkbox:'AZ' },
	status: { no:7, visible:true },
	beginend: { no:8, visible:true },
	hh: {no:9, visible:false, checkbox:'起動時間' },
	maxcpu: { no:10, visible:true },
	bar24h: { no:11, visible:true }
};

// S3上の事前計算JSONの取得元
const urlToolRoot = window.appConfig.urlToolRoot;

// AIによる新設・整備 ここから
const ec2rdsRegionIds = () => regions.map(region => region.id).filter(v => v);
const ec2rdsRegionLocations = () => regions.map(region => region.location || region.id).filter(v => v).join(', ');
const currentRegionName = () => ec2rdsRegionIds()[0] || acc[accNo].regions?.[0] || regions[0]?.id || '';
const validRegionName = (regionName) => ec2rdsRegionIds().indexOf(regionName) >= 0 ? regionName : '';
const regionFromAz = (az) => (az || '').match(/^([a-z]{2}(?:-[a-z]+)+-\d)[a-z]$/i)?.[1] || '';
const startstopStateUrl = (ymd, svc, cacheSuffix = '', targetRegion = currentRegionName()) => {
	return urlToolRoot + acc[accNo].s3Dir.lambda + '/record-start-stop-time/' + targetRegion + '/' + ymd.slice(0,4) + '/' + ymd.slice(4,6) + '/' + ymd + '_' + svc + '_start_stop_time.json' + cacheSuffix;
};
const escapeNameForS3Key = (value) => {
	const safe = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
	const bytes = new TextEncoder().encode(String(value));
	let escaped = '';
	bytes.forEach((byte) => {
		const char = String.fromCharCode(byte);
		escaped += safe.indexOf(char) >= 0 ? char : '~' + byte.toString(16).toUpperCase().padStart(2, '0');
	});
	return escaped;
};
const cpuUtilUrl = (ymd, tagname, targetRegion = currentRegionName()) => {
	return urlToolRoot + acc[accNo].s3Dir.lambda + '/cpu-utilization/' + targetRegion + '/' + ymd.slice(0,4) + '/' + ymd.slice(4,6) + '/' + ymd.slice(6,8) + '/' + ymd + '_' + escapeNameForS3Key(tagname) + '.json?' + util.cacheParam(600, 't');
};
const extractBarAttr = (html, attrName) => {
	const regexp = new RegExp(attrName + "=[\"']([^\"']+)[\"']");
	const attrValue = (html || '').replace(regexp, '@$1@').split('@')[1] || '';
	const textarea = document.createElement('textarea');
	textarea.innerHTML = attrValue;
	return textarea.value;
};
const cpuDataForResource = (cpuDataGroup, resourceKey, targetRegion = '') => {
	if(targetRegion && Array.isArray(cpuDataGroup?.[targetRegion]?.[resourceKey])) return cpuDataGroup[targetRegion][resourceKey];
	if(ec2rdsRegionIds().some(region => cpuDataGroup?.[region])){
		for(const region of ec2rdsRegionIds()){
			if(Array.isArray(cpuDataGroup?.[region]?.[resourceKey])) return cpuDataGroup[region][resourceKey];
		}
	}
	if(Array.isArray(cpuDataGroup?.[resourceKey])) return cpuDataGroup[resourceKey];
	return null;
};
const cpuDataForResourceKeys = (cpuDataGroup, resourceKeys, targetRegion = '') => {
	const keys = Array.isArray(resourceKeys) ? resourceKeys : [resourceKeys];
	if(keys.length === 1) return cpuDataForResource(cpuDataGroup, keys[0], targetRegion);
	const arrays = keys.map(key => cpuDataForResource(cpuDataGroup, key, targetRegion)).filter(Array.isArray);
	if(arrays.length === 0) return null;
	const slotNum = 60 * 24 / mystat.cpuDataInterval;
	return Array(slotNum).fill('-').map((_, idx) => {
		const value = arrays.map(array => array[idx]).find(v => !isNaN(v));
		return value === undefined ? '-' : value;
	});
};
const markLocalStartstopData = (data) => {
	Object.defineProperty(data, '__localTimeKeys', { value:true, enumerable:false });
	return data;
};
const iterateStartstopRegions = (startstopDataList, targetRegion = '', callback, fallbackRegionName = currentRegionName()) => {
	(Array.isArray(startstopDataList) ? startstopDataList : [startstopDataList]).forEach((startstopData) => {
		if(!startstopData) return;
		if(targetRegion && startstopData[targetRegion]){
			callback(targetRegion, startstopData[targetRegion]);
			return;
		}
		const regionEntries = ec2rdsRegionIds().filter(region => startstopData[region]).map(region => [region, startstopData[region]]);
		if(regionEntries.length >= 1){
			regionEntries.forEach(([regionName, regionData]) => callback(regionName, regionData));
			return;
		}
		callback(fallbackRegionName, startstopData);
	});
};
const startstopDataForResource = (startstopDataList, tagNameKey, resourceKey, targetRegion = '') => {
	const mergeRestoredResources = (resourceEntries) => {
		if(resourceEntries.length < 2) return null;
		const hasTerminated = resourceEntries.some(([, resourceData]) => objectEntries(resourceData).some(([time, state]) => time !== 'latest' && String(state) === '4'));
		const hasRestored = resourceEntries.some(([, resourceData]) => resourceData['0000'] === undefined && objectEntries(resourceData).some(([time, state]) => time !== 'latest' && String(state) !== '0' && String(state) !== '4'));
		if(!hasTerminated || !hasRestored) return null;
		const merged = markLocalStartstopData({});
		resourceEntries.forEach(([, resourceData]) => {
			objectEntries(resourceData).forEach(([time, state]) => {
				if(time !== 'latest') merged[time] = state;
			});
		});
		const latestEntry = resourceEntries.map(([, resourceData]) => resourceData).reverse().find(resourceData => resourceData.latest !== undefined);
		if(latestEntry) merged.latest = latestEntry.latest;
		const resourceKeys = resourceEntries.map(([key]) => key);
		Object.defineProperty(merged, '__resourceKey', { value: resourceKeys[resourceKeys.length - 1], enumerable:false });
		Object.defineProperty(merged, '__resourceKeys', { value: resourceKeys, enumerable:false });
		return merged;
	};
	let foundData = null;
	iterateStartstopRegions(startstopDataList, targetRegion, (_regionName, startstopData) => {
		if(foundData) return;
		const resourceMap = startstopData?.[tagNameKey];
		const resourceEntries = objectEntries(resourceMap);
		const resolvedResourceKey = resourceMap?.[resourceKey] ? resourceKey : ((resourceKey === tagNameKey && resourceEntries.length === 1) ? resourceEntries[0][0] : '');
		const resourceData = resolvedResourceKey ? resourceMap[resolvedResourceKey] : null;
		if(resourceData){
			const copied = {...resourceData};
			Object.defineProperty(copied, '__resourceKey', { value: resolvedResourceKey, enumerable:false });
			Object.defineProperty(copied, '__resourceKeys', { value: [resolvedResourceKey], enumerable:false });
			if(resourceData.__localTimeKeys) markLocalStartstopData(copied);
			foundData = copied;
			return;
		}
		const mergedResourceData = (resourceKey === tagNameKey) ? mergeRestoredResources(resourceEntries) : null;
		if(mergedResourceData) foundData = mergedResourceData;
	});
	return foundData;
};
const startstopResourceExistsOnLocalDay = (resourceData) => {
	return Object.entries(resourceData || {}).some(([time, state]) => time !== 'latest' && String(state) !== '4');
};
const startstopResourceRefs = (startstopDataList) => {
	const refs = [];
	iterateStartstopRegions(startstopDataList, '', (regionName, startstopData) => {
		objectEntries(startstopData).forEach(([tagName, resourceMap]) => {
			objectEntries(resourceMap).forEach(([resourceKey]) => refs.push({ regionName, tagName, resourceKey }));
		});
	});
	return refs;
};
const countRawStartstopResources = (data) => objectEntries(data).reduce((sum, [, resourceMap]) => sum + objectEntries(resourceMap).length, 0);
const addRegionCount = (counts, regionName) => { if(regionName) counts[regionName] = (counts[regionName] || 0) + 1; };
const countDescribeResourcesByRegion = (svc) => {
	const counts = {};
	const list = (svc === 'ec2') ? mystat.ec2LiteList : mystat.rdsList;
	list.forEach(item => {
		const regionName = item.__region || (svc === 'ec2' ? regionFromAz(item.AZ || item?.Placement?.AvailabilityZone) : regionFromAz(item.AvailabilityZone));
		addRegionCount(counts, regionName);
	});
	return counts;
};
const dispStartstopLoadWarning = () => {
	$('.StartstopLoadWarning').remove();
	const targets = [];
	[
		{ svc:'ec2', label:'EC2', selected:isSelectedSvc('ec2'), startstop:mystat.ec2StartStopList },
		{ svc:'rds', label:'RDS', selected:isSelectedSvc('rds'), startstop:mystat.rdsStartStopList }
	].forEach(({ svc, label, selected, startstop }) => {
		if(!selected) return;
		const describeCounts = countDescribeResourcesByRegion(svc);
		mystat.startstopEmptyFetches.forEach(({ svc:emptySvc, regionName }) => {
			if(emptySvc === svc && (describeCounts[regionName] || 0) > 0) targets.push(label + '/' + regionName);
		});
	});
	if(targets.length === 0) return;
const message = window.appConfig.messages.startstopLoadPossiblyFailed;
	$('#dispDate').after('<div class="StartstopLoadWarning">' + util.escapeHTML(message) + '</div>');
};
const isEc2InstanceId = (instanceid) => /^i-[0-9a-f]+$/i.test(instanceid || '');

const tagEnvKey = window.appConfig.tagKeys.env;
const timezoneOffset = Number(window.appConfig.timezoneOffset);
const timezoneOffsetMinutes = Math.round(timezoneOffset * 60);
const cloudWatchTimezone = () => {
	const sign = timezoneOffsetMinutes >= 0 ? '+' : '-';
	const absMinutes = Math.abs(timezoneOffsetMinutes);
	return sign + ('0' + Math.floor(absMinutes / 60)).slice(-2) + ('0' + (absMinutes % 60)).slice(-2);
};
const dateString = (dt) => dt.toISOString().substring(0, 10);
const ymdToUtcDate = (ymd) => new Date(Date.UTC(parseInt(ymd.slice(0, 4)), parseInt(ymd.slice(4, 6)) - 1, parseInt(ymd.slice(6, 8))));
const dateToUtcYmd = (dt) => dt.getUTCFullYear() + ('0' + (dt.getUTCMonth() + 1)).slice(-2) + ('0' + dt.getUTCDate()).slice(-2);
const addDaysYmd = (ymd, days) => {
	const dt = ymdToUtcDate(ymd);
	dt.setUTCDate(dt.getUTCDate() + days);
	return dateToUtcYmd(dt);
};
const ymdStartAbsMinutes = (ymd) => Math.floor(ymdToUtcDate(ymd).getTime() / 60000);
const minutesToHHMM = (minutes) => {
	if(minutes >= 1440) return '2400';
	return ('0' + Math.floor(minutes / 60)).slice(-2) + ('0' + (minutes % 60)).slice(-2);
};
const cloudWatchDateRange = (year, monthIndex, date) => {
	const localStartUtc = new Date(Date.UTC(year, monthIndex, date) - timezoneOffsetMinutes * 60 * 1000);
	const localEndUtc = new Date(Date.UTC(year, monthIndex, date + 1) - timezoneOffsetMinutes * 60 * 1000 - 1000);
	return {
		titleDate: dateString(new Date(Date.UTC(year, monthIndex, date))),
		start: localStartUtc.toISOString(),
		end: localEndUtc.toISOString(),
		agoBase: localStartUtc
	};
};
const cloudWatchParam = (value) => encodeURIComponent(value);
const buildCloudWatchCpuUrl = (resourceId, tagname, graphYMD, period, graphWidth, graphHeight) => {
	const isEc2 = resourceId.indexOf('i-') === 0;
	const namespace = isEc2 ? 'EC2' : 'RDS';
	const dimensionName = isEc2 ? 'InstanceId' : 'DBInstanceIdentifier';
	const metricIdSuffix = isEc2 ? '%2C%7B%5C%22id%5C%22%3A%5C%22m1%5C%22%7D' : '';
	const widgetPrefix = '?api=cloudwatch:get_metric_widget_image&arg=%7b%22MetricWidget%22:%22%7B%5C%22metrics%5C%22%3A%5B%5B%5C%22AWS';
	const widgetSuffix = '%5C%22%2C%5C%22width%5C%22%3A' + graphWidth + '%2C%5C%22height%5C%22%3A' + graphHeight + '%7D%22%7d';
	return urlToolRoot + 'api/' + widgetPrefix +
		'%2F' + namespace + '%5C%22%2C%5C%22CPUUtilization%5C%22%2C%5C%22' + dimensionName + '%5C%22%2C%5C%22' +
		resourceId + '%5C%22' + metricIdSuffix + '%5D%5D%2C%5C%22view%5C%22%3A%5C%22timeSeries%5C%22%2C%5C%22stacked%5C%22%3Afalse%2C%5C%22stat%5C%22%3A%5C%22Average%5C%22%2C%5C%22period%5C%22%3A' + period + '%2C%5C' +
		'%22title%5C%22%3A%5C%22' + graphYMD.titleDate + '%20' + tagname + '%20CPU%20%25%5C%22%2C%5C%22yAxis%5C%22%3A%7B%5C%22left%5C%22%3A%7B%5C%22min%5C%22%3A0%2C%5C%22label%5C%22%3A%5C%22%5C%22%2C%5C%22showUnits%5C%22%3Afalse%2C%5C' +
		'%22max%5C%22%3A100%7D%7D%2C%5C%22legend%5C%22%3A%7B%5C%22position%5C%22%3A%5C%22hidden%5C%22%7D%2C%5C%22setPeriodToTimeRange%5C%22%3Atrue%2C%5C%22timezone%5C%22%3A%5C%22' + cloudWatchParam(cloudWatchTimezone()) + '%5C%22%2C' +
		'%5C%22start%5C%22%3A%5C%22' + cloudWatchParam(graphYMD.start) + '%5C%22%2C%5C%22end%5C%22%3A%5C%22' + cloudWatchParam(graphYMD.end) + widgetSuffix + '&' + util.cacheParam(180);
};
const emptyEc2List = () => [];
const emptyRdsDescribeDbInstances = () => ({ DBInstances: [] });
const tagListToObject = (tagList) => {
	if(Array.isArray(tagList)){
		return Object.fromEntries(tagList.map(tag => [tag.Key, tag.Value]));
	}
	return (tagList && typeof tagList === 'object') ? tagList : {};
};
const objectEntries = (value) => (value && typeof value === 'object' && !Array.isArray(value)) ? Object.entries(value) : [];
const apiFetchByRegion = (query, cacheSec, region) => util.cacheFetch(window.appConfig.urlToolRoot + 'api/?' + query + '&' + util.cacheParam(cacheSec) + '&region=' + encodeURIComponent(region.id));
const loadRegionFlatMap = (fetcher, mapper) => Promise.all(regions.map(fetcher)).then(results => results.flatMap(mapper));
const loadRegionMap = (fetcher) => Promise.all(regions.map(region => fetcher(region).then(data => [region.id, data]))).then(entries => Object.fromEntries(entries));
const loadLocalYmdEntries = (ymd, loader, merger) => Promise.all(
	startstopUtcYmdsForLocalYmd(ymd).map(utcYmd => loader(utcYmd).then(data => [utcYmd, data]))
).then(dateEntries => merger(ymd, dateEntries));
const storedDescribeYmdForLocalYmd = (localYmd) => {
	const dt = ymdToUtcDate(localYmd);
	dt.setUTCDate(dt.getUTCDate() + 1);
	dt.setUTCMinutes(dt.getUTCMinutes() - 1 - timezoneOffsetMinutes);
	return dateToUtcYmd(dt);
};
const storedDescribeUrlByStoredYmd = (storedYmd, svc, targetRegion) => {
	return urlToolRoot + acc[accNo].s3Dir.stored + '/' + targetRegion + '/' + storedYmd.slice(0, 4) + '/' + storedYmd.slice(4, 6) + '/' + svc + '-describe_' + (svc === 'ec2' ? 'instances' : 'db_instances') + '_' + storedYmd + '.json';
};
const storedDescribeUrl = (localYmd, svc, targetRegion) => storedDescribeUrlByStoredYmd(storedDescribeYmdForLocalYmd(localYmd), svc, targetRegion);
const useStoredDescribeForTargetDate = () => strymd && !isToday(strymd);
const normalizeStoredEc2DescribeInstances = (data) => (data.Reservations || [])
	.flatMap(reservation => reservation.Instances || [])
	.map(inst => ({
		...inst,
		Tags: tagListToObject(inst.Tags),
		AZ: inst.AZ || inst.Placement?.AvailabilityZone
	}));
const fetchStoredDescribe = (localYmd, svc, targetRegion) => util.cacheFetch(storedDescribeUrl(localYmd, svc, targetRegion))
	.catch(() => (svc === 'ec2' ? { Reservations: [] } : { DBInstances: [] }));
const fetchStoredDescribeByStoredYmd = (storedYmd, svc, targetRegion) => util.cacheFetch(storedDescribeUrlByStoredYmd(storedYmd, svc, targetRegion))
	.catch(() => (svc === 'ec2' ? { Reservations: [] } : { DBInstances: [] }));
const loadEc2InstancesForConfiguredRegions = () => loadRegionFlatMap(
	region => (useStoredDescribeForTargetDate() ? fetchStoredDescribe(strymd, 'ec2', region.id) : apiFetchByRegion('api=ec2:describe_instances&simpletag&flatten&select=InstanceId:Tags:Placement:InstanceType:VpcId', 60, region)).then(data => ({ regionId:region.id, data })),
	result => (useStoredDescribeForTargetDate() ? normalizeStoredEc2DescribeInstances(result.data) : (result.data.Instances || [])).map(inst => ({ ...inst, __region:result.regionId }))
);
const loadRdsInstancesForConfiguredRegions = () => loadRegionFlatMap(
	region => (useStoredDescribeForTargetDate() ? fetchStoredDescribe(strymd, 'rds', region.id) : apiFetchByRegion('api=rds:describe_db_instances&simpletag&select=DBInstanceIdentifier:TagList:AvailabilityZone:DBInstanceClass:DBSubnetGroup', 60, region)).then(data => ({ regionId:region.id, data })),
	result => (result.data.DBInstances || []).map(inst => ({ ...inst, __region:result.regionId }))
).then(DBInstances => ({ DBInstances }));
const loadVpcDataForConfiguredRegions = () => loadRegionFlatMap(
	region => apiFetchByRegion('api=ec2:describe_vpcs&select=Tags:VpcId', 3600, region),
	data => data.Vpcs || []
).then(Vpcs => ({ Vpcs }));
const loadStartstopForConfiguredRegions = (ymd, svc, cacheSuffix = '') => loadRegionMap(region => util.fetch(startstopStateUrl(ymd, svc, cacheSuffix, region.id)).then(data => {
	if(countRawStartstopResources(data) === 0) mystat.startstopEmptyFetches.push({ svc, regionName:region.id, ymd });
	return data;
}));
const startstopUtcYmdsForLocalYmd = (ymd) => {
	const windowStart = ymdStartAbsMinutes(ymd) - timezoneOffsetMinutes;
	const windowEnd = windowStart + 1440;
	const currentAbs = Math.floor(mystat.now.getTime() / 60000);
	const drawEnd = isToday(ymd) ? Math.min(Math.max(currentAbs, windowStart), windowEnd) : windowEnd;
	const firstUtcDay = Math.floor(windowStart / 1440);
	const lastUtcDay = Math.floor((Math.max(drawEnd, windowStart + 1) - 1) / 1440);
	const ymds = [];
	for(let utcDay = firstUtcDay; utcDay <= lastUtcDay; utcDay++){
		ymds.push(dateToUtcYmd(new Date(utcDay * 1440 * 60000)));
	}
	return ymds;
};
const mergeStartstopForLocalYmd = (localYmd, dateEntries) => {
	const result = {};
	const windowStart = ymdStartAbsMinutes(localYmd) - timezoneOffsetMinutes;
	const windowEnd = windowStart + 1440;
	const currentAbs = Math.floor(mystat.now.getTime() / 60000);
	const drawEnd = isToday(localYmd) ? Math.min(Math.max(currentAbs, windowStart), windowEnd) : windowEnd;
	const currentUtcYmd = dateToUtcYmd(mystat.now);
	const resources = new Map();

	dateEntries.forEach(([utcYmd, regionMap]) => {
		const utcDayStart = ymdStartAbsMinutes(utcYmd);
		objectEntries(regionMap).forEach(([region, tagMap]) => {
			objectEntries(tagMap).forEach(([tagName, resourceMap]) => {
				objectEntries(resourceMap).forEach(([resourceId, rawData]) => {
					const mapKey = region + '\t' + tagName + '\t' + resourceId;
					if(!resources.has(mapKey)){
						resources.set(mapKey, { region, tagName, resourceId, events:[] });
					}
					const events = resources.get(mapKey).events;
					objectEntries(rawData).forEach(([time, state]) => {
						if(time === 'latest') return;
						const minutes = hhmmToMinutes(time);
						if(minutes === null) return;
						events.push({ abs:utcDayStart + minutes, state });
					});
					if(rawData.latest !== undefined){
						const utcDayEnd = utcDayStart + 1440;
						const latestAbs = (utcYmd === currentUtcYmd && isToday(localYmd)) ? Math.min(currentAbs, utcDayEnd) : utcDayEnd;
						events.push({ abs:latestAbs, state:rawData.latest });
					}
				});
			});
		});
	});

	resources.forEach(({region, tagName, resourceId, events}) => {
		events.sort((a, b) => a.abs - b.abs);
		const localEvents = [];
		const stateAtStart = [...events].reverse().find(event => event.abs <= windowStart);
		if(stateAtStart) localEvents.push({ abs:windowStart, state:stateAtStart.state });
		events.forEach(event => {
			if(event.abs > windowStart && event.abs < drawEnd) localEvents.push(event);
		});
		const stateAtEnd = [...events].reverse().find(event => event.abs <= drawEnd);
		if(stateAtEnd && drawEnd > windowStart) localEvents.push({ abs:drawEnd, state:stateAtEnd.state });
		if(localEvents.length === 0) return;

		result[region] = result[region] || {};
		result[region][tagName] = result[region][tagName] || {};
		const outData = markLocalStartstopData({});
		localEvents.forEach(event => {
			const localMinutes = event.abs - windowStart;
			if(localMinutes < 0 || localMinutes > 1440) return;
			outData[minutesToHHMM(localMinutes)] = event.state;
		});
		result[region][tagName][resourceId] = outData;
	});

	return result;
};
const loadStartstopForLocalYmdConfiguredRegions = (ymd, svc, cacheSuffix = '') => loadLocalYmdEntries(ymd, utcYmd => loadStartstopForConfiguredRegions(utcYmd, svc, cacheSuffix), mergeStartstopForLocalYmd);
const loadCpuUtilForConfiguredRegions = (ymd, tagname) => loadRegionMap(region => util.fetch(cpuUtilUrl(ymd, tagname, region.id)));
const mergeCpuUtilForLocalYmd = (localYmd, dateEntries) => {
	const result = {};
	const windowStart = ymdStartAbsMinutes(localYmd) - timezoneOffsetMinutes;
	const slotNum = 60 * 24 / mystat.cpuDataInterval;

	dateEntries.forEach(([utcYmd, regionMap]) => {
		const utcDayStart = ymdStartAbsMinutes(utcYmd);
		objectEntries(regionMap).forEach(([region, cpuGroup]) => {
			objectEntries(cpuGroup).forEach(([resourceId, cpuArray]) => {
				if(!Array.isArray(cpuArray)) return;
				result[region] = result[region] || {};
				result[region][resourceId] = result[region][resourceId] || Array(slotNum).fill('-');
				cpuArray.forEach((value, idx) => {
					const localMinutes = utcDayStart + idx * mystat.cpuDataInterval - windowStart;
					if(localMinutes < 0 || localMinutes >= 1440) return;
					const localIdx = Math.floor(localMinutes / mystat.cpuDataInterval);
					if(localIdx >= 0 && localIdx < slotNum) result[region][resourceId][localIdx] = value;
				});
			});
		});
	});

	return result;
};
const loadCpuUtilForLocalYmdRegion = (ymd, tagname, targetRegion) => loadLocalYmdEntries(ymd, utcYmd => util.fetch(cpuUtilUrl(utcYmd, tagname, targetRegion)).then(data => ({ [targetRegion]: data })), mergeCpuUtilForLocalYmd);
const loadLatestEc2StatusForConfiguredRegions = () => loadRegionFlatMap(
	region => apiFetchByRegion('api=ec2:describe_instance_status&arg=%7b%22IncludeAllInstances%22:true%7d&select=InstanceId:InstanceState.Name:InstanceStatus.Status:SystemStatus.Status:AttachedEbsStatus.Status', 30, region),
	data => data.InstanceStatuses || []
);
const loadLatestRdsStatusForConfiguredRegions = () => loadRegionFlatMap(
	region => apiFetchByRegion('api=rds:describe_db_instances&select=DBInstanceIdentifier:DBInstanceStatus', 30, region),
	data => data.DBInstances || []
);
const isSelectedSvc = (svc) => selectedSvcVal.indexOf(svc + 'Y') !== -1 && (svc !== 'rds' || acc[accNo].instanceService.indexOf('RDS') >= 0);
const loadSelectedStartstopForLocalYmd = (svc) => isSelectedSvc(svc) ? loadStartstopForLocalYmdConfiguredRegions(strymd, svc, '?' + util.cacheParam(120, 't')) : Promise.resolve({});

// 指定のyyyymmddが今日かどうか
const isToday = (ymd) => ymd === '' + (mystat.now.getFullYear() * 10000 + (mystat.now.getMonth() + 1) * 100 + mystat.now.getDate());
const hhmmToMinutes = (hhmm) => {
	const text = String(hhmm);
	if(text === '2400') return 1440;
	if(!/^[0-9]{4}$/.test(text)) return null;
	const hours = parseInt(text.slice(0, 2));
	const minutes = parseInt(text.slice(2, 4));
	if(hours > 23 || minutes > 59) return null;
	return hours * 60 + minutes;
};
const utcHHMMToDisplayMinutes = (hhmm) => {
	const minutes = hhmmToMinutes(hhmm);
	if(minutes === null) return null;
	if(minutes === 1440) return 1440;
	return (minutes + timezoneOffsetMinutes + 1440) % 1440;
};
const currentDisplayMinutes = () => mystat.now.getHours() * 60 + mystat.now.getMinutes();
const startstopDisplayEntries = (strymd, data, opt = {}) => {
	const entries = [];
	Object.entries(data || {}).forEach(([time, state]) => {
		let minutes = null;
		if(time === 'latest'){
			if(!opt.includeLatest) return;
			minutes = isToday(strymd) ? currentDisplayMinutes() : 1440;
		}else if(data.__localTimeKeys){
			minutes = hhmmToMinutes(time);
		}else{
			minutes = utcHHMMToDisplayMinutes(time);
		}
		if(minutes === null) return;
		entries.push({ time, state, minutes });
	});
	return entries.sort((a, b) => a.minutes - b.minutes);
};
const startstopTerminatedStoredYmd = (strymd, data) => {
	const entries = startstopDisplayEntries(strymd, data, { includeLatest: true });
	const terminated = entries.filter((v, i) => String(v.state) === '4' && (i === 0 ? v.minutes > 0 : String(entries[i - 1].state) !== '4')).pop();
	return terminated ? dateToUtcYmd(new Date((ymdStartAbsMinutes(strymd) - timezoneOffsetMinutes + terminated.minutes) * 60000)) : '';
};
// AIによる新設・整備 ここまで

// -------------------------------------------------------------
// 読み込んだファイルからdataTablesに読み込ませるDataSetを生成
// -------------------------------------------------------------
const createDataset = () => {

	let dataset = [];

	// サーバ情報の列の範囲を'-'で初期化
	const dataInitial = Array(tableCol._meta.initcols).fill('-');
	const displayedResources = new Set();
	const resourceDisplayKey = (svc, regionName, resourceKey) => svc + '\t' + regionName + '\t' + resourceKey;
	const historyLinkHtml = (svc, tagName, regionName) => '<span class="b disp-keyname">' + util.escapeHTML(tagName) + '</span><a href="./' + mystat.fromPattern[1] + '?account=' + accNo + '&svc=' + svc + '&region=' + encodeURIComponent(regionName) + '&name=' + encodeURIComponent(tagName) + '&cpuutil=' + ($('#chk_cpu_util').prop('checked') ? '1' : '0') + '" target="_blank"><img src="../common_script/images/historylink.png" style="padding-left:4px" alt="履歴"></a>';
	const bar24hHtml = (tagName, resourceKey, regionName, startstopKey = resourceKey) => '<div class="bar24h_wrap" data-instanceid="' + resourceKey + '" data-startstopkey="' + util.escapeHTML(startstopKey) + '" data-tagname="' + util.escapeHTML(tagName) + '" data-region="' + regionName + '"><img class="spanLink cpu_graph_btns" src="../common_script/images/graphicon.png" width="11" height="11"><svg id="' + mystat.svgIdPre + resourceKey + '" viewBox="0 0 ' + mystat.bar24hWH.width + ' ' + mystat.bar24hWH.height + '"></svg></div><div class="cpu_graph_wrap"></div>';
	const setResourceRow = (row, svc, tagName, resourceKey, tagEnv, groupTagValue, instanceType, regionName, vpcName, az, startstopKey = resourceKey) => {
		row[tableCol.tagname.no] = historyLinkHtml(svc, tagName, regionName);
		row[tableCol.env.no] = util.envToDisplayEnv(tagEnv, '-');
		row[tableCol.ac.no] = groupTagValue;
		row[tableCol.instancetype.no] = instanceType;
		row[tableCol.region.no] = regionName;
		row[tableCol.vpc.no] = vpcName;
		row[tableCol.az.no] = az;
		row[tableCol.maxcpu.no] = '-';
		row[tableCol.beginend.no] = '<div class="bar24Cell loading-spin-mini"></div>';
		row[tableCol.bar24h.no] = bar24hHtml(tagName, resourceKey, regionName, startstopKey);
	};
	const ec2ById = new Map(mystat.ec2LiteList.map(ec2 => [ec2.InstanceId, ec2]));
	const rdsById = new Map(mystat.rdsList.map(rds => [rds.DBInstanceIdentifier, rds]));

	const appendStartstopRows = (svc, startstopDataList) => {
		startstopResourceRefs(startstopDataList).forEach(({ regionName, tagName, resourceKey }) => {
			const restoredResourceData = startstopDataForResource(startstopDataList, tagName, tagName, regionName);
			const restoredResourceKeys = restoredResourceData?.__resourceKeys || [];
			const isRestoredGroup = restoredResourceKeys.length > 1;
			const displayResourceKey = isRestoredGroup ? restoredResourceKeys[restoredResourceKeys.length - 1] : resourceKey;
			const startstopKey = isRestoredGroup ? tagName : resourceKey;
			if(isRestoredGroup && resourceKey !== displayResourceKey) return true;   // continue

			const displayKey = resourceDisplayKey(svc, regionName, displayResourceKey);
			if(displayedResources.has(displayKey)) return true;   // continue

			const resourceData = isRestoredGroup ? restoredResourceData : startstopDataForResource(startstopDataList, tagName, resourceKey, regionName);
			if(!startstopResourceExistsOnLocalDay(resourceData)) return true;   // continue

			displayedResources.add(displayKey);

			if(tagName && !util.dispFilterTagname(tagName)) return true;   // continue
			if(regionName && ec2rdsRegionIds().indexOf(regionName) === -1) return true;   // continue

			const row = Array(tableCol._meta.initcols).fill('-');
			let groupTagValue = '-', tagEnv = '-', instanceType = '-', vpcName = '?', az = '-';

			if(svc === 'ec2'){
				const ec2 = ec2ById.get(displayResourceKey);
				const tags = ec2?.Tags || {};
				groupTagValue = tags[groupTagFilter.key] || '-';
				tagEnv = tags[tagEnvKey] || '-';
				instanceType = ec2?.InstanceType || '-';
				az = ec2?.AZ || ec2?.Placement?.AvailabilityZone || '-';
				vpcName = mystat.vpcIdData[ec2?.VpcId] || '?';
			}else if(svc === 'rds'){
				const rds = rdsById.get(displayResourceKey);
				const tags = { [groupTagFilter.key]: '-', ...tagListToObject(rds?.TagList) };
				groupTagValue = tags[groupTagFilter.key] || '-';
				tagEnv = tags[tagEnvKey] || '-';
				instanceType = rds?.DBInstanceClass || '-';
				az = rds?.AvailabilityZone || '-';
				vpcName = mystat.vpcIdData[rds?.DBSubnetGroup?.VpcId] || '?';
			}

			if( !dispFilter({env:tagEnv, ac:groupTagValue, tagname:tagName, region:regionName}) ){
				return true;   // continue
			}

			setResourceRow(row, svc, tagName, displayResourceKey, tagEnv, groupTagValue, instanceType, regionName, vpcName, az, startstopKey);

			dataset.push(row);
		});
	};

	appendStartstopRows('ec2', mystat.ec2StartStopList);
	appendStartstopRows('rds', mystat.rdsStartStopList);

	return dataset;
}


// -------------------------------------------------------------
// 表示前のフィルター
// 戻り値：true=表示OK, false=表示NG
// -------------------------------------------------------------
const dispFilter = (filterobj) => {

	// 環境フィルタ: sel_env の値で判定
	//   '*' 始まり = 全件表示
	//   それ以外 = タグ値を environmentList で文字キーに逆引きし、その文字が選択値に含まれるか
	const envSel = mystat.dispenv || '*';
	const envList = window.appConfig.environmentList;
	let dispok;
	if(envSel.indexOf('*') === 0){
		dispok = true;
	}else{
		const letter = Object.keys(envList).find(k => envList[k].tagEnv === filterobj['env']);
		dispok = letter ? envSel.includes(letter) : false;
	}
	if(!dispok) return false;

	// グループタグフィルタ
	if(groupTagFilter.value && filterobj['ac'] && !util.IsGroupTagFilterOk(filterobj['ac'])) return false;

	// Nameタグフィルタ
	if(filterobj.tagname && !util.dispFilterTagname(filterobj.tagname)) return false;

	// リージョンフィルタ
	if(filterobj.region && ec2rdsRegionIds().indexOf(filterobj.region) === -1) return false;

	return true;
}


// -------------------------------------------------------------
// 表のヘッダーを作成・更新  index.html用
// -------------------------------------------------------------
const ec2rdsCreateTableHeader = (tblname) => {

	document.querySelector(tblname).appendChild( document.createElement('thead') );

	let theadstr = '<tr>';

	if(mystat.fromHtml === mystat.fromPattern[0]){
		theadstr += '<th rowspan="2" class="padLR" style="padding:12px 0">Nameタグ</th>';
		theadstr += '<th rowspan="2">リージョン</th>';
		theadstr += '<th rowspan="2">環境</th>';
		theadstr += '<th rowspan="2">' + groupTagFilter.key + 'タグ</th>';
		theadstr += '<th rowspan="2" class="padLR">InstanceType</th>';
		theadstr += '<th rowspan="2">VPC</th>';
		theadstr += '<th rowspan="2">AZ</th>';
		theadstr += '<th><span class="btn_on_tr spanLink hovUL" id="link-getlatest">取得</span></th>';
		theadstr += '<th rowspan="2">起動～終了</th>';
		theadstr += '<th rowspan="2">起動時間</th>';
		theadstr += '<th rowspan="2">最大<br>CPU%</th>';
		theadstr += '<th><span id="disp_minutesPerDot"></span><span class="btn_on_tr spanLink hovUL" id="btn_minutesPerDot">変更</span></th>';
		theadstr += '</tr><tr class="padLRsml">';
		theadstr += '<th><span id="status_datetime">稼働状況</span></th>';
		theadstr += '<th id="thBar24h">起動／停止（0:00～24:00)</th>';
	}else{
		theadstr += '<th>日付</th>';
		theadstr += '<th>何日前か</th>';
		theadstr += '<th>起動～終了</th>';
		theadstr += '<th>起動時間</th>';
		theadstr += '<th>最大CPU%</span></th>';
		theadstr += '<th>平均CPU</span></th>';
		theadstr += '<th id="thBar24h">起動／停止（0:00～24:00)</th>';
	}
	// 作成
	document.querySelector(tblname + ' thead').innerHTML = theadstr;
}


// -------------------------------------------------------------
// 最新のステータスを取得
// -------------------------------------------------------------
const getLatestStatus = (evt) => {

	if(mystat.sem.fullLoad || mystat.sem.latestLoad) return;

	if(tbl.rows()[0].length === 0) return;

	mystat.sem.latestLoad = true;

	mystat.latestStatusLoadNum = 0;
	mystat.ec2rdsStatData = [];

	document.getElementById('link-getlatest').innerHTML = '<div class="loading-spin-mini" style="margin:0 20px"></div>';   // 処理中と分かるように表示を変更

	if(selectedSvcVal.indexOf('ec2Y') !== -1){
		loadLatestEc2StatusForConfiguredRegions()
	  	.then((data) => {
			mystat.ec2rdsStatData = mystat.ec2rdsStatData.concat(data);
			mystat.latestStatusLoadNum += 1;
			getLatestStatusOk({});
		})
		.catch(() => { getLatestStatusNg(); });
	}else{
		mystat.latestStatusLoadNum += 1;
	}

	if(selectedSvcVal.indexOf('rdsY') !== -1 && acc[accNo].instanceService.indexOf('RDS') >= 0){
		loadLatestRdsStatusForConfiguredRegions()
	  	.then((data) => {
			mystat.ec2rdsStatData = mystat.ec2rdsStatData.concat(data);
			mystat.latestStatusLoadNum += 2;
			getLatestStatusOk({});
		})
		.catch(() => { getLatestStatusNg(); });
	}else{
		mystat.latestStatusLoadNum += 2;
	}

}


// -------------------------------------------------------------
// 最新のステータスの取得成功
// -------------------------------------------------------------
const getLatestStatusOk = () => {

	mystat.now = mystat.demoNow || new Date();

	// EC2とRDSの両方の処理が終わる必要がある
	if(mystat.latestStatusLoadNum < 3) return;

	for(let n=0; n<tbl.rows()[0].length; n++)
	{
		let statClass = 'statusCellStop';
		const instanceid = tbl.cell(n, tableCol.bar24h.no).data().replace(/data-instanceid=[\"\']([0-9A-Za-z_\-\.]+)[\"\']/, '@$1@').split('@')[1];
		if(!instanceid) continue;

		let fnd = mystat.ec2rdsStatData.filter((v) => {
			if(v.InstanceId === instanceid || v.DBInstanceIdentifier === instanceid) return true;
		});

		if(!fnd || !fnd[0]) continue;

		if(instanceid.indexOf('i-') === 0){

			// EC2
			let additionalStatus = '';

			if(fnd[0]['InstanceState.Name'] === 'running'){
				statClass = 'statusCellRun';
				// 2/2ステータス、3/3ステータス以外の場合にステータス表示 ただしOS起動直後なら表示しない
				if(!isJustStartup(n)){

					let bunbo = 3, bunshi = 0;
					if(!fnd[0]['AttachedEbsStatus.Status']){
						bunbo = 2;
					}else{
						if(fnd[0]['AttachedEbsStatus.Status'] === 'ok') bunshi += 1;
					}
					if(fnd[0]['InstanceStatus.Status'] === 'ok') bunshi += 1;
					if(fnd[0]['SystemStatus.Status'] === 'ok') bunshi += 1;
					if(bunbo !== bunshi){
						additionalStatus = '<br><span class="blink-err">(' + bunshi +'/' + bunbo + ' status)</span>';
					}
				}
			}
			tbl.cell(n, tableCol.status.no).data( '<span class="' + statClass + '">' + fnd[0]['InstanceState.Name'] + '</span>' + additionalStatus );

		}else{

			// RDS
			if(fnd[0]['DBInstanceStatus'].search(/(available|storage\-optimization|backing\-up)/) !== -1){   // 稼働ステータス
				statClass = 'statusCellRun';
			}
			else if(fnd[0]['DBInstanceStatus'].search(/(storage\-full|failed|incompatible\-.*)/) !== -1){   // 致命的ステータス
				statClass = 'b blink-err';
			}

			tbl.cell(n, tableCol.status.no).data( '<span class="' + statClass + '">' + fnd[0]['DBInstanceStatus'] + '</span>' );
		}
	}

	// 取得日時を表示
	document.getElementById('status_datetime').innerHTML = (mystat.now.getMonth()+1) + '/' + mystat.now.getDate() + ' ' + ('0'+ mystat.now.getHours()).slice(-2) + ':' + ('0'+mystat.now.getMinutes()).slice(-2);   // 現在日時

	document.getElementById('link-getlatest').innerText = '状況更新';   // リンク文字を Loading からリセット

	util.drawDarkMode();

	mystat.sem.latestLoad = false;
}


// -------------------------------------------------------------
// 最新のステータスの取得失敗
// -------------------------------------------------------------
const getLatestStatusNg = () => {

	// ステータスをクリア
	if(tbl && tbl.rows()[0]){
		for(let i=0; i<tbl.rows()[0].length; i++){
			tbl.cell(i, tableCol.status.no).data('-');   // '-'が描画される
		}
	}

	mystat.sem.latestLoad = false;
}


// -------------------------------------------------------------
// OS起動直後から10分以内かどうか
// n：表の行番号
// -------------------------------------------------------------
const isJustStartup = (n) => {

	const matched = (tbl.cell(n, tableCol.beginend.no).data() || '').match(/[0-9][0-9]\:[0-9][0-9]～$/);

	if(matched && matched[0] && Math.abs(mystat.now.getHours()*60+mystat.now.getMinutes() - ((matched[0].slice(0, 2) * 60) + (matched[0].slice(3, 5) * 1)) <= 10)){
		return true;
	}
	return false;
}


// -------------------------------------------------------------
// テーブルと各種コントロールを表示 index.html用
// -------------------------------------------------------------
const drawPageMain = () => {

	let dateAgo = -1;   // dateAgo: 今日との差(0=今日,1=昨日。-1は前回に合わせる)
	let opt = { first: false };
	let olddayIndex = $('#sel_oldday_block > select').prop('selectedIndex');

	if(olddayIndex !== mystat.preOlddayIndex){
		dateAgo = olddayIndex;
	}

	if(mystat.preOlddayIndex == -1) opt.first = true;

	if(mystat.sem.fullLoad){
		return;
	}
	mystat.sem.fullLoad = true;

	// 保存
	util.saveControlToLocalStorage([], ['chk_cpu_util']);

	if( !mystat.demoNow && mystat.now.getDate() !== (new Date()).getDate()){   // 画面表示後に日付が変わった
		// エラー表示
		$('.LoadingAni').css('display', 'none').after('<br><span class="LoadingText LoadingErr">日付が変わりました。ページを再読み込みしてください。</span><br>');
		mystat.sem.fullLoad = false;
		return;
	}

	mystat.now = mystat.demoNow || new Date();

	if(dateAgo != null && !isNaN(dateAgo) && dateAgo >= 0){
		mystat.targetDate = new Date(mystat.now.getFullYear(), mystat.now.getMonth(), mystat.now.getDate() - dateAgo);
		yyyy = mystat.targetDate.getFullYear();
		mm = mystat.targetDate.getMonth() + 1;
		dd = mystat.targetDate.getDate();
		strymd = '' + (yyyy * 10000 + mm * 100 + dd);
	}
	else if(dateAgo != -1){
		yyyy = mystat.now.getFullYear();
		mm = mystat.now.getMonth() + 1;
		dd = mystat.now.getDate();
		strymd = '' + (yyyy * 10000 + mm * 100 + dd);
	}

	document.getElementById('dispDate').innerHTML = '[' + yyyy + '/' + mm + '/' + dd + ' ' + util.getYoubiWithColor(mystat.targetDate) + ']';

	mystat.dispenv = $('#sel_env').val();

	// URL書き換え
	let url_date = (dateAgo === 0) ? 'today' : (dateAgo === 1) ? 'yesterday' : strymd;
	util.replaceAddressBarURL([
		[ 'date', url_date, false],
		[ 'region', util.getSelectedRegionIds().join(','), false],
		[ 'svcIdx', $('#sel_svc').prop('selectedIndex'), false],
		[ 'envIdx', $('#sel_env').prop('selectedIndex'), false]
	], false, { searchtable: mystat.tableId });

	if(tbl){
		tbl.clear();
		tbl.destroy();
		tbl = null;
	}
	mystat.preOlddayIndex = olddayIndex;
	mystat.rowsTop25Index = [];
	mystat.startstopEmptyFetches = [];

	document.querySelector(mystat.tableId).style.visibility = 'hidden';

	$('.LoadingAni').css('display', 'block');
	$('.LoadingErr').remove();
	$('.StartstopLoadWarning').remove();

	let ec2LitePromise = isSelectedSvc('ec2') ? loadEc2InstancesForConfiguredRegions() : emptyEc2List();   // EC2か、両方(EC2+RDS)
	let rdsPromise = isSelectedSvc('rds') ? loadRdsInstancesForConfiguredRegions() : emptyRdsDescribeDbInstances();   // RDSか、両方(EC2+RDS)
	let ec2StartStopPromise = loadSelectedStartstopForLocalYmd('ec2');
	let rdsStartStopPromise = loadSelectedStartstopForLocalYmd('rds');

	Promise.all([
		ec2LitePromise,
		rdsPromise,
		loadVpcDataForConfiguredRegions(),
		ec2StartStopPromise,
		rdsStartStopPromise
  	])
  	.then((data) => {

		mystat.ec2LiteList = Array.isArray(data[0]) ? data[0] : [];
		mystat.rdsList = data[1]['DBInstances'] || [];
		mystat.ec2StartStopList = data[3] || {};
		mystat.rdsStartStopList = data[4] || {};

		if(!data[2]['Vpcs']){
			throw new Error('describe_vpcs APIのデータ取得に失敗');
		}
		
		// vpcIdとVPC名の辞書を生成 (先頭の「vpc.」は取り除く）
		data[2]['Vpcs'].forEach((vpcv, vpci) => {
			const tags = tagListToObject(vpcv.Tags);
			mystat.vpcIdData[ vpcv.VpcId ] = (tags.Name || vpcv.VpcId || '').replace(/^vpc\./, '');
		});

		// インスタンスを表示（この時点では、稼働状況の列と24時間のバ－は表示されない）
		dispStartstopLoadWarning();
		ec2rdsJsonLoadOk();
	})
	.catch(
		(e) => {
			document.querySelector('.LoadingAni').style.display = 'none';
			let p = document.createElement('p');
			p.innerText = e.toString();
			p.className = 'LoadingText LoadingErr';
			document.querySelector('.LoadingAni').after(p);
			mystat.sem.fullLoad = false;
		}
	);
}


// -------------------------------------------------------------
// テーブル作成・更新完了時のカスタム処理
// -------------------------------------------------------------
const loadCompleteFunc = () => {

	document.querySelector('.LoadingAni').style.display = 'none';

	document.querySelector(mystat.tableId).style.visibility = 'visible';

	mystat.sem.fullLoad = false;

	// 分幅を表示
	document.querySelector('#disp_minutesPerDot').innerText = '　' + mystat.minutesPerDot + '分/ドット ';

	// 起動・停止のバーの表示
	updateBar24hAndTimeCellAll();

	if($('#chk_latest_stat').prop('checked')){
		getLatestStatus();   // 最新ステータスの取得
	}
}


// -------------------------------------------------------------
// tblオブジェクトが利用可能になるまで待つ  history.html用
// DataTableのinitCompleteではまだオブジェクトが利用可能にならないためにsetIntervalで対応
// opt.start, opt.end: 処理開始行、終了行
// -------------------------------------------------------------
const loadCompleteHistFunc = (opt, tagname) => {

	const optStart = opt?.start || 0;
	const optEnd = opt?.end || mystat.currentHistDays;
	const optCpuOnly = opt?.cpuOnly || false;
	const startstopUtcFetchCache = new Map();
	const cpuUtcFetchCache = new Map();
	const historyTargetRegion = validRegionName(mystat.historyRegion);
	const historyRequestedInstanceId = mystat.targetInstanceId;
	let historyTerminatedInfoYmd = '';
	const historyComputerName = computerInfoDisplayName(historyRequestedInstanceId, mystat.targetHistTagname);
	const historyComputerInfo = { resolved:false, promises:[] };
	const queueHistoryComputerInfo = (svc, instanceid, tagname, opt = {}) => {
		if(!historyTargetRegion) return Promise.resolve(false);
		const targetYmd = opt.targetYmd || '';
		const promise = findComputerInfo(svc, instanceid, tagname, { ...opt, regionName:historyTargetRegion }).then(result => {
			if(result.inst && !historyComputerInfo.resolved && (!targetYmd || historyTerminatedInfoYmd === targetYmd)){
				historyComputerInfo.resolved = true;
				renderComputerInfo(result.inst, historyComputerName, { tagConv: result.tagConv });
				return true;
			}
			return false;
		});
		historyComputerInfo.promises.push(promise);
		return promise;
	};
	const finishHistoryComputerInfo = () => Promise.all(historyComputerInfo.promises).then(() => {
		if(!historyComputerInfo.resolved) renderComputerInfo({}, historyComputerName);
	});
	const loadHistoryStartstopForLocalYmd = (ymd, svc) => Promise.all(
		(!historyTargetRegion ? [] :
		startstopUtcYmdsForLocalYmd(ymd).map((utcYmd) => {
			const cacheKey = svc + '\t' + historyTargetRegion + '\t' + utcYmd;
			if(!startstopUtcFetchCache.has(cacheKey)){
				startstopUtcFetchCache.set(cacheKey, util.fetch(startstopStateUrl(utcYmd, svc, '?' + util.cacheParam(120, 't'), historyTargetRegion)).then(data => [utcYmd, { [historyTargetRegion]: data }]));
			}
			return startstopUtcFetchCache.get(cacheKey);
		}))
	).then(dateEntries => mergeStartstopForLocalYmd(ymd, dateEntries));
	const loadHistoryCpuForLocalYmd = (ymd, tagname) => Promise.all(
		(!historyTargetRegion ? [] :
		startstopUtcYmdsForLocalYmd(ymd).map((utcYmd) => {
			const cacheKey = tagname + '\t' + historyTargetRegion + '\t' + utcYmd;
			if(!cpuUtcFetchCache.has(cacheKey)){
				cpuUtcFetchCache.set(cacheKey, util.fetch(cpuUtilUrl(utcYmd, tagname, historyTargetRegion)).then(data => [utcYmd, { [historyTargetRegion]: data }]));
			}
			return cpuUtcFetchCache.get(cacheKey);
		}))
	).then(dateEntries => mergeCpuUtilForLocalYmd(ymd, dateEntries));

	mystat.historyBarDrawWaitNum = optEnd - optStart;

	mystat.now = mystat.demoNow || new Date();

	if(!optCpuOnly){
		if(mystat.historyInstanceSvc === "EC2"){
			queueHistoryComputerInfo('ec2', historyRequestedInstanceId, mystat.targetHistTagname);
		}else if(mystat.historyInstanceSvc === "RDS"){
			queueHistoryComputerInfo('rds', historyRequestedInstanceId, mystat.targetHistTagname);
		}else if(isEc2InstanceId(historyRequestedInstanceId)){
			queueHistoryComputerInfo('ec2', historyRequestedInstanceId, mystat.targetHistTagname);
		}else if(historyRequestedInstanceId){
			queueHistoryComputerInfo('rds', historyRequestedInstanceId, mystat.targetHistTagname);
		}else{
			queueHistoryComputerInfo('ec2', '', mystat.targetHistTagname, { fallbackRds: true });
		}
	}

	// 表示対象行の行ごとに処理
	for(let n=optStart; n<optEnd; n++){

		mystat.targetDate = new Date(mystat.now.getFullYear(), mystat.now.getMonth() - mystat.monthSlide, mystat.now.getDate() - n);
		yyyy = mystat.targetDate.getFullYear();
		mm = mystat.targetDate.getMonth() + 1;
		dd = mystat.targetDate.getDate();
		strymd = '' + (yyyy * 10000 + mm * 100 + dd);
		const t_strymd = strymd;   // スコープ内の変数へコピー(外側で変わる影響を回避するため)
		let _n = n;

		mystat.orgRowId[ strymd ] = n;

		mystat.rowsTop25Index = [...Array(25)].map((v, i) => i);

		setTimeout(() => {

			const t2_strymd = t_strymd;   // スコープ内の変数へコピー2段階目(外側で変わる影響を回避するため)

			const keyTagname = tagname;
			const resourceKey = keyTagname;
			const histDataKey = resourceKey + '\t' + t2_strymd;

			const loadHistoryStartstopData = () => {
				if(optCpuOnly && mystat.startstopHistData[histDataKey]){
					return Promise.resolve(mystat.startstopHistData[histDataKey]);
				}

				let startstopPromises = [];

				if(mystat.historyInstanceSvc === "EC2") {
					startstopPromises.push(loadHistoryStartstopForLocalYmd(t2_strymd, 'ec2'));
				}
				else if(mystat.historyInstanceSvc === "RDS" && acc[accNo].instanceService.indexOf('RDS') >= 0){
					startstopPromises.push(loadHistoryStartstopForLocalYmd(t2_strymd, 'rds'));
				}else{
					return Promise.resolve(null);
				}

				return Promise.all(startstopPromises)
				.then((data) => {
					let ec2rdsStartStopHist = {};

					if(mystat.historyInstanceSvc === "EC2"){
						ec2rdsStartStopHist = data[0];
					}
					else if(mystat.historyInstanceSvc === "RDS"){
						ec2rdsStartStopHist = data[0];
					}

					return startstopDataForResource(ec2rdsStartStopHist, keyTagname, resourceKey);
				});
			};

			loadHistoryStartstopData()
			.then((onoffData) => {
				// データが存在したら日付単位で描画
				if(keyTagname && onoffData){
					const resolvedResourceKey = onoffData.__resourceKey || resourceKey;
					const resolvedResourceKeys = onoffData.__resourceKeys || [resolvedResourceKey];
					const currentResourceKey = resolvedResourceKeys[resolvedResourceKeys.length - 1] || resolvedResourceKey;
					mystat.startstopHistData[histDataKey] = onoffData;

					const terminatedStoredYmd = startstopTerminatedStoredYmd(t2_strymd, onoffData);
					if(!optCpuOnly && (mystat.historyInstanceSvc === "EC2" || mystat.historyInstanceSvc === "RDS") && terminatedStoredYmd && t2_strymd > historyTerminatedInfoYmd){
						historyTerminatedInfoYmd = t2_strymd;
						queueHistoryComputerInfo(mystat.historyInstanceSvc.toLowerCase(), currentResourceKey, keyTagname, { storedYmd: terminatedStoredYmd, targetYmd: t2_strymd });
					}

					if(!optCpuOnly){
						updateBar24hAndTimeCell(t2_strymd, t2_strymd, onoffData);
					}

					if($('#chk_cpu_util').prop('checked')){

						// 続いてCPU使用率のJSONを取得して上から描画
						loadHistoryCpuForLocalYmd(t2_strymd, keyTagname)
						.then((cpuDataGroup) => {

							const cpuData = cpuDataForResourceKeys(cpuDataGroup, resolvedResourceKeys);
							if(cpuData !== null){

								updateBar24hAndTimeCell(t2_strymd, t2_strymd, onoffData, cpuData);
							}
						});
					}
				}
			})
			.finally(() => {

				mystat.historyBarDrawWaitNum--;

				// 描画終了処理
				if(mystat.historyBarDrawWaitNum === 0){
					if(!optCpuOnly) finishHistoryComputerInfo();
					mystat.sem.fullLoad = false;
					// 描画が終わったのでボタンを押せるように
					if(mystat.monthSlide > 0){
						$('#btn_next2month').removeAttr('disabled');
						$('#btn_next6month').removeAttr('disabled');
					}
					if(mystat.monthSlide < mystat.maxSlideMonth){
						$('#btn_prev2month').removeAttr('disabled');
						$('#btn_prev6month').removeAttr('disabled');
					}
					$('#btn_thismonth').removeAttr('disabled');
				}
			});

			if(optStart === 0 && _n === optEnd - 1 && !optCpuOnly){

				// <firstHistDays>日前の場所に追加描画をするためのボタンを2種類表示
				tbl.cell(mystat.firstHistDays, tableCol.bar24h.no).data(
					'<div>' +
					'<button id="btnDays31" class="btnDays maruButton" data-days="31">30日前まで表示</button>' +
					'<button id="btnDays61" class="btnDays maruButton" data-days="61">2ヶ月分を表示</button></div>' +
					tbl.cell(mystat.firstHistDays, tableCol.bar24h.no).data()
				);
			}

		}, (n - optStart + 1) * 50 + 450);   // URL呼び出しに50ミリ秒ずつWaitを入れる
	}

	setTimeout( () => {
		if(mystat.historyBarDrawWaitNum !== 0){
			$('#btn_thismonth').removeAttr('disabled');
		}
	}, 8000);   // 描画が8秒以上かかった場合、再読み込みボタンだけ先行して有効化
}


// -------------------------------------------------------------
// 稼働状況JSONデータ取得成功
// -------------------------------------------------------------
const ec2rdsJsonLoadOk = (opt) => {

    let dataSet = createDataset();

	tbl = util.DataTableWrap($(mystat.tableId), {
		destroy: true,
		data: dataSet,
		lengthMenu: tablePageLengthOptions,
		displayLength: mystat.pageLength,
		dom: 'Blfrtip',
		order: tableSortOrder,
		buttontype: [ 'status_' + strymd, 'status_' + strymd ],
		loadComplete: loadCompleteFunc,
		rowCallback: () => loadCpuUtilJsonCurrentPage(strymd),
	});
}


// -------------------------------------------------------------
// 全ての行の24時間バー・起動終了・起動時間を更新
// -------------------------------------------------------------
const updateBar24hAndTimeCellAll = () => {

	mystat.rowsTop25Index = tbl.rows()[0].slice(0, 25);

	// tbl.column().data() はソート後の位置、tbl.data() tbl.cell().data('update_data') はソート前の位置となるため、tbl.data()を使う
	tbl.data().toArray().forEach((d, i) => {

		const val = d[tableCol.bar24h.no];

		const svgId = val.split('<svg ')[1].split('id="')[1].split('"')[0];

		if(svgId){
			const keyName = svgId.slice(mystat.svgIdPre.length);
			const tagNameKey = extractBarAttr(val, 'data-tagname');
			const startstopKey = extractBarAttr(val, 'data-startstopkey') || keyName;
			const regionName = extractBarAttr(val, 'data-region');
			const startstopData = [mystat.ec2StartStopList, mystat.rdsStartStopList];

			mystat.orgRowId[ keyName ] = i;

			updateBar24hAndTimeCell(keyName, strymd, startstopDataForResource(startstopData, tagNameKey, startstopKey, regionName));
		}
	});

	// しばらく（0.5～4秒）待ってからCPU使用率JSONの読み込み、CPUの色を上書き更新
	setTimeout(() => {
		loadCpuUtilJsonCurrentPage(strymd);
	}, Math.min(4000, 500 + 5 * tbl.rows()[0].length));
}


// -------------------------------------------------------------
// 1インスタンス分のデータから24時間バーを作成して既存のセルのHTMLを更新する
// 合わせて「起動～終了」列と「起動時間」列も更新する
// cpuData: これがある場合はCPUの色も描画する
// -------------------------------------------------------------
const updateBar24hAndTimeCell = (keyname, strymd, onoffData, cpuData = null) => {

	const n = mystat.orgRowId[keyname];   // 行番号ID（ソート前の値。tbl.cell().data() で更新時に利用する）
	const svgId = mystat.svgIdPre + keyname;

	const cpuHtml = tbl.cell(n, tableCol.bar24h.no).data() || '';
	const outerSvgHtml = { pre: cpuHtml.split('<svg ')[0], post: cpuHtml.split('/svg>')[1] };

	if(!svgId || svgId.indexOf(mystat.svgIdPre) !== 0) return;

	let svgParts = { on: '', off: '', cpuColor: '', timeScale:'', criticalText:'' };

	if(!onoffData){
		tbl.cell(n, tableCol.beginend.no).data('　:　');
		return;
	}

	// 稼働状態の色
	svgParts = { ...svgParts, ...createOnOffHtml(strymd, onoffData) };

	if(cpuData === null){
		// 1回目の呼び出しでは「起動～終了」「起動時間」列を更新する
		const htmls = createBeginEndHtml(svgId, strymd, onoffData);

		// 「起動～終了」の更新
		tbl.cell(n, tableCol.beginend.no).data(htmls.beginend);

		// 「起動時間」の更新
		tbl.cell(n, tableCol.hh.no).data(htmls.hh);
	}else{
		// CPU使用率の色
		const retData = createCpuUtilBarHtml(svgId, strymd, cpuData);

		if(retData.cpuHtml !== ''){
			svgParts.cpuColor = retData.cpuHtml;
			// 最大CPU使用率も更新
			tbl.cell(n, tableCol.maxcpu.no).data(retData.maxCpu);
		}
	}

	// 時刻の目盛
	svgParts.timeScale = createTimeScaleHtml();

	// 特別状態の文字
	svgParts.criticalText = createCriticalTextHtml(strymd, onoffData);

	const cellBar24hHtml = outerSvgHtml.pre + 
	                 '<svg id="' + svgId + '" width="' + mystat.bar24hWH.width + '" height="' + mystat.bar24hWH.height + '" class="svg_24h">' +
	                 svgParts.on + svgParts.cpuColor + svgParts.off + svgParts.timeScale + svgParts.criticalText + '</svg>' +
	                  outerSvgHtml.post;

	tbl.cell(n, tableCol.bar24h.no).data(cellBar24hHtml);

	// 先頭25行の描画は初期表示アニメーションを付ける
	if(mystat.rowsTop25Index.indexOf(n) >= 0 && cpuData === null){

		// 該当のIDを削除（起動の描画中でもCPU描画が開始させることがあり、CPUの描画はアニメーション無しでよいためIDは早めに消しておく）
		mystat.rowsTop25Index.splice(mystat.rowsTop25Index.indexOf(n), 1);

		// CSSアニメーションのclassを後付けする（初めから付けていると操作によっては再度アニメーションされる）
		if(document.getElementById(svgId)){
			document.getElementById(svgId).classList.add('curtain');

			// CSSアニメーションの完了を十分待ってからclassを外す
			// DOMへの後付けは .data() に含まれないはずだがソート時などで追加したclassを記憶していて再度アニメーションされるため
			setTimeout(() =>{ document.getElementById(svgId).classList.remove('curtain'); }, 1500);
		}
	}
}


// -------------------------------------------------------------
// 「起動～終了」列と「起動時間」列の値を生成する
// -------------------------------------------------------------
const createBeginEndHtml = (svgId, strymd, data) => {

	let timeText = '';
	let preHHMM = 0.0, nowHHMM = 0.0;   // 24時間を(0～1)の間の少数点数としたときの数値。0.5は12時など
	let preV = -1;
	let onHours = 0.0;   // 起動時間

	startstopDisplayEntries(strymd, data, { includeLatest: true }).forEach((v) => {

		nowHHMM = v.minutes / 1440;

		const totalMinutes = v.minutes;
		const hourStr = ('0' + Math.floor(totalMinutes / 60)).slice(-2);
		const minStr = ('0' + (totalMinutes % 60)).slice(-2);

		// 起動～終了時刻の文字列生成
		if((v.state === 1 || v.state === 2) && (preV <= 0 || preV >= 3)) timeText += hourStr + ':' + minStr + '～';
		if((v.state === 0 || v.state === 3 || v.state === 4) && (preV === 1 || preV === 2)) timeText += hourStr + ':' + minStr + ' <br>';

		// 起動時間(時)を加算
		if(preV === 1 || preV === 2){
			onHours = Math.round((onHours + (nowHHMM - preHHMM) * 24) * 10) / 10;
		}

		preV = v.state;
		preHHMM = nowHHMM;
	});

	// 今日以外の場合と、今日の23:57以降の場合、末尾の"～"の後に"24:00"も追加
	if(timeText.slice(-1) === '～' && nowHHMM > 0.9979) timeText += '24:00';

	// 「起動～終了」列と「起動時間」列を返す
	return { 'beginend': (timeText || '　:　'), 'hh': onHours }
}


// -------------------------------------------------------------
// svgの内部の<rect>のHTMLを生成する
// -------------------------------------------------------------
const createRectForSvg = (color, x, y, width, opt = {}) => {

	return '<rect x="' + x +'" y="' + y +
	       '" width="' + width + '" height="' + (mystat.bar24hWH.height - y) +
	       '" fill="' + color + '"' +
           (opt.cssClass ? ' class="' + opt.cssClass + '"' : '') + '></rect>';
}


// -------------------------------------------------------------
// svgの内部の<text>のHTMLを生成する
// text: 表示する文字
// param: 必須パラメータ―
//   x: X座標
//   y: Y座標
//   color: 色
//   size: フォントサイズ
// opt: オプション
//   weight: "normal", "bold"
//   family: フォント書体
//   center: true ならセンタリング
//   cssClass: class="xxxxx" で指定する xxxx の値
// -------------------------------------------------------------
const createTextForSvg = (text, param, opt = {}) => {

	const textTag = '<text x="' + param.x + '" y="' + param.y + '" ' + 
	                'font-size="' + param.size + '" ' + 
	                'fill="' + param.color + '" ' + 
	                (opt.weight ? 'font-weight="' + opt.weight + '" ' : '') + 
	                (opt.family ? 'font-family="' + opt.family + '" ' : '') + 
	                (opt.cssClass ? 'class="' + opt.cssClass + '" ' : '') + 
	                (opt.center ? 'text-anchor="middle" ' : '') + 
	                '>' + 
	                text + 
	                '</text>';

	return textTag;
}


// -------------------------------------------------------------
// 1サーバー分の稼働状態(UP/DOWN)のバーを描画するHTML(svgの内部)を生成する
// 戻り値: 2つの値をオブジェクトで返す on: 停止以外, off: 停止
// -------------------------------------------------------------
const createOnOffHtml = (strymd, data) => {

	let onoffHtml = { on: '', off: '' };

	// 今日なら現在時刻に該当するX座標が右端、過去日ならフルサイズの横幅とX座標の右端が同じ
	const endX = (isToday(strymd)) ? Math.floor(currentDisplayMinutes() / mystat.minutesPerDot) : mystat.bar24hWH.width;

	// 最初にすべての範囲を停止の色で塗る(起動の描画の下地なので onoffHtml.on)
	onoffHtml.on += createRectForSvg(colorId['0'], 0, 0, endX);

	// 状態データを時間順にソートする
	const sortedData = startstopDisplayEntries(strymd, data, { includeLatest: true });

	let prevBarX = 0;
	let prevState = 4;   // "0000" がない場合、最初の記録までは未存在扱い

	// 該当区間の<rect>を作成して追加する
	sortedData.forEach(({state, minutes}) => {
		const barX = minutes / mystat.minutesPerDot;

		if(prevState !== 0){
			onoffHtml.on += createRectForSvg(colorId[''+prevState], prevBarX, 0, barX - prevBarX);
		}else{
			onoffHtml.off += createRectForSvg(colorId[''+prevState], prevBarX, 0, barX - prevBarX);
		}

		prevBarX = barX;
		prevState = state;
	});

	return onoffHtml;
}


// -------------------------------------------------------------
// 特別な状態テキスト(FULL、Terminated、等)を描画するHTML(svgの内部)を生成する
// -------------------------------------------------------------
const createCriticalTextHtml = (strymd, data) => {

	let criticalHtml = '';
	const endMinutes = (isToday(strymd)) ? currentDisplayMinutes() : 1440;

	// 停止以外の色(稼働,エラー)を該当区間に追加する
	const sortedData = startstopDisplayEntries(strymd, data);
	sortedData.forEach(({state, minutes}, idx) => {

		if(minutes >= endMinutes) return;
		if(state < 2 || state > 4) return;
		if(idx >= 1 && String(sortedData[idx - 1].state) === String(state)) return;

		const barX = minutes / mystat.minutesPerDot;

		criticalHtml += createRectForSvg('#ffffffaa', barX+10, 2, 60, { cssClass: 'blink-err' });
		criticalHtml += createTextForSvg(statusCriticalText[''+state][0], { x: barX+9, y: 14, color: statusCriticalText[''+state][1], size: '8pt' }, { cssClass: 'blink-err' });
		criticalHtml += createTextForSvg('←', { x: barX+1, y: 14, color: statusCriticalText[''+state][1], size: '8pt' }, { weight: 'bold' });
	});

	return criticalHtml;
}


// -------------------------------------------------------------
// 1つのセレクタIDに時刻(HH)の目盛を追加する
// -------------------------------------------------------------
const createTimeScaleHtml = () => {

	let timeScaleHtml = '';

	// 目盛を自前で生成するロジック
	for (let i = 0; i < 25; i++) {
		// 時刻のテキスト要素を作成
		if(i < 24 && i > 0){
			timeScaleHtml += createTextForSvg(i.toString(), { x: mystat.bar24hWH.width / 24 * i, y: 13, color: '#944', size: '7.5pt' }, { family: 'Meiryo', center: true, weight: 'bold' });
		}
		// 「＾」テキスト要素を作成
		timeScaleHtml += createTextForSvg('▲', { x: mystat.bar24hWH.width / 24 * i, y: 4, color: '#a44', size: '5pt' }, { family: 'Meiryo UI', center: true });
	}

	// 事前にSVG→PNG変換済みのpng画像"timescale1m.png", "timescale2m.png"を読み込む → 読み込まれないことが多いので却下
	//if(mystat.bar24hWH.width === 720 || mystat.bar24hWH.width === 1440){
	//	timeScaleHtml = '<image x="0" y="0" width="' +mystat.bar24hWH.width + '" height="' + mystat.bar24hWH.height + '" xlink:href="../common_script/images/timescale' + (1440 / mystat.bar24hWH.width) + 'm.png" />';
	//}

	return timeScaleHtml;
}


// -------------------------------------------------------------
// CPU使用率のJSONデータのうち現在表示中のページ分だけを読み込む
// 後続の処理として updateBar24hAndTimeCell() を呼び出してCPUの色を描画
// -------------------------------------------------------------
const loadCpuUtilJsonCurrentPage = async (strymd) => {

	// テーブル未生成・CPU使用率のチェック無しは直ぐに戻す
	if(!tbl || ! $('#chk_cpu_util').prop('checked')) return;

	// ソートやフィルター時にrowCallbackイベントが行単位で多重呼び出しされるため、処理の着手中なら直ぐに戻す
	if(mystat.sem.cpuLoad || mystat.sem.fullLoad) return;

	mystat.sem.cpuLoad = true;

	let resourceKeysByCpuFile = {};

	// 画面上に存在する行から、CPUファイル名(Nameタグ)と行キー(リソースID)の対応を作成
	document.querySelectorAll('.bar24h_wrap').forEach((v) => {
		const tagNameKey = v.dataset.tagname || '';
		const resourceKey = v.dataset.instanceid || '';
		const startstopKey = v.dataset.startstopkey || resourceKey;
		const targetRegion = v.dataset.region || currentRegionName();
		if(!tagNameKey || !resourceKey) return;
		const cpuFileKey = targetRegion + '\t' + tagNameKey;
		if(!resourceKeysByCpuFile[cpuFileKey]) resourceKeysByCpuFile[cpuFileKey] = { tagNameKey, targetRegion, resourceKeys: [], startstopKeys: {} };
		resourceKeysByCpuFile[cpuFileKey].resourceKeys.push(resourceKey);
		resourceKeysByCpuFile[cpuFileKey].startstopKeys[resourceKey] = startstopKey;
	});

	let cpuFileKeys = Object.keys(resourceKeysByCpuFile);

	let rowLoadCount = cpuFileKeys.length || 0;

	mystat.sem.cpuLoad = (rowLoadCount > 0) ? true : false;

	// S3上のCPU使用率JSONをリージョンとNameタグ単位で処理する
	cpuFileKeys.forEach((cpuFileKey) => {

		const { tagNameKey, targetRegion, resourceKeys, startstopKeys } = resourceKeysByCpuFile[cpuFileKey];

		loadCpuUtilForLocalYmdRegion(strymd, tagNameKey, targetRegion)
		.then((cpuDataGroup) => {

			mystat.cpuDataAll[strymd] = {...mystat.cpuDataAll[strymd], [cpuFileKey]: cpuDataGroup};
			const startstopData = [mystat.ec2StartStopList, mystat.rdsStartStopList];

			resourceKeys.forEach((resourceKey) => {

				if(mystat.orgRowId[resourceKey] === undefined) return;  // continue

				const cpuData = cpuDataForResource(cpuDataGroup, resourceKey);
				if(cpuData === null) return;  // continue

				updateBar24hAndTimeCell(resourceKey, strymd, startstopDataForResource(startstopData, tagNameKey, startstopKeys[resourceKey] || resourceKey, targetRegion), cpuData);
			});
		})
		.finally(() => {
			rowLoadCount--;

			if(rowLoadCount < 5){   // 最後4個程度の読み込みに時間がかかることがあるため、5個を残すのみになったら先にCPU秒が待ちのフラグを消す
				mystat.sem.cpuLoad = false;
			}
		});
	});
}


// -------------------------------------------------------------
// 1サーバー分のCPU使用率を描画するHTML(svgの内部)を生成する
// 色バーの描画と各インスタンスのCPU使用率をJsonから取得して描画
// tagnameとymdの組み合わせでURLとsvgIdが一意に決定される
// 戻り値： 2つの値をオブジェクトで返す。cpuHtml: <svg>の中身に入れるための<rect>の集合。maxCpu：「最大CPU%」列用の文字列
// -------------------------------------------------------------
const createCpuUtilBarHtml = (svgId, strymd, cpuData) => {

	let zeroToNine = { now: -1, next: -1 };
	let cpuUtilFound = false;
	const intervalWidth = mystat.bar24hWH.width / (60*24/mystat.cpuDataInterval);   // CPU使用率データ1個分の横幅
	const cpuBorder = [10, 90];
	let retData = { cpuHtml: '', maxCpu: '-' };   // [ cpuHtml, maxCpu ]

	for(let i=0; i < 60*24/mystat.cpuDataInterval; i++){

		zeroToNine.now = -1;
		let widthRate = 1;   // 横幅を何個分描画するか

		if(!isNaN(cpuData[i])){
			cpuUtilFound = cpuUtilFound || (cpuData[i] >= 0 ? true : false);
			// CPU使用率から10段階の値(0～9)を取得
			zeroToNine.now = Math.max(0, Math.min(9, Math.ceil((cpuData[i] - cpuBorder[0]) / ((cpuBorder[1] - cpuBorder[0] - 1) / 8.0))));

			// 連続して同じ色なら1つの四角として描画する
			for(let j = 1; i+j < 60*24/mystat.cpuDataInterval-1; j++){
				if(!isNaN(cpuData[i+j])){
					// CPU使用率から10段階の値(0～9)を取得
					zeroToNine.next = Math.max(0, Math.min(9, Math.ceil((cpuData[i+j] - cpuBorder[0]) / ((cpuBorder[1] - cpuBorder[0] - 1) / 8.0))));

					if(zeroToNine.now === zeroToNine.next){
						widthRate += 1;   // 1つ分大きく描画する
					}else{
						break;
					}
				}else{
					break;
				}
			}

			// 対象とするCPUの色を描画
			retData.cpuHtml += createRectForSvg(statColor['on' + zeroToNine.now], parseInt(i*intervalWidth)+1, 2, parseInt(intervalWidth * widthRate));

			if(widthRate > 1) i += widthRate-1;   // 大きく移動
		}
	}

	if(cpuUtilFound){
		retData.maxCpu = ('0' + calcCpuMax(cpuData)).slice(-2) + '%';
	}

	return retData;

}


// -------------------------------------------------------------
// URLパラメータからフィルター対象を取得 (index.html用)
// 現時点では、グループタグ指定、svcIdx=0 (*)、envIdx=0 (*)、loadnow (*)、date=yyyymmdd, today, yesterday, -1～-799(実質は-730)
// 「pagelength=25,50,100,200,300, .. ,1000,1500,2000」 「search=xxx (*)」 「cpuutil=0,1 (*)」に対応
//  (*) のURLパラメータは util.getUrlParameterAndLocalStorageToControl()側で対応
// -------------------------------------------------------------
const getUrlParameter = (locationSearch) => {

	if( locationSearch.substring('?') ){
		$.each( decodeURIComponent(locationSearch.split('?')[1]).split('&'), (i, val) => {

		if(val.search(/^date=20([23][0-9])(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$/) !== -1){
				mystat.daysAgo = Math.min(mystat.maxAgo, Math.max(0, Math.floor((mystat.now - new Date(val.substr(5,4) + '/' + val.substr(9,2) + '/' + val.substr(11,2))) / 3600 / 1000 / 24)));
			}
			else if(val.match(/^date=(today|yesterday)$/)){
				mystat.daysAgo = (val === 'date=today') ? 0 : 1;
			}
			else if(val.match(/^date=\-([1-9]|[1-9][0-9]|[1-7][0-9][0-9])$/)){
				mystat.daysAgo = parseInt(val.substring(6));
			}
			else if(val.indexOf('pagelength=') === 0){
				const pageLength = parseInt(val.substring(11));
				if(tablePageLengthOptions.includes(pageLength)) mystat.pageLength = pageLength;
			}
		});
	}
}


// -------------------------------------------------------------
// URLパラメータからフィルター対象を取得 (history.html用)
// 現時点では、「svc=ec2|rds」「region=xxxxxxx」「tagname=xxxxxxx」「name=xxxxxxx」「cpuutil=0,1 (*)」に対応
//  (*) のURLパラメータは util.getUrlParameterAndLocalStorageToControl()側で対応
// -------------------------------------------------------------
const getUrlParameterHist = (locationSearch) => {

	if( locationSearch.substring('?') ){
		$.each( decodeURIComponent(locationSearch.split('?')[1]).split('&'), (i, val) => {

			if(val === 'svc=ec2'){
				mystat.historyInstanceSvc = "EC2";
			}
			else if(val === 'svc=rds'){
				mystat.historyInstanceSvc = "RDS";
			}
			else if(val.substring(0,7) === 'region='){
				mystat.historyRegion = validRegionName(val.substring(7));
			}
			else if(val.substring(0,8) === 'tagname='){
				mystat.targetHistTagname = val.substring(8);
			}
			else if(val.substring(0,5) === 'name='){
				mystat.targetHistTagname = val.substring(5);
			}
		});
	}
}


// -------------------------------------------------------------
// ボタンまたは選択ボックスの結果から表示するデータが何日前分かの数値を返す
// -------------------------------------------------------------
const getDrawPageDate = (olddate) => {

	switch( true ) {
	case /^today$/.test( olddate ):
		return 0;
	case /^yesterday$/.test( olddate ):
		return 1;
	case /[2-9]daysago/.test( olddate ):
		return parseInt( olddate.charAt(0) );
	case /minus/.test( olddate ):
		return Math.min(364, $('#sel_oldday_block > select').prop('selectedIndex') + 1);
	case /plus/.test( olddate ):
		return Math.max(0, $('#sel_oldday_block > select').prop('selectedIndex') - 1);
	}

	return '-';
}


// -------------------------------------------------------------
// 1日のCPU使用率のうち最大CPU使用率を返す
// 値は 0～99 の整数で返す
// -------------------------------------------------------------
const calcCpuMax = (arrayCpu) => {

    const arrayCpuValid = arrayCpu.filter(n => n >= 0); // 有効なデータをフィルタリング
    return Math.min(Math.max(0, ...arrayCpuValid), 99); // 0以上99以下に制限
}


// -------------------------------------------------------------
// サーバー情報を非同期で取得して上部に表示
// -------------------------------------------------------------
const computerInfoDisplayName = (instanceid, tagname) => tagname || instanceid || mystat.targetHistTagname || mystat.targetInstanceId || '';
const renderComputerInfo = (fndInst, computerName, opt = {}) => {

	if(opt?.tagConv){
		fndInst['Tags2'] = {};
		$.each( (fndInst['Tags'] || {}), (i, v) => fndInst['Tags2'][ v['Key'] ] = v['Value'] );
		fndInst['Tags'] = fndInst['Tags2'];
	}

	// 2回目用に1回目の出力コンピュータ名以降の出力を切り捨てる
	document.querySelector('#dispComputerInfo').innerHTML = '<details><summary><span id="computername_val">' + util.escapeHTML(computerName) + '</span></summary></details>';

	if(!fndInst.InstanceId && !fndInst.DBInstanceIdentifier){
		$('#dispComputerInfo > details > summary').append('<span class="red"> (サーバー情報取得不可）</span>');
	}

	mystat.targetInstanceId = fndInst.InstanceId || fndInst.DBInstanceIdentifier || '';

	if(fndInst.Tags?.[ groupTagFilter.key ]) $('#dispComputerInfo > details').append(groupTagFilter.key + 'タグ:　<span class="toClip">' + fndInst.Tags[ groupTagFilter.key ] + '</span>');
	if(fndInst.InstanceId) $('#dispComputerInfo > details').append('<br>インスタンスID:　<span class="toClip b">' + fndInst['InstanceId'] + '</span>');
	if(fndInst.Tags && fndInst.Tags[ tagEnvKey ]) $('#dispComputerInfo > details').append('<br>環境(' + tagEnvKey + 'タグ):　<span class="toClip">' + fndInst.Tags[ tagEnvKey ] + '</span>');
	if(fndInst.PrivateIpAddress) $('#dispComputerInfo > details').append('<br>Private IP:　<span class="toClip">' + fndInst.PrivateIpAddress + '</span>');
	if(fndInst.InstanceType) $('#dispComputerInfo > details').append('<br>インスタンスタイプ:　<span class="toClip">' + fndInst.InstanceType + '</span>');
	if(fndInst.DBInstanceClass) $('#dispComputerInfo > details').append('<br>インスタンスクラス:　<span class="toClip">' + fndInst.DBInstanceClass + '</span>');
};
const findEc2ComputerInfo = (instanceid, tagname, opt = {}) => {

	// Nameタグでフィルタするか、インスタンスIDでフィルタするか、どちらか
	const apiFilt = (instanceid) ? ['instance-id', instanceid] : ['tag:Name', tagname];
	const useStoredDescribe = !!(opt.localYmd || opt.storedYmd);
	const targetRegions = opt.regionName ? regions.filter(region => region.id === opt.regionName) : regions;

	return Promise.all(targetRegions.map(region =>
		(opt.storedYmd ? fetchStoredDescribeByStoredYmd(opt.storedYmd, 'ec2', region.id) : (useStoredDescribe ? fetchStoredDescribe(opt.localYmd, 'ec2', region.id) : util.fetch( window.appConfig.urlToolRoot + 'api/?api=ec2:describe_instances&arg=%7b%22Filters%22:%5b%7b%22Name%22:%22' + apiFilt[0] + '%22,%22Values%22:%5b%22' + apiFilt[1] + '%22%5d%7d%5d%7d&' + util.cacheParam(3600) + '&region=' + encodeURIComponent(region.id) )))
		.then(data => useStoredDescribe ? normalizeStoredEc2DescribeInstances(data) : (data.Reservations || []).flatMap(reservation => reservation.Instances || []))
	)).then((results) => {
		const instances = results.flat();
		const foundInst = useStoredDescribe ? instances.find(inst => inst.InstanceId === instanceid || inst.Tags?.Name === tagname) : instances[0];
		return { inst: foundInst || null, tagConv: foundInst ? !useStoredDescribe : false };
	});
};
const findRdsComputerInfo = (instanceid, tagname, opt = {}) => {
	const targetRegions = opt.regionName ? regions.filter(region => region.id === opt.regionName) : regions;
	const useStoredDescribe = !!(opt.localYmd || opt.storedYmd);
	return Promise.all(targetRegions.map(region =>
		(opt.storedYmd ? fetchStoredDescribeByStoredYmd(opt.storedYmd, 'rds', region.id) : (useStoredDescribe ? fetchStoredDescribe(opt.localYmd, 'rds', region.id) : util.fetch( window.appConfig.urlToolRoot + 'api/?api=rds:describe_db_instances&simpletag&select=DBInstanceIdentifier:DBInstanceClass:TagList&' + util.cacheParam(3600) + '&region=' + encodeURIComponent(region.id) )))
		.then(data => data.DBInstances || [])
	)).then((results) => {
		const dbInstances = results.flat();
		const foundInst = dbInstances.find(inst => {
			const tags = tagListToObject(inst.TagList);
			return inst.DBInstanceIdentifier === instanceid || tags.Name === tagname;
		});
		if(foundInst) foundInst.Tags = tagListToObject(foundInst.TagList);
		return { inst: foundInst || null, tagConv: false };
	});
};
const findComputerInfo = (svc, instanceid, tagname, opt = {}) => {
	if(svc === 'ec2'){
		return findEc2ComputerInfo(instanceid, tagname, opt).then(result => result.inst || !opt.fallbackRds ? result : findRdsComputerInfo(tagname, tagname, opt));
	}
	if(svc === 'rds') return findRdsComputerInfo(instanceid, tagname, opt);
	return Promise.resolve({ inst:null, tagConv:false });
};
const dispComputerInfo = (svc, instanceid, tagname, opt = {}) => {
	const computerName = computerInfoDisplayName(instanceid, tagname);
	return findComputerInfo(svc, instanceid, tagname, opt).then(result => {
		renderComputerInfo(result.inst || {}, computerName, { tagConv: result.tagConv });
		return !!result.inst;
	});
};


// -------------------------------------------------------------
// テーブルと各種コントロールを表示 history.html用
// -------------------------------------------------------------
const drawHistoryMain = () => {

	let tgtDate;
	let dataInitial;
	let dataset = [];
	const gapdate = (new Date(mystat.now.getFullYear(), mystat.now.getMonth(), mystat.now.getDate()) - new Date(mystat.now.getFullYear(), mystat.now.getMonth() - mystat.monthSlide, mystat.now.getDate())) / 3600 / 24 / 1000;
	tbl = null;
	mystat.startstopHistData = {};
	let strymd;

	// サーバ情報の列の範囲を'-'で初期化
	dataInitial = Array(tableCol._meta.initcols).fill('-');

	for(let n=0; n<61; n++){

		tgtDate = new Date(mystat.now.getFullYear(), mystat.now.getMonth() - mystat.monthSlide, mystat.now.getDate() - n);
		yyyy = tgtDate.getFullYear();
		mm = tgtDate.getMonth() + 1;
		dd = tgtDate.getDate();
		strymd = yyyy * 10000 + mm * 100 + dd;

		dataInitial[tableCol.date.no] = '<span class="b disp-keyname">' + yyyy + '/' +('0'+ mm).slice(-2) + '/' + ('0'+ dd).slice(-2) + util.getYoubiWithColor(tgtDate) + '</span>';
		dataInitial[tableCol.ago.no] = (n + gapdate) + ' 日前';
		dataInitial[tableCol.beginend.no] = '-';
		dataInitial[tableCol.maxcpu.no] = '-';
		dataInitial[tableCol.avgcpu.no] = '';
		dataInitial[tableCol.bar24h.no] = '<div class="bar24h_wrap" data-date="' + strymd + '"><img class="spanLink cpu_graph_btns" src="../common_script/images/graphicon.png" width="11" height="11"><svg id="' + mystat.svgIdPre + strymd + '" width="' + mystat.bar24hWH.width + '" height="' + mystat.bar24hWH.height + '"></svg></div><div class="cpu_graph_wrap"></div>';

		dataset.push(dataInitial.concat());   // 参照ではなく値を渡してpushするためconcat()を付与
	}

	tbl = util.DataTableWrap($(mystat.tableId), {
		destroy: true,
		data: dataset,
		dom: 'Bfrti',
		ordering: false,
		buttons: [ { extend:'copy' }, { extend:'excel', title: () => 'status_hist_' + mystat.targetHistTagname } ],
		loadComplete: () => loadCompleteHistFunc({ start: 0, end: mystat.firstHistDays }, mystat.targetHistTagname),

	});

	mystat.currentHistDays = mystat.firstHistDays;   // 2ヶ月前、6ヶ月前で切り替えた場合、リセット

}


// -------------------------------------------------------------
// 凡例を描画
// -------------------------------------------------------------
const drawLegend = () => {

	// 凡例表示
	document.querySelector('#hanrei').innerHTML = '<span class="fontmono"><span id="cpu_legend_stopped" style="color:' + statColor.off + '; background-color:' + statColor.off + '">xx</span>:OS停止(stopped等)' + 
		'<span class="sp"></span>' +
		'<span id="cpu_legend_running" style="color:' + statColor.on +  '; background-color:' + statColor.on + '">oo</span>:OS起動(running)' + 
		'<span class="sp"></span>' +
		'<span id="cpu_legend_running" class="b" style="color:' + statColor.fullText + '; background-color:' + statColor.full + ';">FU</span>:Storage-Full(RDS)' + 
		'<span class="sp"></span>' +
		'<span id="cpu_legend_running" class="b" style="color:' + statColor.impairedText +  '; background-color:' + statColor.impaired + '">異</span>:' + statusLabel.impaired + 
		'<span class="sp"></span>' +
		'<span id="cpu_legend_running" class="b" style="color:' + statColor.terminatedText +  '; background-color:' + statColor.terminated + '">Te</span>:' + statusLabel.terminated + 
		'<span class="sp"></span><span class="cpu_legend"></span>' + 
		':<label><input type="checkbox" id="chk_cpu_util">CPU使用率(CPU:0%-100%)</label></span><span class="sp"></span>';

	// CPUの凡例表示
	document.querySelector('.cpu_legend').innerHTML = '';
	for(let i=0; i<=9; i++){
		document.querySelector('.cpu_legend').innerHTML += '<span class="colorcel' +
			 '" style="color:' + statColor['on' + i] + '; background-color:' + statColor['on' + i] + '">' + i + '</span>';
	}
}


// -------------------------------------------------------------
// index.html ページ準備完了時に実行
// -------------------------------------------------------------
var onLoad = function(fHtml)
{
	mystat.fromHtml = fHtml;
	let cpuGraphWH = { w: 1480, h: 220 };

	document.querySelector('#TitleInstance').innerText = acc[accNo].instanceService.join("/");

	document.title = acc[accNo].titleBarPre + document.title;

	// index.html固有の初期化1
	if(mystat.fromHtml === mystat.fromPattern[0]){

		// ローカルストレージおよび該当URLパラメータを取得してコントロールに反映
		util.getUrlParameterAndLocalStorageToControl(
			{},
			{'chk_cpu_util':{ 'param':'cpuutil', 'defvalue':'1' }},
			{reqGroupTag:false, loadnow:true, search:true}
		);

		// コントロール以外のURLパラメータを取得
		getUrlParameter( $(location).attr('search') );

		// 「何日前 mm/dd(曜日)」のドロップダウンの生成
		util.createDropdownDate('#sel_oldday_block', mystat.daysAgo, mystat.maxAgo);

	// history.html固有の初期化1
	}else{

		// history.html用に書き換え
		tableCol = {...tableCol, ...{ _meta: {initcols:5}, date: {no:0, visible:true}, ago: {no:1, visible:true}, beginend: {no:2, visible:true}, hh: {no:3, visible:true}, maxcpu: {no:4, visible:true}, avgcpu: {no:5, visible:false}, bar24h: {no:6, visible:true} } };

		// ローカルストレージおよび該当URLパラメータを取得してコントロールに反映
		util.getUrlParameterAndLocalStorageToControl(
			null,
			{'chk_cpu_util':{ 'param':'cpuutil' }},
			null
		);

		// URLパラメータを取得
		getUrlParameterHist( $(location).attr('search') );

		document.getElementById('computername_val').innerHTML = mystat.targetHistTagname + ' ...';
	}

	// テーブルヘッダー作成
	ec2rdsCreateTableHeader(mystat.tableId);

	// index.html固有の初期化2
	if(mystat.fromHtml === mystat.fromPattern[0]){

		// テーブル読み込みボタンの初期化
		util.initReloadTableButton({
			btnname: window.appConfig.labels.reloadTableButton,
			clickCallback: () => drawPageMain()
		});

		// 日付選択
		$(document).on('change', '#sel_oldday_block', () => util.clickReloadTableButton(10) );

	// history.html固有の初期化2
	}else{
		// 過去の起動・停止を即時描画
		drawHistoryMain();
	}

	// 凡例表示
	drawLegend(false);

	// 各種クリックイベント
	document.addEventListener('click', () => {

		//	共通用
		// CPU使用率グラフの表示ボタン
		if(event.target.matches('.cpu_graph_btns')){

			let id;
			let cpuGraph = event.target.parentElement.parentElement.querySelector('.cpu_graph_wrap');
			let tagname;
			let graphYMD;
			let graphAgo;

			if(mystat.fromHtml === mystat.fromPattern[0]){
				id = event.target.parentElement.dataset.instanceid;
				tagname = event.target.parentElement.dataset.tagname;
				graphYMD = cloudWatchDateRange(mystat.targetDate.getFullYear(), mystat.targetDate.getMonth(), mystat.targetDate.getDate());
				graphAgo = (mystat.now - graphYMD.agoBase) / 1000 / 60 / 60 / 24;
			}else{
				id = mystat.targetInstanceId;
				const dataDate = event.target.parentElement.dataset.date;
				tagname = mystat.targetHistTagname;
				graphYMD = cloudWatchDateRange(parseInt(dataDate.substr(0,4)), parseInt(dataDate.substr(4,2))-1, parseInt(dataDate.substr(6,2)));
				graphAgo = (mystat.now - graphYMD.agoBase) / 1000 / 60 / 60 / 24;
			}

			cpuGraph.innerHTML = '<br><span class="b">Loading...</span>';

			let cwPeriod = (graphAgo >= 63) ? '3600' : '300';   // 63日経過したらデータが3600秒に丸まるのでリクエストも合わせる
			const cwUrl = buildCloudWatchCpuUrl(id, tagname, graphYMD, cwPeriod, cpuGraphWH.w / mystat.minutesPerDot, cpuGraphWH.h);

			util.fetch(
				cwUrl
			).then((data) => {
				let thisCpuGraph = cpuGraph;
				thisCpuGraph.innerHTML = '<img src="data:image/png;base64,' + data['MetricWidgetImage'] + '">';

			}).catch(() => {
				let thisCpuGraph = cpuGraph;
				thisCpuGraph.innerHTML = '';
			});
		}

		// index.html用
		if(mystat.fromHtml === mystat.fromPattern[0]){

			// 最新のステータスに更新する
			if(event.target.matches('#link-getlatest')){ getLatestStatus(event); }

			// 24時間バーの横幅を変える
			if(event.target.matches('#btn_minutesPerDot')){
				mystat.minutesPerDot = 3 - mystat.minutesPerDot;   // 1⇔2
				mystat.bar24hWH.width = 60 * 24 / mystat.minutesPerDot;
				util.clickReloadTableButton(10);
			}

			// 今日、前日、翌日のボタンのクリック
			if(event.target.matches('.dayButton')){

				if(mystat.sem.fullLoad) return;   // 処理中なので無視

				const dateAgo = getDrawPageDate( event.target.dataset.olddate );
				if(! isNaN(dateAgo)){
					$('#sel_oldday_block > select').prop('selectedIndex', dateAgo);
				}
				util.clickReloadTableButton(10);
			}
		}else{

			//  「30日前」「2か月前」ボタンで追加表示
			if(event.target.matches('.btnDays')){

				const days = parseInt(event.target.dataset.days);

				tbl.cell(mystat.firstHistDays, tableCol.bar24h.no).data(
					tbl.cell(mystat.firstHistDays, tableCol.bar24h.no).data().replace(/(.*)\<button.*\<\/button\>.*<button.*\<\/button\>(.*)/, '$1$2')
				);
				loadCompleteHistFunc({ start: mystat.firstHistDays, end: days }, mystat.targetHistTagname);
				mystat.currentHistDays = days;

			}

			// -6ヶ月、-2ヶ月、再読込、+2ヶ月、+6ヶ月のボタン
			if(event.target.matches('.monthButton')){

				if(mystat.sem.fullLoad) return;   // 処理中なので無視

				mystat.sem.fullLoad = true;
				if(event.target.id === 'btn_prev6month') mystat.monthSlide = Math.min(mystat.maxSlideMonth, mystat.monthSlide + 6);
				if(event.target.id === 'btn_prev2month') mystat.monthSlide = Math.min(mystat.maxSlideMonth, mystat.monthSlide + 2);
				if(event.target.id === 'btn_next2month') mystat.monthSlide = Math.max(0, mystat.monthSlide - 2);
				if(event.target.id === 'btn_next6month') mystat.monthSlide = Math.max(0, mystat.monthSlide - 6);

				$('.monthButton').attr('disabled', 'disabled');
				// 過去の起動・停止を描画
				drawHistoryMain();

			}
		}
	});

	// 表示・非表示のチェックボックスを初期化
	util.showHideColumnCheckBox(mystat.tableId, tableCol, 'init');

	// CPU使用率をチェックすると後追いで描画
	document.querySelector('#chk_cpu_util').addEventListener('change', () => {
		mystat.sem.cpuLoad = false;

		if(mystat.fromHtml === mystat.fromPattern[0]){
			loadCpuUtilJsonCurrentPage(strymd);
		}else{
			loadCompleteHistFunc({ start: 0, end: mystat.currentHistDays, cpuOnly: true }, mystat.targetHistTagname);
		}
	});

};


window.addEventListener('pageshow', (event) => {

	// 対象リージョン表示
	if(document.querySelector('#DispRegion')){
		document.querySelector('#DispRegion').innerText = ec2rdsRegionLocations();
	}

});

