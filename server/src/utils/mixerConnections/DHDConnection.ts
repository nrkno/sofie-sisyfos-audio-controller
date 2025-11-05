import { WebSocket } from 'ws'
import { store, state } from '../../reducers/store'
import { remoteConnections } from '../../mainClasses'

//Utils:
import {
  FxParam,
  MixerProtocol,
} from '../../../../shared/src/constants/MixerProtocolInterface'
import { FaderActionTypes } from '../../../../shared/src/actions/faderActions'
import { logger } from '../logger'
import { SettingsActionTypes } from '../../../../shared/src/actions/settingsActions'
import { ChannelActionTypes } from '../../../../shared/src/actions/channelActions'
import { EmberElement, NumberedTreeNode } from 'emberplus-connection/dist/model'
import { MixerConnection } from '.'
import { response } from 'express'
import { EventEmitter } from 'stream'
import { addAbortListener } from 'events'
import { floatToDB } from './LawoRubyConnection'

export class DHDMixerConnection implements MixerConnection {
  mixerProtocol: MixerProtocol
  mixerIndex: number
  dhdMixerId: string
  dhdConnection: DHDWebSocketClient
  sourceIdToFaderId = new Map<number, string>()
  sisyfosChannelIdToDHDTargets = new Map<number, {
    faderId: string
    sourceId: number
    sisyfosTypeIndex: number
  }>()

  constructor(mixerProtocol: MixerProtocol, mixerIndex: number) {
    this.mixerProtocol = mixerProtocol
    this.mixerIndex = mixerIndex

    this.dhdMixerId = state.settings[0].mixers[this.mixerIndex].mixerId

    logger.info('Setting up DHD connection')
    this.dhdConnection = new DHDWebSocketClient(state.settings[0].mixers[this.mixerIndex].deviceUrl, state.settings[0].mixers[this.mixerIndex].deviceToken, {
      pingInterval: mixerProtocol.pingTime
    })

    logger.info('Connecting to DHD via WebSockets')

    this.dhdConnection.addListener('error', (error) => {
      logger.error(`DHDConection error: ${error}`)
    })
    this.dhdConnection.addListener('warn', (warn) => {
      logger.error(`Unexpected condition in DHDConnection: ${warn}`)
    })
    this.dhdConnection.addListener('close', () => {
      store.dispatch({
        type: SettingsActionTypes.SET_MIXER_ONLINE,
        mixerIndex: this.mixerIndex,
        mixerOnline: false,
      })
      global.mainThreadHandler.updateMixerOnline(this.mixerIndex)
    })
    this.dhdConnection.addListener('open', () => {
      logger.info('DHD connection established')

      store.dispatch({
        type: SettingsActionTypes.SET_MIXER_ONLINE,
        mixerIndex: this.mixerIndex,
        mixerOnline: true,
      })
      global.mainThreadHandler.updateMixerOnline(this.mixerIndex)

      const abort = new AbortController() // for future use when setupMixerConnection needs to be re-run when source assignments to faders change

      this.setupMixerConnection(abort.signal).catch((err) => {
        logger.error(`Error trying to set up the mixer connection: ${err}`)
      })
    })
  }

  private fillAddress(address: string, faderId?: string) {
    let result = address.replaceAll("{mixerID}", this.dhdMixerId)
    if (faderId) {
      result = result.replaceAll("{faderID}", faderId)
    }

    return result
  }

  private async setupMixerConnection(signal: AbortSignal) {
    const fadersGetResult = await this.dhdConnection.getAttribute<Record<string, {
      sourceid: number
      label: string
    }>>(this.fillAddress('/audio/mixers/{mixerID}/faders'))
    for (const [faderId, faderObj] of Object.entries<{
      sourceid: number
      label: string
    }>(fadersGetResult)) {
      this.sourceIdToFaderId.set(faderObj.sourceid, faderId)
    }

    const sortedSourceIds = Array.from(this.sourceIdToFaderId.keys()).sort()
    // Set channel labels
    let globalChIndex = 0;
    state.settings[0].mixers[this.mixerIndex].numberOfChannelsInType.forEach(
      async (numberOfChannels, typeIndex) => {
        for (
          let channelTypeIndex = 0;
          channelTypeIndex < numberOfChannels;
          channelTypeIndex++
        ) {
          const sourceId = sortedSourceIds[channelTypeIndex]
          const faderId = this.sourceIdToFaderId.get(sourceId)
          const faderObj = fadersGetResult[faderId]
          if (faderObj !== undefined) {
            // enable
            this.sisyfosChannelIdToDHDTargets.set(globalChIndex, {
              sourceId,
              faderId,
              sisyfosTypeIndex: typeIndex,
            })
            store.dispatch({
              type: ChannelActionTypes.SET_CHANNEL_LABEL,
              mixerIndex: this.mixerIndex,
              channel: globalChIndex,
              label: faderObj.label,
            })
            store.dispatch({
              type: FaderActionTypes.SET_CHANNEL_DISABLED,
              faderIndex: globalChIndex,
              disabled: false,
            })
            store.dispatch({
              type: FaderActionTypes.SHOW_CHANNEL,
              faderIndex: globalChIndex,
              showChannel: true,
            })
          } else {
            // disable
            this.sisyfosChannelIdToDHDTargets.delete(globalChIndex)
            store.dispatch({
              type: FaderActionTypes.SET_CHANNEL_DISABLED,
              faderIndex: globalChIndex,
              disabled: true,
            })
            store.dispatch({
              type: ChannelActionTypes.SET_CHANNEL_LABEL,
              mixerIndex: this.mixerIndex,
              channel: globalChIndex,
              label: '',
            })
            store.dispatch({
              type: FaderActionTypes.SHOW_CHANNEL,
              faderIndex: globalChIndex,
              showChannel: false,
            })
          }
          globalChIndex++;
        }
      }
    )

    for (const [sisyfosChannelIndex, targets] of this.sisyfosChannelIdToDHDTargets) {
      logger.debug(`Running subscriptions for faderId: ${targets.faderId}`)

      try {
        await this.subscribeFaderLevel(targets.faderId, targets.sisyfosTypeIndex, sisyfosChannelIndex, signal)
        await this.subscribeGainLevel(targets.faderId, targets.sisyfosTypeIndex, sisyfosChannelIndex, signal)
      } catch (e) {
        logger
          .data(e)
          .error(
            `error during subscriptions of parameters for ${targets.faderId}`
          )
      }
    }
  }

  private async subscribeFaderLevel(
    faderId: string,
    typeIndex: number,
    sisyfosChannelId: number,
    signal: AbortSignal
  ) {
    const command = this.fillAddress(this.mixerProtocol.channelTypes[
      typeIndex
    ].fromMixer.CHANNEL_OUT_GAIN[0].mixerMessage, faderId)

    try {
      await this.dhdConnection.subscribeToPath<number>(command, (value) => {
        logger.trace(`Receiving Level from ${command} Ch ${sisyfosChannelId}: ${value}`)

        const level = Number(value)
        if (!Number.isFinite(level)) {
          logger.error(`Level value is not a finite number: ${level}`)
        }

        if (
          !state.channels[0].chMixerConnection[this.mixerIndex].channel[
            sisyfosChannelId
          ].fadeActive &&
          level >
          this.mixerProtocol.channelTypes[typeIndex].fromMixer
            .CHANNEL_OUT_GAIN[0].min
        ) {
          const isPgm =
            level >
            this.mixerProtocol.channelTypes[typeIndex].fromMixer
              .CHANNEL_OUT_GAIN[0].min

          if (isPgm) {
            // update the fader, but only if that means it's on-air
            store.dispatch({
              type: FaderActionTypes.SET_FADER_LEVEL,
              faderIndex: sisyfosChannelId,
              level: level,
            })
          }
          // update the output level anyway
          store.dispatch({
            type: ChannelActionTypes.SET_OUTPUT_LEVEL,
            mixerIndex: this.mixerIndex,
            channel: sisyfosChannelId,
            level: level,
          })

          // toggle pgm based on level
          logger.trace(
            `Set Ch ${sisyfosChannelId} pgmOn ${level > 0} from ${command} level ${level}: ${level}`
          )
          store.dispatch({
            type: FaderActionTypes.SET_PGM,
            faderIndex: sisyfosChannelId,
            pgmOn: isPgm,
          })

          global.mainThreadHandler.updatePartialStore(sisyfosChannelId)
          if (remoteConnections) {
            remoteConnections.updateRemoteFaderState(sisyfosChannelId, level)
          }
        }
      }, signal)
    } catch (e) {
      logger.error(`Could not subscribe to ${command}: ${e}`)
    }
  }

  private async subscribeGainLevel(
    faderId: string,
    typeIndex: number,
    sisyfosChannelId: number,
    signal: AbortSignal
  ) {
    const command = this.fillAddress(this.mixerProtocol.channelTypes[
      typeIndex
    ].fromMixer.CHANNEL_INPUT_GAIN[0].mixerMessage, faderId)

    try {
      await this.dhdConnection.subscribeToPath<number>(command, (value) => {
        logger.trace(`Receiving Level from ${command} Ch ${sisyfosChannelId}: ${value}`)

        const level = Number(value)
        if (!Number.isFinite(level)) {
          logger.error(`Level value is not a finite number: ${level}`)
        }

        if (
          level >
          this.mixerProtocol.channelTypes[typeIndex].fromMixer
            .CHANNEL_INPUT_GAIN[0].min
        ) {
          store.dispatch({
            type: FaderActionTypes.SET_INPUT_GAIN,
            faderIndex: sisyfosChannelId,
            level: level,
          })
          global.mainThreadHandler.updatePartialStore(sisyfosChannelId)
        }
      }, signal)
    } catch (e) {
      logger.error(`Could not subscribe to ${command}: ${e}`)
    }
  }

  updateFadeIOLevel(channelIndex: number, outputLevel: number) {
    const channelType =
      state.channels[0].chMixerConnection[this.mixerIndex].channel[channelIndex]
        .channelType

    const target = this.sisyfosChannelIdToDHDTargets.get(channelIndex)
    if (!target) return
    const proto = this.mixerProtocol.channelTypes[channelType].toMixer.CHANNEL_OUT_GAIN[0]
    const mixerMessage =
      this.fillAddress(proto.mixerMessage, target.faderId)

    const value = floatToDB(outputLevel, proto.min)

    logger.trace(`Sending out value: ${value} (${outputLevel}) to channel ${channelIndex} (faderId: ${target.faderId})`)

    this.dhdConnection.setAttribute(mixerMessage, value)
  }

  async updatePflState(channelIndex: number) {
    return true
  }

  updateMuteState(channelIndex: number, muteOn: boolean) {
    return true
  }

  updateAMixState(channelIndex: number, amixOn: boolean) {
    return true
  }

  updateNextAux(channelIndex: number, level: number) {
    return true
  }

  updateInputGain(channelIndex: number, gain: number) {
    const channel =
      state.channels[0].chMixerConnection[this.mixerIndex].channel[channelIndex]
    const channelType = channel.channelType
    const proto =
      this.mixerProtocol.channelTypes[channelType].toMixer.CHANNEL_INPUT_GAIN[0]

    const target = this.sisyfosChannelIdToDHDTargets.get(channelIndex)
    if (!target) return

    this.dhdConnection.setAttribute(this.fillAddress(proto.mixerMessage, target.faderId), floatToDB(gain, proto.min))
  }
  updateInputSelector(channelIndex: number, inputSelected: number) {
    return true
  }

  updateFx(channelIndex: number, fxParam: FxParam, level: number) {
    return true
  }
  updateAuxLevel(channelIndex: number, auxSendIndex: number, level: number) {
    return true
  }

  updateChannelName(channelIndex: number) {
    return true
  }

  loadMixerPreset(presetName: string) { }

  injectCommand(command: string[]) {
    return true
  }

  updateChannelSetting(channelIndex: number, setting: string, value: string) { }
}

interface DHDMessageBase {
  msgID: number
  // method: "auth" | "set" | "get" | "subscribe" | "unsubscribe"
}

interface DHDErrResMessage extends DHDMessageBase {
  success: false
  error: string
}

interface DHDSetReqMessage extends DHDMessageBase {
  method: "set"
  path: string
  payload: any
}

interface DHDSetResMessage extends DHDMessageBase {
  method: "set"
  path: string
  payload: any
  success: true
}

interface DHDGetReqMessage extends DHDMessageBase {
  method: "get"
  path: string
}

interface DHDGetResMessage extends DHDMessageBase {
  method: "get"
  path: string
  payload: any
  success: true
}

interface DHDAuthReqMessage extends DHDMessageBase {
  method: "auth"
  token: string
}

interface DHDAuthResMessage extends DHDMessageBase {
  method: "auth"
  token: string
  success: true
}

interface DHDSubscribeReqMessage extends DHDMessageBase {
  method: "subscribe"
  path: string
}

interface DHDSubscribeResMessage extends DHDMessageBase {
  method: "subscribe"
  path: string
  success: true
}

interface DHDUpdateMessage {
  method: "update"
  payload: any
}

interface DHDUnsubscribeReqMessage extends DHDMessageBase {
  method: "unsubscribe"
  path: string
}

interface DHDUnsubscribeResMessage extends DHDMessageBase {
  method: "unsubscribe"
  path: string
  success: true
}

type DHDAnyResMessage =
  | DHDErrResMessage
  | DHDUnsubscribeResMessage
  | DHDSubscribeResMessage
  | DHDAuthResMessage
  | DHDGetResMessage
  | DHDSetResMessage

type DHDIncomingMessage = DHDAnyResMessage | DHDUpdateMessage
type DHDOutgoingMessage = DHDAuthReqMessage | DHDSetReqMessage | DHDGetReqMessage | DHDSubscribeReqMessage | DHDUnsubscribeReqMessage
type DHDUntaggedOutgoingMessage = Omit<DHDOutgoingMessage, 'msgID'>

type DHDResponseHandler = (msg: Readonly<DHDAnyResMessage>) => void
type DHDUpdateHandler<T> = (subTreeValue: Readonly<T>) => void

class DHDWebSocketClient extends EventEmitter<{
  'error': [string]
  'warn': [string]
  'close': [],
  'open': [],
}> {

  private msgIDListeners: Map<number, DHDResponseHandler> = new Map()
  private updateListeners: Map<string, DHDUpdateHandler<unknown>[]> = new Map()

  private protocolLastMsgID = 0

  private wsConnection: WebSocket

  private pingInterval: NodeJS.Timeout

  constructor(url: string, token: string, private readonly options?: {
    pingInterval?: number
  }) {
    super()

    this.setupConnection(url, token)
  }

  private setupConnection = (url: string, token: string) => {
    this.wsConnection = new WebSocket(url)

    this.wsConnection.addListener('error', (error: any) => {
      if (
        (error.message + '').match(/econnrefused/i) ||
        (error.message + '').match(/disconnected/i)
      ) {
        this.emit('error', `WebSockets connection not established: ${error.message}`)
      } else {
        this.emit('error', `WebSockets connection unknown error: ${error}`)
      }
    })
    this.wsConnection.addListener('message', this.onMessage)
    this.wsConnection.addListener('close', () => {
      this.emit('close')
      if (this.pingInterval !== undefined) {
        clearInterval(this.pingInterval)
      }
    })
    this.wsConnection.addListener('open', () => {
      this.authorize(token).then(() => {
        if (this.options?.pingInterval) {
          this.pingInterval = setInterval(() => {
            this.wsConnection.ping()
          }, this.options.pingInterval)
        }
        this.emit('open')
      }).catch((err) => {
        this.emit('error', `Could not authorize: ${err}`)
        this.close()
      })
    })
  }

  private getNextMsgID = (): number => {
    const msgID = this.protocolLastMsgID++
    // wrap around the msgID when needed
    if (this.protocolLastMsgID >= Number.MAX_SAFE_INTEGER) {
      this.protocolLastMsgID = Number.MIN_SAFE_INTEGER
    }

    return msgID
  }

  /**
   * Send a message to DHD Mixer with a sequence number as msgID
   * @param message Message to be sent, without the msgID parameter
   * @param onReply A function that will be invoked when a response to this message is received
   * @returns the `msgID` of the sent message
   */
  private sendMessage = (message: DHDUntaggedOutgoingMessage, onReply?: DHDResponseHandler): number => {
    if (this.wsConnection.readyState !== 1) {
      throw new Error(`Connection is in an invalid state for sending messages: ${this.wsConnection.readyState}`)
    }

    const taggedMessage = message as DHDOutgoingMessage
    taggedMessage.msgID = this.getNextMsgID()

    if (onReply) {
      this.msgIDListeners.set(taggedMessage.msgID, onReply)
    }

    this.wsConnection.send(JSON.stringify(message))

    return taggedMessage.msgID
  }

  private onResponseMessage = (message: DHDAnyResMessage) => {
    const msgID = message.msgID
    const listener = this.msgIDListeners.get(msgID)
    if (listener) {
      listener(message)
    } else {
      this.emit('warn', `Message msgID ${msgID} received, but noone is listening: ${JSON.stringify(message)}`)
    }
    this.msgIDListeners.delete(msgID)
  }

  private onUpdateMessage = (message: DHDUpdateMessage) => {
    function getValueAtPath(path: string, obj: any) {
      const explodedPath = path.split("/") // the path we have in the Map already has the leading "/" stripped
      let target = obj
      for (let i = 0; i < explodedPath.length; i++) {
        target = target[explodedPath[i]]
        if (target === undefined) return undefined
      }
      return target
    }

    for (const [path, listeners] of this.updateListeners.entries()) {
      const value = getValueAtPath(path, message.payload)
      // the path is not present in the update message, skip
      if (value === undefined) continue

      // only send the sub-tree into the listeners
      for (const listener of listeners) {
        listener(value)
      }
    }
  }

  private onMessage = (data: Buffer | ArrayBuffer | Buffer[]) => {
    try {
      const message = JSON.parse(data.toString('utf-8'))
      if (message.msgID !== undefined) { // all responses have a msgID
        this.onResponseMessage(message as DHDAnyResMessage)
      } else if (message.method === "update") { // "update" messages have no msgID
        this.onUpdateMessage(message as DHDUpdateMessage)
      } else {
        this.emit(`warn`, `Unknown message received: ${JSON.stringify(message)}`)
      }
    } catch {
      this.emit('error', `Invalid message received: ${data.toString('utf-8')}`)
    }
  }

  private authorize = async (token: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      this.sendMessage({
        "method": "auth",
        "token": token
      } satisfies Omit<DHDAuthReqMessage, 'msgID'> as DHDUntaggedOutgoingMessage, (response) => {
        if (response.success && response.method === "auth") {
          resolve()
        } else {
          reject(`Invalid response: "${JSON.stringify(response)}"`)
        }
      })
    })
  }

  public close = async (): Promise<void> => {
    this.msgIDListeners.clear()
    this.updateListeners.clear()
    this.wsConnection.close()
  }

  /**
   * Set the device sub-tree to match a given value
   * @param path 
   * @param payload Can be an object or a scalar value if `path` targets a scalar value in the device tree
   * @returns 
   */
  public setAttribute = async (path: string, payload: any): Promise<void> => {
    return new Promise((resolve, reject) => {
      this.sendMessage({
        "method": "set",
        "path": path,
        "payload": payload,
      } satisfies Omit<DHDSetReqMessage, 'msgID'> as DHDUntaggedOutgoingMessage, (response) => {
        if (response.success && response.method === "set") {
          resolve()
        } else {
          reject(`Invalid response: "${JSON.stringify(response)}"`)
        }
      })
    })
  }

  /**
   * Get the current state of the device sub-tree at a given path
   * @param path 
   * @returns Can be an object or a scalar value
   */
  public getAttribute = async <T = any>(path: string): Promise<T> => {
    return new Promise((resolve, reject) => {
      this.sendMessage({
        "method": "get",
        "path": path,
      } satisfies Omit<DHDGetReqMessage, 'msgID'> as DHDUntaggedOutgoingMessage, (response) => {
        if (response.success && response.method === "get") {
          resolve(response.payload)
        } else {
          reject(`Invalid response: "${JSON.stringify(response)}"`)
        }
      })
    })
  }

  /**
   * Subscribe to updates of the device sub-tree
   * @param path 
   * @param listener A method that will receive updates 
   * @returns An object with a method that will end sending updates to the `listener`
   */
  public subscribeToPath = async <T>(path: string, listener: DHDUpdateHandler<T>, signal: AbortSignal): Promise<void> => {
    if (!path.startsWith("/")) {
      throw new Error(`Path needs to start with a "/" character, got "${path}"`)
    }

    return new Promise((resolve, reject) => {
      this.sendMessage({
        "method": "subscribe",
        "path": path,
      } satisfies Omit<DHDSubscribeReqMessage, 'msgID'> as DHDUntaggedOutgoingMessage, (response) => {
        if (response.success && response.method === "subscribe") {
          const processedPath = path.substring(1) // strip the leading "/" in the path, we won't be using it for matching the listeners

          let updateListeners = this.updateListeners.get(processedPath)
          if (!updateListeners) {
            updateListeners = []
            this.updateListeners.set(processedPath, updateListeners)
          }

          updateListeners.push(listener)

          addAbortListener(signal, () => {
            const filteredListeners = this.updateListeners.get(processedPath).filter((handler) => handler !== listener)
            this.updateListeners.set(processedPath, filteredListeners)
            if (filteredListeners.length === 0) {
              this.sendMessage({
                "method": "unsubscribe",
                "path": path,
              } satisfies Omit<DHDUnsubscribeReqMessage, 'msgID'> as DHDUntaggedOutgoingMessage, (response) => {
                if (!response.success || response.method !== "unsubscribe") {
                  this.emit('warn', `Could not unsubscribe to ${path}: ${JSON.stringify(response)}`)
                }
              })
            }
          })

          resolve()
        } else {
          reject(`Invalid response: "${JSON.stringify(response)}"`)
        }
      })
    })
  }
}