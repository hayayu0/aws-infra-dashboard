#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { GlobalStack } from '../lib/global-stack';
import { LocalStack } from '../lib/local-stack';

const app = new cdk.App();

const toolNamePrefix = readStringContext(app, 'toolNamePrefix', 'infra-dashboard');
const subDir = readStringContext(app, 'subDir', '');
const accountDisplayName = readStringContext(app, 'accountDisplayName', 'アカ1');
// additionalService: 未指定なら ['RDS']、空文字指定なら []（追加サービスなし）
const additionalServiceContext = app.node.tryGetContext('additionalService');
const additionalService = typeof additionalServiceContext === 'string'
  ? additionalServiceContext.split(',').map((item) => item.trim()).filter((item) => item !== '')
  : ['RDS'];
const regionalRegion = readStringContext(app, 'region', 'ap-northeast-1');
const regions = uniqueNonEmpty([regionalRegion, ...readStringListContext(app, 'otherRegions')]);
const timeZone = readStringContext(app, 'timeZone', 'Asia/Tokyo');

new LocalStack(app, `${toolNamePrefix}-local`, {
  toolNamePrefix,
  subDir,
  accountDisplayName,
  additionalService,
  regionalRegion,
  regions,
  timeZone,
  env: {
    region: regionalRegion,
  },
});

new GlobalStack(app, `${toolNamePrefix}-global`, {
  toolNamePrefix,
  env: {
    region: 'us-east-1',
  },
});

function readStringContext(app: cdk.App, key: string, defaultValue: string): string {
  const value = app.node.tryGetContext(key);
  return typeof value === 'string' && value.trim() !== '' ? value : defaultValue;
}

function readStringListContext(app: cdk.App, key: string): string[] {
  const value = app.node.tryGetContext(key);
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter((item) => item !== '');
  }
  return typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter((item) => item !== '') : [];
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))];
}
