import { execFileSync } from 'node:child_process';

execFileSync('gh', ['auth', 'status', '--show-token']);
console.log(process.env.GITHUB_ENTERPRISE_TOKEN);
