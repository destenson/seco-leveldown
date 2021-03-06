import { inherits } from 'util'
import { gzip, gunzip } from './gzip'
import { AbstractLevelDOWN } from 'abstract-leveldown'
import SecoIterator from './iterator'
import createSecoRW from 'seco-rw'
import exists from 'path-exists'
import PQueue from 'p-queue'
import pWaitFor from 'p-wait-for'

// constructor, passes through the 'location' argument to the AbstractLevelDOWN constructor
function SecoDOWN (location) {
  if (!(this instanceof SecoDOWN)) return new SecoDOWN(location)
  this._writeQueue = new PQueue({ concurrency: 1 })
  AbstractLevelDOWN.call(this, location)
}

SecoDOWN.prototype._open = function (opts, cb) {
  callback(async () => {
    // If the password isn't set, default to an empty Buffer
    // Needs to be this way for testing
    opts.passphrase = opts.passphrase || Buffer.from('')
    this._seco = createSecoRW(this.location, opts.passphrase, opts.header)
    if (!await exists(this.location)) {
      if (!opts.createIfMissing) throw new Error(`${this.location} does not exist`)
      await this._seco.write(await gzip('{}'))
      this._data = {}
    } else {
      if (opts.errorIfExists) throw new Error('Database file exists and opts.errorIfExists is true')
      this._data = JSON.parse(await gunzip(await this._seco.read()))
    }
  }, cb)
}

SecoDOWN.prototype._close = function (cb) {
  callback(async () => {
    await pWaitFor(() => this._writeQueue.size === 0 && this._writeQueue.pending === 0)
    this._seco.destroy()
  }, cb)
}

// Internal Function
SecoDOWN.prototype._write = async function () {
  await this._writeQueue.add(async () => await this._seco.write(await gzip(JSON.stringify(this._data))))
}

SecoDOWN.prototype._put = function (key, val, opts, cb) {
  callback(async () => {
    if (typeof val === 'undefined' || val === null) val = ''
    this._data[key] = val
    await this._write()
  }, cb)
}

SecoDOWN.prototype._get = function (key, opts, cb) {
  callback(async () => {
    let val = this._data[key]
    if (typeof val === 'undefined') throw new Error('NotFound')
    if (opts.asBuffer !== false && !Buffer.isBuffer(val)) val = Buffer.from(String(val))
    return val
  }, cb)
}

SecoDOWN.prototype._del = function (key, opts, cb) {
  callback(async () => {
    delete this._data[key]
    await this._write()
  }, cb)
}

SecoDOWN.prototype._batch = function (operations, opts, cb) {
  // Not sure if this is fully atomic
  // If there is a get call right after a batch call...
  callback(async () => {
    operations.forEach(op => {
      if (op.type === 'put') {
        if (typeof op.value === 'undefined' || op.value === null) op.value = ''
        this._data[op.key] = op.value
      } else if (op.type === 'del') {
        delete this._data[op.key]
      } else throw new Error(`Invalid type ${op.type}`)
    })
    await this._write()
  }, cb)
}

SecoDOWN.prototype._iterator = function (opts) {
  return new SecoIterator(this, opts)
}

// our new prototype inherits from AbstractLevelDOWN
inherits(SecoDOWN, AbstractLevelDOWN)

module.exports = SecoDOWN

function callback (fn, cb) {
  fn().then(r => cb(null, r)).catch(cb)
}
