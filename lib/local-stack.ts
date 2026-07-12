import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import { Construct } from 'constructs';
import { readLambdaSourceInlineCode } from './inline-lambda-code';

export interface LocalStackProps extends cdk.StackProps {
  toolNamePrefix: string;
  subDir: string;
  accountDisplayName: string;
  additionalService: string[];
  mainRegion: string;
  regions: string[];
  timeZone: string;
}

export class LocalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LocalStackProps) {
    super(scope, id, props);

    const cloudFrontDistributionArn = new cdk.CfnParameter(this, 'CloudFrontDistributionArn', {
      type: 'String',
      default: '',
      description:
        'CloudFront distribution ARN allowed to read S3 objects and invoke the Lambda function URL. Leave blank on the first deployment.',
    });
    const hasCloudFrontDistributionArn = new cdk.CfnCondition(this, 'HasCloudFrontDistributionArn', {
      expression: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(cloudFrontDistributionArn.valueAsString, '')),
    });

    const bucket = new cdk.aws_s3.CfnBucket(this, 'ToolBucket', {
      bucketName: cdk.Fn.sub(`${props.toolNamePrefix}-\${AWS::AccountId}`),
      publicAccessBlockConfiguration: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      bucketEncryption: {
        serverSideEncryptionConfiguration: [
          {
            serverSideEncryptionByDefault: {
              sseAlgorithm: 'AES256',
            },
          },
        ],
      },
    });

    const generatedConfigJs = this.generatedConfigJs(props.subDir, props.accountDisplayName, props.additionalService, props.regions);
    const webSourceAsset = new s3assets.Asset(this, 'WebSourceAsset', {
      path: path.join(process.cwd(), 'src', 'web'),
    });
    const webAssetsDeploymentRole = new cdk.aws_iam.Role(this, 'WebAssetsDeploymentRole', {
      assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    webAssetsDeploymentRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [cdk.Fn.join('/', [webSourceAsset.bucket.bucketArn, webSourceAsset.s3ObjectKey])],
      }),
    );
    webAssetsDeploymentRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [
          cdk.Fn.sub('${BucketArn}/web/*', {
            BucketArn: bucket.attrArn,
          }),
        ],
      }),
    );
    const webAssetsDeploymentFn = new cdk.aws_lambda.CfnFunction(this, 'WebAssetsDeploymentLambda', {
      code: {
        zipFile: this.webAssetsDeploymentInlineCode(),
      },
      functionName: `${props.toolNamePrefix}-deploy-web-assets`,
      handler: 'index.lambda_handler',
      memorySize: 256,
      role: webAssetsDeploymentRole.roleArn,
      runtime: 'python3.14',
      timeout: 300,
    });
    webAssetsDeploymentFn.node.addDependency(webAssetsDeploymentRole);

    const webAssetsDeployment = new cdk.CfnResource(this, 'WebAssetsDeployment', {
      type: 'Custom::WebAssetsDeployment',
      properties: {
        ServiceToken: webAssetsDeploymentFn.attrArn,
        SourceBucket: webSourceAsset.s3BucketName,
        SourceKey: webSourceAsset.s3ObjectKey,
        DestinationBucket: bucket.ref,
        ConfigBody: generatedConfigJs,
        DeploymentHash: this.contentHash(`${webSourceAsset.assetHash}:${generatedConfigJs}`),
      },
    });
    webAssetsDeployment.node.addDependency(bucket);
    webAssetsDeployment.node.addDependency(webAssetsDeploymentFn);

    const role = new cdk.aws_iam.CfnRole(this, 'DescribeApiLambdaRole', {
      roleName: `${props.toolNamePrefix}-lambda-role`,
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: ['lambda.amazonaws.com'],
            },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      managedPolicyArns: [
        'arn:aws:iam::aws:policy/ReadOnlyAccess',
        'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      ],
      policies: [
        {
          policyName: 'cache-bucket-access',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['s3:GetObject', 's3:PutObject'],
                Resource: cdk.Fn.sub('${BucketArn}/*', {
                  BucketArn: bucket.attrArn,
                }),
              },
              {
                Effect: 'Allow',
                Action: ['s3:ListBucket'],
                Resource: bucket.attrArn,
              },
            ],
          },
        },
      ],
    });

    const describeFn = new cdk.aws_lambda.CfnFunction(this, 'DescribeApiLambda', {
      code: {
        zipFile: readLambdaSourceInlineCode('describe_api.py'),
      },
      environment: {
        variables: {
          source_cidr_list: '0.0.0.0/0 ::/0',
          s3_bucket: bucket.ref,
          default_region: props.mainRegion,
          SUBDIR: props.subDir,
        },
      },
      functionName: `${props.toolNamePrefix}-describe-api`,
      handler: 'index.lambda_handler',
      memorySize: 256,
      role: role.attrArn,
      runtime: 'python3.14',
      timeout: 59,
    });

    describeFn.addDependency(role);

    const functionUrl = new cdk.aws_lambda.CfnUrl(this, 'LambdaUrl', {
      authType: 'AWS_IAM',
      cors: {
        allowCredentials: false,
        allowHeaders: ['content-type'],
        allowMethods: ['GET', 'HEAD'],
        allowOrigins: ['*'],
        exposeHeaders: ['last-modified'],
      },
      targetFunctionArn: describeFn.attrArn,
    });

    const bucketPolicy = new cdk.aws_s3.CfnBucketPolicy(this, 'WebBucketPolicy', {
      bucket: bucket.ref,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'cloudfront.amazonaws.com',
            },
            Action: 's3:GetObject',
            Resource: cdk.Fn.sub('${BucketArn}/*', {
              BucketArn: bucket.attrArn,
            }),
            Condition: {
              StringEquals: {
                'AWS:SourceArn': cloudFrontDistributionArn.valueAsString,
              },
            },
          },
        ],
      },
    });
    bucketPolicy.cfnOptions.condition = hasCloudFrontDistributionArn;

    const urlPermission = new cdk.aws_lambda.CfnPermission(this, 'DescribeApiLambdaUrlPermission', {
      action: 'lambda:InvokeFunctionUrl',
      functionName: describeFn.attrArn,
      functionUrlAuthType: 'AWS_IAM',
      principal: 'cloudfront.amazonaws.com',
      sourceArn: cloudFrontDistributionArn.valueAsString,
    });
    urlPermission.cfnOptions.condition = hasCloudFrontDistributionArn;

    const invokePermission = new cdk.aws_lambda.CfnPermission(this, 'DescribeApiLambdaInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: describeFn.attrArn,
      invokedViaFunctionUrl: true,
      principal: 'cloudfront.amazonaws.com',
      sourceArn: cloudFrontDistributionArn.valueAsString,
    });
    invokePermission.cfnOptions.condition = hasCloudFrontDistributionArn;

    const recordTimeFn = this.createInlinePythonFunction('RecordTimeLambda', {
      code: readLambdaSourceInlineCode('record_start_stop_time.py'),
      functionName: `${props.toolNamePrefix}-record-time`,
      roleArn: role.attrArn,
      timeout: 30,
      environment: {
        S3_BUCKET: bucket.ref,
        SUBDIR: props.subDir,
        REGION_LIST: props.regions.join(','),
      },
    });
    recordTimeFn.addDependency(role);

    const recordCpuFn = this.createInlinePythonFunction('RecordCpuLambda', {
      code: readLambdaSourceInlineCode('record_cpu_utilization.py'),
      functionName: `${props.toolNamePrefix}-record-cpu`,
      roleArn: role.attrArn,
      timeout: 30,
      environment: {
        S3_BUCKET: bucket.ref,
        SUBDIR: props.subDir,
        REGION_LIST: props.regions.join(','),
      },
    });
    recordCpuFn.addDependency(role);

    const describeTarget = cdk.aws_lambda.Function.fromFunctionArn(this, 'DescribeApiScheduleTarget', describeFn.attrArn);
    const recordTimeTarget = cdk.aws_lambda.Function.fromFunctionArn(this, 'RecordTimeScheduleTarget', recordTimeFn.attrArn);
    const recordCpuTarget = cdk.aws_lambda.Function.fromFunctionArn(this, 'RecordCpuScheduleTarget', recordCpuFn.attrArn);

    const scheduleTimeZone = cdk.TimeZone.of(props.timeZone);
    const emptyPayload = scheduler.ScheduleTargetInput.fromObject({});
    new scheduler.Schedule(this, 'RecordTimeSchedule', {
      scheduleName: `${props.toolNamePrefix}-record-time`,
      schedule: scheduler.ScheduleExpression.rate(cdk.Duration.minutes(1)),
      target: new schedulerTargets.LambdaInvoke(recordTimeTarget, {
        input: emptyPayload,
      }),
      timeWindow: scheduler.TimeWindow.off(),
    });

    new scheduler.Schedule(this, 'RecordCpuSchedule', {
      scheduleName: `${props.toolNamePrefix}-record-cpu`,
      schedule: scheduler.ScheduleExpression.rate(cdk.Duration.minutes(10)),
      target: new schedulerTargets.LambdaInvoke(recordCpuTarget, {
        input: emptyPayload,
      }),
      timeWindow: scheduler.TimeWindow.off(),
    });

    props.regions.forEach((regionName) => {
      const regionId = this.regionConstructId(regionName);
      new scheduler.Schedule(this, `DescribeInstancesSchedule${regionId}`, {
        scheduleName: `${props.toolNamePrefix}-describe-api-ec2-describe-${regionName}`,
        schedule: scheduler.ScheduleExpression.cron({
          minute: '55',
          hour: '0,4,8,12,16,20',
          timeZone: scheduleTimeZone,
        }),
        target: new schedulerTargets.LambdaInvoke(describeTarget, {
          input: scheduler.ScheduleTargetInput.fromObject(
            this.describeApiSchedulerPayload('ec2:describe_instances', regionName),
          ),
        }),
        timeWindow: scheduler.TimeWindow.off(),
      });

      new scheduler.Schedule(this, `DescribeDbInstancesSchedule${regionId}`, {
        scheduleName: `${props.toolNamePrefix}-describe-api-rds-describe-${regionName}`,
        schedule: scheduler.ScheduleExpression.cron({
          minute: '55',
          hour: '0,4,8,12,16,20',
          timeZone: scheduleTimeZone,
        }),
        target: new schedulerTargets.LambdaInvoke(describeTarget, {
          input: scheduler.ScheduleTargetInput.fromObject(
            this.describeApiSchedulerPayload('rds:describe_db_instances', regionName),
          ),
        }),
        timeWindow: scheduler.TimeWindow.off(),
      });
    });

    new cdk.CfnOutput(this, 'ToolBucketName', {
      value: bucket.ref,
    });
  }

  private createInlinePythonFunction(
    id: string,
    props: {
      code: string;
      functionName: string;
      roleArn: string;
      timeout: number;
      environment: Record<string, string>;
    },
  ): cdk.aws_lambda.CfnFunction {
    return new cdk.aws_lambda.CfnFunction(this, id, {
      code: {
        zipFile: props.code,
      },
      environment: {
        variables: props.environment,
      },
      functionName: props.functionName,
      handler: 'index.lambda_handler',
      memorySize: 256,
      role: props.roleArn,
      runtime: 'python3.14',
      timeout: props.timeout,
    });
  }

  private generatedConfigJs(subDir: string, accountDisplayName: string, additionalService: string[], regions: string[]): string {
    const configPath = path.join(process.cwd(), 'src', 'web', 'script', 'config.js');
    const source = fs.readFileSync(configPath, 'utf8');
    const regionsSource = regions.map((region) => JSON.stringify(region)).join(', ');
    const additionalServiceSource = additionalService.length > 0 ? `[ ${additionalService.map((service) => JSON.stringify(service)).join(', ')} ]` : '[]';

    const replaceOrThrow = (text: string, pattern: RegExp, replacement: (prefix: string) => string, label: string): string => {
      if (!pattern.test(text)) {
        throw new Error(`src/web/script/config.js pattern not found: ${label}`);
      }
      return text.replace(pattern, (_match, prefix) => replacement(prefix));
    };

    let text = source;
    text = replaceOrThrow(text, /("accountName"\s*:\s*)"[^"]*"/, (prefix) => `${prefix}${JSON.stringify(accountDisplayName)}`, 'accounts accountName');
    text = replaceOrThrow(text, /("additionalService"\s*:\s*)\[[^\]]*\]/, (prefix) => `${prefix}${additionalServiceSource}`, 'accounts additionalService');
    text = replaceOrThrow(text, /("regions"\s*:\s*)\[[^\]]*\]/, (prefix) => `${prefix}[ ${regionsSource} ]`, 'accounts regions');
    text = replaceOrThrow(text, /("subDir"\s*:\s*)"[^"]*"/, (prefix) => `${prefix}${JSON.stringify(subDir)}`, 'accounts subDir');
    return text;
  }

  private contentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  private webAssetsDeploymentInlineCode(): string {
    return `
import json
import os
import urllib.request
import zipfile

import boto3

s3 = boto3.client('s3')

CONTENT_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
}


def response(event, context, status, data=None, reason=None):
    body = json.dumps({
        'Status': status,
        'Reason': reason or f'See CloudWatch Logs: {context.log_stream_name}',
        'PhysicalResourceId': event.get('PhysicalResourceId') or f"web-assets-{event['ResourceProperties']['DeploymentHash']}",
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'NoEcho': False,
        'Data': data or {},
    }).encode('utf-8')
    request = urllib.request.Request(
        event['ResponseURL'],
        data=body,
        method='PUT',
        headers={'content-type': '', 'content-length': str(len(body))},
    )
    urllib.request.urlopen(request, timeout=10).read()


def content_type(key):
    return CONTENT_TYPES.get(os.path.splitext(key.lower())[1], 'application/octet-stream')


def lambda_handler(event, context):
    try:
        if event.get('RequestType') == 'Delete':
            response(event, context, 'SUCCESS', {'UploadedFiles': 0})
            return

        props = event['ResourceProperties']
        source_zip = '/tmp/web.zip'
        s3.download_file(props['SourceBucket'], props['SourceKey'], source_zip)

        uploaded = 0
        with zipfile.ZipFile(source_zip) as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                rel_path = info.filename.replace('\\\\', '/')
                if rel_path == 'script/config.js':
                    continue
                s3.put_object(
                    Bucket=props['DestinationBucket'],
                    Key=f'web/{rel_path}',
                    Body=archive.read(info),
                    ContentType=content_type(rel_path),
                )
                uploaded += 1

        s3.put_object(
            Bucket=props['DestinationBucket'],
            Key='web/script/config.js',
            Body=props['ConfigBody'].encode('utf-8'),
            ContentType='application/javascript; charset=utf-8',
        )
        response(event, context, 'SUCCESS', {'UploadedFiles': uploaded + 1})
    except Exception as exc:
        response(event, context, 'FAILED', reason=str(exc))
`;
  }

  private regionConstructId(regionName: string): string {
    const id = regionName
      .split(/[^A-Za-z0-9]/)
      .filter((part) => part !== '')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
    return id || 'Default';
  }

  private describeApiSchedulerPayload(api: string, regionName: string): Record<string, unknown> {
    return {
      requestContext: {
        http: {
          sourceIp: '0.0.0.0',
        },
      },
      queryStringParameters: {
        api,
        region: regionName,
        logonly: '1',
      },
    };
  }
}
