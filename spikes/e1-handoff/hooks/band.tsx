// Spike E1: three ways a mod can hand a slash command over to a plugin skill.
// Each attempt and its outcome is appended to .spike/e1-mod-log.json.
import type { EngineInterface, Register } from 'claude-code'

const LOG = '.spike/e1-mod-log.json'
const TARGET = 'solokit-e1:go'

type Way = '1' | '2' | '3'
const NAMES: Record<Way, string> = { '1': 'submit', '2': 'run', '3': 'fill' }

async function log($: EngineInterface, entry: Record<string, unknown>) {
  let entries: unknown[] = []
  try {
    entries = JSON.parse(await $.fs.read(LOG))
  } catch {}
  entries.push({ at: new Date(await $.clock.now()).toISOString(), ...entry })
  await $.fs.write(LOG, `${JSON.stringify(entries, null, 2)}\n`)
}

// Not awaited by callers: a hand-off must not hold the hook or press it came from.
function handOff($: EngineInterface, way: Way, from: string) {
  const args = `from-${from}-${NAMES[way]}`
  const started = log($, { from, way: NAMES[way], args, phase: 'called' })
  const call =
    way === '1'
      ? $.prompt.submit({ text: `/${TARGET} ${args}`, asUser: true })
      : way === '2'
        ? $.command.run({ command: TARGET, args })
        : $.prompt.fill({ text: `/${TARGET} ${args}` })
  void Promise.resolve(call).then(
    result => started.then(() => log($, { from, way: NAMES[way], phase: 'resolved', result })),
    error => started.then(() => log($, { from, way: NAMES[way], phase: 'rejected', error: String(error) })),
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'solokit',
      description: 'Spike E1: hand off to /solokit-e1:go (1 submit, 2 run, 3 fill)',
      argumentHint: '[1|2|3]',
    })
    const commands = await $.command.list()
    await log($, {
      phase: 'session.start',
      commands: commands.filter(c => c.name.includes('solokit')),
    })
    return next(e)
  })

  on('command.run', { command: 'solokit' }, async ($, e) => {
    const way = e.args.trim()
    if (way !== '1' && way !== '2' && way !== '3') {
      return { text: 'usage: /solokit 1|2|3 (1 prompt.submit asUser, 2 command.run, 3 prompt.fill)' }
    }
    handOff($, way, 'cmd')
    return { text: `E1 mod: /solokit ${way} handed off via ${NAMES[way]}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>E1 spike </Text>
        <Button key="submit" label="submit" hotkey="1" onPress={() => handOff($, '1', 'band')} />
        <Button key="run" label="run" hotkey="2" onPress={() => handOff($, '2', 'band')} />
        <Button key="fill" label="fill" hotkey="3" onPress={() => handOff($, '3', 'band')} />
      </Box>
    )
  })
}
