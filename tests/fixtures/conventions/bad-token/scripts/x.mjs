import { execFileSync } from 'node:child_process';

const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' });
console.log(token.length);
