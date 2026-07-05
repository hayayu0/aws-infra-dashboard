import * as fs from 'fs';
import * as path from 'path';

const lambdaSourcePath = path.join(process.cwd(), 'src', 'lambda-python');

export function readLambdaSourceInlineCode(fileName: string): string {
  const sourcePath = path.join(lambdaSourcePath, fileName);
  const code = fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '');
  if (code.trim() === '') {
    throw new Error(`Lambda source code is empty: ${sourcePath}`);
  }
  return code;
}
