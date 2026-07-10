import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface GlobalStackProps extends cdk.StackProps {
  toolNamePrefix: string;
}

export class GlobalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GlobalStackProps) {
    super(scope, id, props);

    const toolBucketName = new cdk.CfnParameter(this, 'ToolBucketName', {
      type: 'String',
      description: 'S3 bucket name from the local stack output.',
    });
    const toolBucketRegion = new cdk.CfnParameter(this, 'ToolBucketRegion', {
      type: 'String',
      default: 'ap-northeast-1',
      allowedPattern: '[a-z]{2}-[a-z]+-[0-9]',
      description: 'AWS region where the tool S3 bucket exists.',
    });
    const enableIpAllowList = new cdk.CfnParameter(this, 'EnableIpAllowList', {
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
      description:
        'Set true to enable WAF IP allowlist mode. Leave false to allow all source IPs even if CIDR parameters have values.',
    });
    const allowedIpV4Cidr = new cdk.CfnParameter(this, 'AllowedIpV4Cidr', {
      type: 'String',
      default: '',
      allowedPattern: '(^$|([0-9]{1,3}\\.){3}[0-9]{1,3}/[0-9]{1,2}(,([0-9]{1,3}\\.){3}[0-9]{1,3}/[0-9]{1,2})*)',
      description: 'Optional comma-separated IPv4 CIDRs allowed by CloudFront WAF.',
    });
    const allowedIpV6Cidr = new cdk.CfnParameter(this, 'AllowedIpV6Cidr', {
      type: 'String',
      default: '',
      allowedPattern: '(^$|[0-9a-fA-F:]+/[0-9]{1,3}(,[0-9a-fA-F:]+/[0-9]{1,3})*)',
      description: 'Optional comma-separated IPv6 CIDRs allowed by CloudFront WAF.',
    });

    const lambdaFunctionUrl = new cdk.CfnParameter(this, 'LambdaFunctionUrl', {
      type: 'String',
      description: 'Lambda function URL for /api*.',
    });

    const isIpAllowListEnabled = new cdk.CfnCondition(this, 'IsIpAllowListEnabled', {
      expression: cdk.Fn.conditionEquals(enableIpAllowList.valueAsString, 'true'),
    });
    const hasAllowedIpV4Cidr = new cdk.CfnCondition(this, 'HasAllowedIpV4Cidr', {
      expression: cdk.Fn.conditionAnd(
        isIpAllowListEnabled,
        cdk.Fn.conditionNot(cdk.Fn.conditionEquals(allowedIpV4Cidr.valueAsString, '')),
      ),
    });
    const hasAllowedIpV6Cidr = new cdk.CfnCondition(this, 'HasAllowedIpV6Cidr', {
      expression: cdk.Fn.conditionAnd(
        isIpAllowListEnabled,
        cdk.Fn.conditionNot(cdk.Fn.conditionEquals(allowedIpV6Cidr.valueAsString, '')),
      ),
    });
    const hasAnyAllowedIpCidr = new cdk.CfnCondition(this, 'HasAnyAllowedIpCidr', {
      expression: cdk.Fn.conditionOr(hasAllowedIpV4Cidr, hasAllowedIpV6Cidr),
    });

    const lambdaUrlOac = new cdk.aws_cloudfront.CfnOriginAccessControl(this, 'LambdaUrlOac', {
      originAccessControlConfig: {
        name: cdk.Fn.sub('${AWS::StackName}-lambda-url-oac'),
        originAccessControlOriginType: 'lambda',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });

    const webBucketOac = new cdk.aws_cloudfront.CfnOriginAccessControl(this, 'WebBucketOac', {
      originAccessControlConfig: {
        name: cdk.Fn.sub('${AWS::StackName}-web-bucket-oac'),
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });

    const allowedIpV4Set = new cdk.aws_wafv2.CfnIPSet(this, 'AllowedIpV4Set', {
      name: cdk.Fn.sub('${AWS::StackName}-allowed-ipv4'),
      scope: 'CLOUDFRONT',
      ipAddressVersion: 'IPV4',
      addresses: cdk.Fn.split(',', allowedIpV4Cidr.valueAsString),
    });
    allowedIpV4Set.cfnOptions.condition = hasAllowedIpV4Cidr;

    const allowedIpV6Set = new cdk.aws_wafv2.CfnIPSet(this, 'AllowedIpV6Set', {
      name: cdk.Fn.sub('${AWS::StackName}-allowed-ipv6'),
      scope: 'CLOUDFRONT',
      ipAddressVersion: 'IPV6',
      addresses: cdk.Fn.split(',', allowedIpV6Cidr.valueAsString),
    });
    allowedIpV6Set.cfnOptions.condition = hasAllowedIpV6Cidr;

    const webAcl = new cdk.aws_wafv2.CfnWebACL(this, 'ToolWebAcl', {
      name: cdk.Fn.sub('${AWS::StackName}-web-acl'),
      scope: 'CLOUDFRONT',
      defaultAction: cdk.Fn.conditionIf(hasAnyAllowedIpCidr.logicalId, { Block: {} }, { Allow: {} }),
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: cdk.Fn.sub('${AWS::StackName}-web-acl'),
        sampledRequestsEnabled: true,
      },
      rules: [
        cdk.Fn.conditionIf(
          hasAllowedIpV4Cidr.logicalId,
          {
            Name: 'AllowListedSourceIpv4',
            Priority: 10,
            Action: { Allow: {} },
            Statement: {
              IPSetReferenceStatement: {
                ARN: allowedIpV4Set.attrArn,
              },
            },
            VisibilityConfig: {
              CloudWatchMetricsEnabled: true,
              MetricName: 'AllowListedSourceIpv4',
              SampledRequestsEnabled: true,
            },
          },
          cdk.Aws.NO_VALUE,
        ),
        cdk.Fn.conditionIf(
          hasAllowedIpV6Cidr.logicalId,
          {
            Name: 'AllowListedSourceIpv6',
            Priority: 11,
            Action: { Allow: {} },
            Statement: {
              IPSetReferenceStatement: {
                ARN: allowedIpV6Set.attrArn,
              },
            },
            VisibilityConfig: {
              CloudWatchMetricsEnabled: true,
              MetricName: 'AllowListedSourceIpv6',
              SampledRequestsEnabled: true,
            },
          },
          cdk.Aws.NO_VALUE,
        ),
      ],
    });

    const webBucketDomainName = cdk.Fn.sub('${BucketName}.s3.${BucketRegion}.amazonaws.com', {
      BucketName: toolBucketName.valueAsString,
      BucketRegion: toolBucketRegion.valueAsString,
    });

    const origins: cdk.aws_cloudfront.CfnDistribution.OriginProperty[] = [
      {
        id: 'web-bucket-origin',
        domainName: webBucketDomainName,
        originPath: '/web',
        originAccessControlId: webBucketOac.ref,
        s3OriginConfig: {
          originAccessIdentity: '',
        },
      },
      {
        id: 'data-bucket-origin',
        domainName: webBucketDomainName,
        originAccessControlId: webBucketOac.ref,
        s3OriginConfig: {
          originAccessIdentity: '',
        },
      },
      {
        id: 'lambda-url-origin',
        domainName: cdk.Fn.select(2, cdk.Fn.split('/', lambdaFunctionUrl.valueAsString)),
        originAccessControlId: lambdaUrlOac.ref,
        customOriginConfig: {
          httpsPort: 443,
          originProtocolPolicy: 'https-only',
          originSslProtocols: ['TLSv1.2'],
        },
      },
    ];

    const cacheBehaviors: cdk.aws_cloudfront.CfnDistribution.CacheBehaviorProperty[] = [
      {
        pathPattern: 'api*',
        targetOriginId: 'lambda-url-origin',
        viewerProtocolPolicy: 'redirect-to-https',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD'],
        compress: false,
        cachePolicyId: cdk.aws_cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId,
        originRequestPolicyId: cdk.aws_cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId,
      },
      {
        pathPattern: 'stored*',
        targetOriginId: 'data-bucket-origin',
        viewerProtocolPolicy: 'redirect-to-https',
        allowedMethods: ['GET', 'HEAD'],
        cachedMethods: ['GET', 'HEAD'],
        compress: true,
        cachePolicyId: cdk.aws_cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId,
        originRequestPolicyId: cdk.aws_cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId,
        responseHeadersPolicyId: cdk.aws_cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT.responseHeadersPolicyId,
      },
      {
        pathPattern: 'lambda*',
        targetOriginId: 'data-bucket-origin',
        viewerProtocolPolicy: 'redirect-to-https',
        allowedMethods: ['GET', 'HEAD'],
        cachedMethods: ['GET', 'HEAD'],
        compress: true,
        cachePolicyId: cdk.aws_cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId,
        originRequestPolicyId: cdk.aws_cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId,
        responseHeadersPolicyId: cdk.aws_cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT.responseHeadersPolicyId,
      },
      {
        pathPattern: 'web/*',
        targetOriginId: 'data-bucket-origin',
        viewerProtocolPolicy: 'redirect-to-https',
        allowedMethods: ['GET', 'HEAD'],
        cachedMethods: ['GET', 'HEAD'],
        compress: true,
        cachePolicyId: cdk.aws_cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId,
        originRequestPolicyId: cdk.aws_cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId,
        responseHeadersPolicyId: cdk.aws_cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT.responseHeadersPolicyId,
      },
    ];

    const distribution = new cdk.aws_cloudfront.CfnDistribution(this, 'ToolDistribution', {
      distributionConfig: {
        comment: cdk.Fn.sub('${AWS::StackName} EC2/RDS Stat'),
        enabled: true,
        defaultRootObject: 'index.html',
        httpVersion: 'http2and3',
        priceClass: 'PriceClass_200',
        restrictions: {
          geoRestriction: {
            restrictionType: 'whitelist',
            locations: ['JP'],
          },
        },
        webAclId: webAcl.attrArn,
        origins,
        defaultCacheBehavior: {
          targetOriginId: 'web-bucket-origin',
          viewerProtocolPolicy: 'redirect-to-https',
          allowedMethods: ['GET', 'HEAD'],
          cachedMethods: ['GET', 'HEAD'],
          compress: true,
          cachePolicyId: cdk.aws_cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId,
          originRequestPolicyId: cdk.aws_cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId,
          responseHeadersPolicyId: cdk.aws_cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT.responseHeadersPolicyId,
        },
        cacheBehaviors,
      },
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.ref,
    });
    new cdk.CfnOutput(this, 'CloudFrontDistributionArn', {
      value: cdk.Fn.sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${DistributionId}', {
        DistributionId: distribution.ref,
      }),
    });
    new cdk.CfnOutput(this, 'ToolUrl', {
      value: cdk.Fn.sub('https://${DomainName}/', {
        DomainName: distribution.attrDomainName,
      }),
    });
    new cdk.CfnOutput(this, 'SampleApiUrl', {
      value: cdk.Fn.sub('https://${DomainName}/api?api=ec2:describe_availability_zones', {
        DomainName: distribution.attrDomainName,
      }),
    });
  }
}
