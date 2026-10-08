import { main } from './lib/cli.mjs';

main({ data: true }, cli => ({ data: cli.data }));
