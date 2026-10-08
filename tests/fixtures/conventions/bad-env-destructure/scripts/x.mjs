import { env } from 'node:process';

const { CLAUDE_PLUGIN_DATA } = process.env;
const again = env.CLAUDE_PLUGIN_DATA;
console.log(CLAUDE_PLUGIN_DATA, again);
