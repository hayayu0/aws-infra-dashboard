# record_start_stop_time.py
# EC2/RDSの起動時刻・停止時刻を取得　S3に保管する
# シングルアカウント。マルチリージョン対応
#
# トリガー:
# EventBridgeスケジューラで1分おきに実行の想定

import json
import datetime
import os
import re
import boto3
from botocore.exceptions import ClientError

S3_BUCKET = os.getenv('S3_BUCKET')
SUBDIR = (os.getenv('SUBDIR') or '').strip().strip('/')
LAMBDA_KEY_PREFIX = f'lambda/{SUBDIR}/' if SUBDIR else 'lambda/'

REGION_LIST = [
    x for x in re.split(r'[, ]+', os.getenv('REGION_LIST') or os.getenv('AWS_REGION') or 'ap-northeast-1')
    if re.match(r'^(us-(east|west)-[12]|ap-(northeast-[123]|southeast-[12]|south-1)|eu-(central-1|west-[123]|north-1)|ca-central-1|sa-east-1)$', x)
]

# RDS稼働扱いのステータス
RDS_RUNNING = r'(available|backing\-up|modifying|storage\-optimization)'

S3  = boto3.resource('s3')

# ----------------
# EC2インスタンスIDとNameタグの対応を取得
# 戻り値: { 'i-xxxxx': 'Nameタグの値', ... } の形式のdict
def get_ec2_name_by_id(ec2):

    ec2_name_by_id = {}

    for page in ec2.get_paginator('describe_instances').paginate():
        for resv in page.get('Reservations', []):
            for inst in resv.get('Instances', []):
                name_tag = (next((tag.get('Value') for tag in inst.get('Tags', []) if tag.get('Key') == 'Name'), None) or '')
                if name_tag:
                    ec2_name_by_id[ inst['InstanceId'] ] = name_tag

    return ec2_name_by_id


# ================
def lambda_handler(event, context):

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    now_hhmm = now_utc.strftime("%H%M")

    output = {}

    for region in REGION_LIST:
        # RDSは偶数分のみ
        target_services = ['ec2', 'rds'] if int(now_utc.strftime("%M")) % 2 == 0 else ['ec2']
        output[region] = {}

        for target_svc in target_services:
            try:
                output[region][target_svc] = record_service(region, target_svc, now_utc, now_hhmm)
            except Exception as e:
                output[region][target_svc] = f'{target_svc} failed. {format(e)}'

    print(output)

    return {'result': output }


# ----------------
# 指定リージョン・サービスの起動停止状態を記録
def record_service(region, target_svc, now_utc, now_hhmm):

    ec2 = boto3.client('ec2', region_name=region) if target_svc == 'ec2' else None
    rds = boto3.client('rds', region_name=region) if target_svc == 'rds' else None
    inst_list = []
    result_output = ''

    # 新しい日に切り替わって初回実行のフラグ
    new_day_flag = False

    # 起動・停止状態を記録するファイル
    yyyy, mm, mmdd = now_utc.strftime('%Y'), now_utc.strftime('%m'), now_utc.strftime('%m%d')
    s3_object_updown = f'{LAMBDA_KEY_PREFIX}record-start-stop-time/{region}/{yyyy}/{mm}/{yyyy}{mmdd}_{target_svc}_start_stop_time.json'

    # ステータスが変わったインスタンス数
    changed_num = 0

    # S3から 当日のjsonを取得
    try:
        s3response_updown = S3.Object(S3_BUCKET, s3_object_updown).get()
        today_json = json.loads(s3response_updown['Body'].read())

    except ClientError as e:

        if e.response.get('Error', {}).get('Code') == 'NoSuchKey':
            # オブジェクトが無いのは日付が変わったものとして新規作成
            today_json = {}
            new_day_flag = True
            result_output += 'new upload. '
        else:
            return f'{target_svc} skipped. {format(e)}'

    if ec2:
        # EC2固有処理

        ec2_name_by_id = get_ec2_name_by_id(ec2)

        # DescribeInstanceStatus APIを実行してEC2の情報を取得
        # Tips: IncludeAllInstances=True を付与しないと running インスタンスしか取得できない
        for page in ec2.get_paginator('describe_instance_status').paginate(IncludeAllInstances=True):
            inst_list.extend(page['InstanceStatuses'])

        for inst in inst_list:

            if inst['InstanceId'] not in ec2_name_by_id:
                continue

            # インスタンスIDではなくNameタグをキーとする
            storage_key = ec2_name_by_id[ inst['InstanceId'] ]
            resource_id = inst['InstanceId']

            # インスタンスの起動・停止状態を数値とする
            # 稼働(running)=1, 基盤側の障害=3, terminated=4, それ以外は停止とみなす=0
            if inst['SystemStatus']['Status'] == 'impaired':
                inst_status_code = 3
            elif inst['InstanceState']['Name'] == "running":
                inst_status_code = 1
            elif inst['InstanceState']['Name'] == "terminated":
                inst_status_code = 4
            else:
                inst_status_code = 0

            # jsonに対象インスタンスの記録が存在しない
            if storage_key not in today_json:
                today_json[storage_key] = {}

            if resource_id not in today_json[storage_key] or today_json[storage_key][resource_id].get('latest') == None:
                # 現在時刻＋latestを保存(初回)
                today_json[storage_key][resource_id] = { now_hhmm: inst_status_code, 'latest': inst_status_code }
                changed_num += 1

            # 最終記録の状態と、現在の状態が一致しない(＝状態が変わった)
            elif today_json[storage_key][resource_id]['latest'] != inst_status_code:
                # 現在時刻を記録、最終状況を更新
                today_json[storage_key][resource_id][now_hhmm] = today_json[storage_key][resource_id]['latest'] = inst_status_code
                changed_num += 1

    elif rds:
        # RDS固有処理

        # DescribeDBInstances APIを実行してRDSの情報を取得
        for page in rds.get_paginator('describe_db_instances').paginate():
            inst_list.extend(page['DBInstances'])

        for inst in inst_list:

            # RDS名 (Nameタグが無い場合は DBInstanceIdentifier を代替名とする)
            rds_name = next((tag.get('Value') for tag in inst.get('TagList', []) if tag.get('Key') == 'Name'), None)
            storage_key = (rds_name or '') or inst['DBInstanceIdentifier']
            resource_id = inst['DBInstanceIdentifier']

            # インスタンスの起動・停止状態を数値とする
            # 稼働系(running)=1, storage-full=2, それ以外は停止系とみなす=0
            rds_status_code = 1 if re.fullmatch(RDS_RUNNING, inst['DBInstanceStatus']) else 0
            rds_status_code = 2 if re.fullmatch(r'storage\-full', inst['DBInstanceStatus']) else rds_status_code

            # jsonに対象インスタンスの記録が存在
            if storage_key not in today_json:
                today_json[storage_key] = {}

            if resource_id in today_json[storage_key] and today_json[storage_key][resource_id].get('latest') != None:

                # 最終記録の状態と、現在の状態が一致しない(＝状態が変わった)
                if today_json[storage_key][resource_id]['latest'] != rds_status_code:
                    # 現在時刻を記録、最終状況を更新
                    today_json[storage_key][resource_id][now_hhmm] = today_json[storage_key][resource_id]['latest'] = rds_status_code
                    changed_num += 1

                # else:  => 状態が一致したら何もしない

            # jsonに対象インスタンスの記録が存在しない
            else:
                # 現在時刻＋latestを保存(初回)
                today_json[storage_key][resource_id] = { now_hhmm: rds_status_code, 'latest': rds_status_code }
                changed_num += 1

    # EC2/RDS固有処理ここまで

    # 新規ファイルもしくは更新があれば S3へjsonをアップロード
    if new_day_flag or changed_num > 0:
        S3.Object(S3_BUCKET, s3_object_updown).put(Body = json.dumps(today_json, ensure_ascii=False))
        result_output += f'{s3_object_updown} uploaded. '

    result_output += f'{target_svc} changed_num={changed_num} total_num={len(today_json)}'

    return result_output
