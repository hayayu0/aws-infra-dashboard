# record_start_stop_time.py
# EC2/RDSの起動時刻・停止時刻を取得　S3に保管
#
# トリガー:
# EventBridgeスケジューラ "record-start-stop-time"
# 1分おきに実行

import boto3
import json
import datetime
import os
import re
from botocore.exceptions import ClientError

# S3 bucket名、キー名
S3_BUCKET = os.getenv('S3_BUCKET')
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

# RDS稼働扱いのステータス(正規表現) 
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
                name_tag = next((tag.get('Value') for tag in inst.get('Tags', []) if tag.get('Key') == 'Name'), None)
                if name_tag:
                    ec2_name_by_id[ inst['InstanceId'] ] = name_tag.replace(' ', '')

    return ec2_name_by_id


# ================
# Lambda Handler
def lambda_handler(event, context):

    # ローカル日付として扱う時刻
    now = datetime.datetime.utcnow() + datetime.timedelta(hours=TIMEZONE_OFFSET_HOURS)
    now_hhmm = now.strftime("%H%M")

    output = {}

    for region in REGION_LIST:
        # RDSは偶数分のみ
        target_services = ['ec2', 'rds'] if int(now.strftime("%M")) % 2 == 0 else ['ec2']
        output[region] = {}

        for target_svc in target_services:
            try:
                output[region][target_svc] = record_service(region, target_svc, now, now_hhmm)
            except Exception as e:
                output[region][target_svc] = f'{target_svc} failed. {format(e)}'

    print(output)

    return {
        'result': output
    }


# ----------------
# 指定リージョン・サービスの起動停止状態を記録
def record_service(region, target_svc, now, now_hhmm):

    ec2 = boto3.client('ec2', region_name=region) if target_svc == 'ec2' else None
    rds = boto3.client('rds', region_name=region) if target_svc == 'rds' else None
    inst_list = []
    result_message = ''

    # 新しい日に切り替わって初回実行のフラグ
    new_day_flag = False

    # 起動・停止状態を記録するファイル
    yyyy, mmdd = now.strftime('%Y'), now.strftime('%m%d')
    s3_object_updown = f'lambda/record-start-stop-time/{region}/{yyyy}/{yyyy}{mmdd}_{target_svc}_updown.json'

    # ステータスが変わったインスタンスの数
    changed_num = 0

    # S3から 当日の yyyymmdd_updown.json を取得
    try:
        s3response_updown = S3.Object(S3_BUCKET, s3_object_updown).get()
        today_json = json.loads(s3response_updown['Body'].read())

    except ClientError as e:

        if e.response.get('ResponseMetadata', {}).get('HTTPStatusCode') == 404:
            # ファイル(オブジェクト)がS3に無いため日付が変わったとして新規作成
            today_json = {}
            new_day_flag = True
            result_message += 'new upload. '

        # オブジェクトが無い(＝新しい日付)以外のエラーは次へ
        else:
            return f'{target_svc} skipped. {format(e)}'

    #---------------------
    # EC2インスタンスごとにループ処理
    #---------------------
    if ec2:

        ec2_name_by_id = get_ec2_name_by_id(ec2)

        # DescribeInstanceStatus APIを実行してEC2の情報を取得 (1000台以上になったのでpagination)
        # IncludeAllInstances=True を付与しないと running インスタンスしか取得できないので必須で付与
        for page in ec2.get_paginator('describe_instance_status').paginate(IncludeAllInstances=True):
            inst_list.extend(page['InstanceStatuses'])

        for inst in inst_list:

            # APIで取得したインスタンスIDにNameタグが設定されているか
            # 満たしていない場合はローンチ直後と思われるため対象外としても問題なし
            if inst['InstanceId'] not in ec2_name_by_id:
                continue

            # Nameタグ(=コンピューター名)
            # インスタンスIDをキーにするとリストア時にデータの分断が起こるためNameタグをキーに
            tag_name = ec2_name_by_id[ inst['InstanceId'] ]

            # インスタンスの起動・停止状態を数値とする(running=1, HWエラー=3, terminated=4, それ以外=0)
            if inst['SystemStatus']['Status'] == 'impaired':
                inst_status_code = 3
            elif inst['InstanceState']['Name'] == "running":
                inst_status_code = 1
            elif inst['InstanceState']['Name'] == "terminated":
                inst_status_code = 4
            else:
                inst_status_code = 0

            # yyyyhhmm_ec2_updown.json に対象インスタンスの記録が存在しない
            if tag_name not in today_json or today_json[tag_name].get('latest') == None:
                # 現在時刻＋最終状況を記録(初回)
                today_json[tag_name] = { now_hhmm: inst_status_code, 'latest': inst_status_code }
                changed_num += 1

            # 最終記録の起動・停止状態と、現在の起動・停止状態が一致しない(＝状態が変わった)
            elif today_json[tag_name]['latest'] != inst_status_code:
                # 現在時刻を記録、最終状況を更新
                today_json[tag_name][now_hhmm] = today_json[tag_name]['latest'] = inst_status_code
                changed_num += 1

    #---------------------
    # RDSインスタンスごとにループ処理
    #---------------------
    elif rds:

        # DescribeDBInstances APIを実行してRDSの情報を取得
        for page in rds.get_paginator('describe_db_instances').paginate():
            inst_list.extend(page['DBInstances'])

        for inst in inst_list:

            # RDS名
            rds_name = next((tag.get('Value') for tag in inst.get('TagList', []) if tag.get('Key') == 'Name'), None) or inst['DBInstanceIdentifier']
            rds_name = rds_name.replace(' ', '')

            # 0=stopped扱い、1=running扱い、2=storage-full
            rds_status_code = 1 if re.fullmatch(RDS_RUNNING, inst['DBInstanceStatus']) else 0
            rds_status_code = 2 if re.fullmatch(r'storage\-full', inst['DBInstanceStatus']) else rds_status_code

            # yyyyhhmm_rds_updown.json に対象インスタンスの記録が存在
            if rds_name in today_json and today_json[rds_name].get('latest') != None:

                # 最終記録の起動・停止状態と、現在の起動・停止状態が一致しない(＝状態が変わった)
                if today_json[rds_name]['latest'] != rds_status_code:
                    # 現在時刻を記録＋最終状況を更新
                    today_json[rds_name][now_hhmm] = today_json[rds_name]['latest'] = rds_status_code
                    changed_num += 1

                # else:  ==> 状態が一致したら何もしない

            # yyyyhhmm_rds_updown.json に対象インスタンスの記録が存在しない
            else:
                # 現在時刻＋最終状況を記録(初回)
                today_json[rds_name] = { now_hhmm: rds_status_code, 'latest': rds_status_code }
                changed_num += 1

    #---------------------
    # EC2・RDS共通
    #---------------------

    # 新規ファイルもしくは更新があれば S3へ yyyyhhmm_ec2(or rds)_updown.json をアップロード
    if new_day_flag or changed_num > 0:
        S3.Object(S3_BUCKET, s3_object_updown).put(Body = json.dumps(today_json))
        result_message += s3_object_updown + ' uploaded. '

    result_message += target_svc + ' changed_num={} total_num={}'.format(changed_num, len(today_json))

    return result_message
