import log from 'electron-log'
import { app } from 'electron'
import path from 'path'

log.transports.file.resolvePathFn = () => {
  return path.join(app.getPath('userData'), 'logs', 'main.log')
}

log.transports.file.maxSize = 5 * 1024 * 1024
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

const fileLogLevel = app.isPackaged ? 'info' : 'debug'
log.transports.file.level = fileLogLevel
log.transports.console.level = 'debug'

log.catchErrors({ showDialog: false })

log.info('[Logger] Initialized', {
  fileLevel: fileLogLevel,
  logPath: path.join(app.getPath('userData'), 'logs', 'main.log'),
})

export default log
