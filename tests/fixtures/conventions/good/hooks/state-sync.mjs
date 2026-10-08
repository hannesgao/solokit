// Settings hooks may read their environment (PRD, Configuration and state).
const data = process.env.CLAUDE_PLUGIN_DATA;
console.log(data ? 'ok' : 'none');
