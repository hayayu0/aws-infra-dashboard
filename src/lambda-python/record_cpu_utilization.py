# record_cpu_utilization.py
# EC2/RDSのCPU使用率をCloudWatchから取得、加工してS3へ保管する
# シングルアカウント。マルチリージョン対応
#
# トリガー:
# EventBridgeスケジューラ "record-cpu-utilization"
# 10分おきに実行

import json
import boto3
import os
import copy
import datetime
import time
import re
import urllib.parse

# 対象リージョン
SUPPORTED_REGION_LIST = [
	'ap-northeast-1', 'ap-northeast-3', 'ap-southeast-1', 'ap-northeast-2', 'ap-southeast-2', 'ap-south-1',
	'us-east-1', 'us-west-1', 'us-east-2', 'us-west-2',
	'ca-central-1',
	'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1',
	'sa-east-1'
]
REGION_LIST = [
	x for x in re.split(r'[, ]+', os.getenv('REGION_LIST') or os.getenv('AWS_REGION') or 'ap-northeast-1')
	if x
]
INVALID_REGION_LIST = [x for x in REGION_LIST if x not in SUPPORTED_REGION_LIST]
if INVALID_REGION_LIST:
	raise ValueError(f'Invalid region in REGION_LIST: {", ".join(INVALID_REGION_LIST)}')
TIMEZONE_OFFSET_HOURS = int(os.getenv('TIMEZONE_OFFSET_HOURS', os.getenv('timezone_delta', '9')))

S3 = boto3.resource('s3')

# 保管用S3バケット
S3_BUCKET = os.getenv('S3_BUCKET')

# GetMetricData API呼び出し1回当たりの対象サーバー数
# 最大データポイント(100800) ÷ 24時間5分(289)
SERVERS_PER_GET = 348

# ================
def lambda_handler(event, context):

	# 開始日時と終了日時とファイル名の日付
	ymd = start_end_ymd()

	# 対象日時をログに出力
	print(ymd)

	output = {}

	for region in REGION_LIST:
		try:
			output[region] = record_region(region, ymd)
		except Exception as e:
			output[region] = { 'result': 'ng', 'message': format(e) }

	return { 'result': output }


# ----------------
# 指定リージョンのCPU使用率を記録
def record_region(region, ymd):

	ec2 = boto3.client('ec2', region_name=region)
	rds = boto3.client('rds', region_name=region)
	cloudwatch = boto3.client('cloudwatch', region_name=region)

	# get_metric_dataのクエリー文字列 テンプレート
	# IdとDimensionsのValueは後で書き換える
	QUERY_TEMPLATE = {
		'Id': 'ec2_0',
		'MetricStat': {
			'Metric': {
				'Namespace': 'AWS/EC2',
				'MetricName': 'CPUUtilization',
				'Dimensions': [ { 'Name': 'InstanceId', 'Value': 'i-xxxx' } ]
			},
			'Period': 300,
			'Stat': 'Average'
		}
	}

	# get_metric_data用のクエリ生成 (SERVERS_PER_GET(=348)ずつ取得するようにグループ化)
	# [ [ {1台目}, {2台目}, ～ {348台目} ] , [[ {349台目}, {350台目}, ・・・]
	# EC2の後にRDSとし、EC2とRDSはグループを分ける
	data_queries = []
	target_by_query_id = {}

	# 追加された数 グループ分けの算出に利用
	append_num = 0

	# EC2 =========================
	# EC2インスタンスIDとNameタグの対応を取得
	ec2_name_by_id = get_ec2_name_by_id(ec2)

	for instance_id in ec2_name_by_id:
		grp_id = int(append_num / SERVERS_PER_GET)

		if len(data_queries) <= grp_id:
			data_queries.append([])

		if not instance_id:
			continue 

		# クエリーを完成させてセットする
		query_id = f'ec2_{append_num}'
		QUERY_TEMPLATE['Id'] = query_id
		QUERY_TEMPLATE['Label'] = instance_id
		QUERY_TEMPLATE['MetricStat']['Metric']['Dimensions'] = [{ 'Name':'InstanceId', 'Value': instance_id }]
		data_queries[grp_id].append( copy.deepcopy(QUERY_TEMPLATE) )
		target_by_query_id[query_id] = { 'resource_id': instance_id, 'name': ec2_name_by_id[instance_id] }
		append_num += 1

	# RDS =========================
	# RDSのリストを取得
	rds_name_by_id = get_rds_name_by_id(rds)

	QUERY_TEMPLATE['MetricStat']['Metric']['Namespace'] = 'AWS/RDS'

	#次のSERVERS_PER_GET(=348)の倍数に切り上げて1つ上のグループIDとなるようにする
	append_num = (int((append_num + SERVERS_PER_GET - 1)/ SERVERS_PER_GET)) * SERVERS_PER_GET

	for instance_id in rds_name_by_id:
		grp_id = int(append_num / SERVERS_PER_GET)

		if len(data_queries) <= grp_id:
			data_queries.append([])

		if not instance_id:
			continue 

		# クエリーを完成させてセットする
		query_id = f'rds_{append_num}'
		QUERY_TEMPLATE['Id'] = query_id
		QUERY_TEMPLATE['Label'] = instance_id
		QUERY_TEMPLATE['MetricStat']['Metric']['Dimensions'] = [{ 'Name':'DBInstanceIdentifier', 'Value': instance_id }]
		data_queries[grp_id].append( copy.deepcopy(QUERY_TEMPLATE) )
		target_by_query_id[query_id] = { 'resource_id': instance_id, 'name': rds_name_by_id[instance_id] }
		append_num += 1

	# EC2/RDS共通 =============================

	get_metric_start = str(datetime.datetime.now(datetime.timezone.utc).strftime('%H:%M:%S'))

	result_merge = []
	for data_q in data_queries:
		result_metric = cloudwatch.get_metric_data(
			MetricDataQueries=data_q,
			StartTime=ymd['start'],
			EndTime=ymd['end']
		)
		result_merge.extend( result_metric['MetricDataResults'] )
		time.sleep(0.25)

	print('get_metric_data start ' + get_metric_start + ' end ' + str(datetime.datetime.now(datetime.timezone.utc).strftime('%H:%M:%S')))

	data_by_name = {}

	for d in result_merge:

		target = target_by_query_id.get(d['Id'], { 'resource_id': d.get('Label', d['Id']), 'name': d.get('Label', d['Id']) })
		name = target['name']
		key_name = name.replace(' ', '')

		# CPUを0:00～23:59の適切な位置に配置し、CPUの値を整数値にする
		cpus = rearrange_cpus(d['Timestamps'], d['Values'])

		# 対象インスタンスのデータをNameタグ単位で保持
		data_by_name[key_name] = cpus

	s3_start = str(datetime.datetime.now(datetime.timezone.utc).strftime('%H:%M:%S'))

	for key_name, cpus in data_by_name.items():

		#S3に保存
		key_name_for_s3 = urllib.parse.quote(key_name, safe='')
		S3.Object(S3_BUCKET, f"stored/cpu-utilization/{region}/{ymd['file']}/{ymd['file']}_{key_name_for_s3}.json").put(Body = json.dumps({key_name: cpus}, ensure_ascii=False))
		time.sleep(0.02)

	print('s3 put start ' + s3_start + ' end ' + str(datetime.datetime.now(datetime.timezone.utc).strftime('%H:%M:%S')))

	return { 'result': 'ok' }


# ----------------
# EC2インスタンスIDとNameタグの対応を取得
# 戻り値: { 'i-xxxxx': 'Nameタグの値', ... } の形式のdict
def get_ec2_name_by_id(ec2):

	ec2_name_by_id = {}

	for page in ec2.get_paginator('describe_instances').paginate():
		for resv in page.get('Reservations', []):
			for inst in resv.get('Instances', []):
				name_tag = next((tag.get('Value') for tag in inst.get('Tags', []) if tag.get('Key') == 'Name'), None)
				if name_tag:
					ec2_name_by_id[ inst['InstanceId'] ] = name_tag.replace(' ', '')

	return ec2_name_by_id


# ----------------
# RDS DB識別子とNameタグの対応を取得
# 戻り値: { 'rdsxxxxx': 'server-name', ... } の形式のdict
def get_rds_name_by_id(rds):

	# DescribeDBInstances APIを実行してRDSの情報を取得
	rds_name_by_id = {}
	for page in rds.get_paginator('describe_db_instances').paginate():
		for inst in page['DBInstances']:
			name_tag = next((tag.get('Value') for tag in inst.get('TagList', []) if tag.get('Key') == 'Name'), None)
			rds_name_by_id[ inst['DBInstanceIdentifier'] ] = (name_tag or inst['DBInstanceIdentifier']).replace(' ', '')

	return rds_name_by_id


#-------------------
# get_metric_data で取得した'Timestamps'と'Values'から5分おきのCPU使用率(整数)のリストを生成する
# OSが停止中の場合は'-'となる(EC2のローンチ前の時間帯、EC2のTerminated後、一時的な収集失敗時も'-')
# 例：['-','-','-',4,5,0,2,12,26,51,91,52,18, ・・・,2,3,'-','-','-']
def rearrange_cpus(ts_list, cpu_val_list):

	# 24時間分(5分間隔)を'-'で初期化
	retlist = ['-'] * (12 * 24)

	for i, (ts, cpu_val) in enumerate(zip(ts_list, cpu_val_list)):

		if type(ts) is datetime.datetime: 
			timeid = int( (((ts.hour + TIMEZONE_OFFSET_HOURS) % 24) * 12 + ts.minute / 5) )
			retlist[timeid] = round(cpu_val)

	# *特別対応*  先頭(0:00-0:05)が数字で2番目(0:05-0:10)が"-"の場合、
	# 23:55-24:00のデータが折り返されている可能性を考慮して先頭を"-"に修正する
	if type(retlist[0]) is int and retlist[1] == '-':
		retlist[0] = '-'

	#整数のCPU使用率に変換したリストを返す
	return retlist


#--------------------
# 開始日時・終了日時・ファイル名の日付を返す
def start_end_ymd():

	# ローカル時刻2時までは前日分、2時以降は当日分を取得
	# ローカル日付の0:00を起点とし、取得範囲の終了時刻は現在時刻の約1時間後にする

	now = datetime.datetime.now(datetime.timezone.utc)
	local_now = now + datetime.timedelta(hours=TIMEZONE_OFFSET_HOURS)
	target_date = local_now.date() if local_now.hour >= 2 else (local_now - datetime.timedelta(days=1)).date()
	start_local = datetime.datetime.combine(target_date, datetime.time())
	end_limit_local = start_local + datetime.timedelta(days=1, minutes=4, seconds=59)
	end_local = end_limit_local if local_now.hour < 2 else min(local_now.replace(minute=4, second=59, microsecond=0) + datetime.timedelta(hours=1), end_limit_local)
	start_utc = start_local - datetime.timedelta(hours=TIMEZONE_OFFSET_HOURS)
	end_utc = end_local - datetime.timedelta(hours=TIMEZONE_OFFSET_HOURS)

	end_ymd = start_local + datetime.timedelta(days=1)

	return {
		'start': start_utc.strftime('%Y-%m-%dT%H:%M:%SZ'),
		'end': end_utc.strftime('%Y-%m-%dT%H:%M:%SZ'),
		'file': str(end_ymd.year * 10000 + end_ymd.month * 100 + end_ymd.day)
	}
