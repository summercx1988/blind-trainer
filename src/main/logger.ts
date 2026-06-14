import log from 'electron-log'
import path from 'path'

let isPackaged = false
let userDataPath = ''

try {
  const electron = require('electron')
  if (electron?.app) {
    isPackaged = electron.app.isPackaged ?? false
    userDataPath = electron.app.getPath('userData')
  }
} catch {
  isPackaged = false
}

if (userDataPath) {
  log.transports.file.resolvePathFn = () => {
    return path.join(userDataPath, 'logs', 'main.log')
  }
}

log.transports.file.maxSize = 5 * 1024 * 1024
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

const fileLogLevel = isPackaged ? 'info' : 'debug'
log.transports.file.level = fileLogLevel
log.transports.console.level = 'debug'

log.catchErrors({ showDialog: false })

if (userDataPath) {
  log.info('[Logger] Initialized', {
    fileLevel: fileLogLevel,
    logPath: path.join(userDataPath, 'logs', 'main.log'),
  })
}

export default log
