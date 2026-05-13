const { execFileSync } = require('node:child_process')
const { readdirSync } = require('node:fs')
const { join } = require('node:path')

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = readdirSync(context.appOutDir).find((name) => name.endsWith('.app'))
  if (!appName) return

  const appPath = join(context.appOutDir, appName)

  console.log(`[afterPack] 清理 macOS 扩展属性: ${appPath}`)
  run('xattr', ['-cr', appPath])
}
