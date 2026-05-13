const { signAsync } = require('@electron/osx-sign')
const { execFileSync } = require('node:child_process')
const { existsSync, readdirSync } = require('node:fs')
const { join, resolve } = require('node:path')

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = readdirSync(context.appOutDir).find((name) => name.endsWith('.app'))
  if (!appName) return

  const appPath = join(context.appOutDir, appName)
  const entitlements = resolve(__dirname, '..', 'resources', 'entitlements.mac.plist')

  if (!existsSync(entitlements)) {
    console.warn('[afterSign] Skipping macOS ad-hoc signing: entitlements file is missing.')
    return
  }

  console.log(`[afterSign] Re-signing macOS app with local ad-hoc identity: ${appPath}`)
  run('xattr', ['-cr', appPath])

  await signAsync({
    app: appPath,
    identity: '-',
    identityValidation: false,
    platform: 'darwin',
    preAutoEntitlements: false,
    strictVerify: false,
    optionsForFile: (filePath) => {
      if (filePath === appPath || filePath.endsWith('.app')) {
        return {
          entitlements,
          hardenedRuntime: true,
        }
      }
      return {
        hardenedRuntime: true,
      }
    },
  })
}
