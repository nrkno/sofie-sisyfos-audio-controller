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

export class DHDMixerConnection implements MixerConnection {
  mixerProtocol: MixerProtocol
  mixerIndex: number
  dhdConnection: DHDWebSocketClient
  faders: { [index: number]: string } = {}

  constructor(mixerProtocol: MixerProtocol, mixerIndex: number) {
    this.setAttributeOnChannel = this.setAttributeOnChannel.bind(this)

    this.mixerProtocol = mixerProtocol
    this.mixerIndex = mixerIndex

    logger.info('Setting up DHD connection')
    this.dhdConnection = new DHDWebSocketClient(state.settings[0].mixers[this.mixerIndex].deviceUrl, state.settings[0].mixers[this.mixerIndex].deviceToken)

    store.dispatch({
      type: SettingsActionTypes.SET_MIXER_ONLINE,
      mixerIndex: this.mixerIndex,
      mixerOnline: false,
    })

    logger.info('Connecting to DHD via WebSockets')

    this.dhdConnection.addListener('error', () => {

    })
    this.dhdConnection.addListener('close', () => {

    })
    this.dhdConnection.addListener('open', () => {

    })
  }

  private async setupMixerConnection() {
    logger.info(
      'WebSocket connection established - authorizing'
    )

    // get the node that contains the sources
    const sourceNode =
      await this.emberConnection.getElementByPath('Device.Channels')
    // get the sources
    const req = await this.emberConnection.getDirectory(
      sourceNode as NumberedTreeNode<EmberElement>
    )
    const sources = await req.response

    // map sourceNames to their fader number
    if ('children' in sources) {
      for (const [_i, child] of Object.entries(sources.children)) {
        if (
          child.contents.type === Model.ElementType.Node &&
          child.contents.identifier
        ) {
          const name = child.contents.identifier
          this.faders[child.number] = name
        }
      }
    }

    // Set channel labels
    state.settings[0].mixers[this.mixerIndex].numberOfChannelsInType.forEach(
      async (numberOfChannels, typeIndex) => {
        for (
          let channelTypeIndex = 0;
          channelTypeIndex < numberOfChannels;
          channelTypeIndex++
        ) {
          if (this.faders[channelTypeIndex + 1]) {
            // enable
            store.dispatch({
              type: ChannelActionTypes.SET_CHANNEL_LABEL,
              mixerIndex: this.mixerIndex,
              channel: channelTypeIndex,
              label: this.faders[channelTypeIndex + 1],
            })
            store.dispatch({
              type: FaderActionTypes.SET_CHANNEL_DISABLED,
              faderIndex: channelTypeIndex,
              disabled: false,
            })
            store.dispatch({
              type: FaderActionTypes.SHOW_CHANNEL,
              faderIndex: channelTypeIndex,
              showChannel: true,
            })
          } else {
            // disable
            store.dispatch({
              type: FaderActionTypes.SET_CHANNEL_DISABLED,
              faderIndex: channelTypeIndex,
              disabled: true,
            })
            store.dispatch({
              type: ChannelActionTypes.SET_CHANNEL_LABEL,
              mixerIndex: this.mixerIndex,
              channel: channelTypeIndex,
              label: '',
            })
            store.dispatch({
              type: FaderActionTypes.SHOW_CHANNEL,
              faderIndex: channelTypeIndex,
              showChannel: false,
            })
          }
        }
      }
    )

    let ch: number = 1
    for (const typeIndex in state.settings[0].mixers[this.mixerIndex]
      .numberOfChannelsInType) {
      const numberOfChannels =
        state.settings[0].mixers[this.mixerIndex].numberOfChannelsInType[
        typeIndex
        ]
      for (
        let channelTypeIndex = 0;
        channelTypeIndex < numberOfChannels;
        channelTypeIndex++
      ) {
        logger.debug(`Running subscriptions for ${this.faders[ch]}`)
        try {
          await this.subscribeFaderLevel(
            ch,
            Number(typeIndex),
            channelTypeIndex
          )
          await this.subscribeGainLevel(ch, Number(typeIndex), channelTypeIndex)
          await this.subscribeInputSelector(
            ch,
            Number(typeIndex),
            channelTypeIndex
          )
          await this.subscribeAMixState(ch, Number(typeIndex), channelTypeIndex)
          ch++
        } catch (e) {
          logger
            .data(e)
            .error(
              `error during subscriptions of parameters for ${this.faders[ch]}`
            )
        }
      }
    }
  }

  private async subscribeFaderLevel(
    ch: number,
    typeIndex: number,
    channelTypeIndex: number
  ) {
    const sourceName = this.faders[ch]
    if (!sourceName) return

    let command = this.mixerProtocol.channelTypes[
      typeIndex
    ].fromMixer.CHANNEL_OUT_GAIN[0].mixerMessage.replace(
      '{channel}',
      sourceName
    )

    try {
      const node = await this.emberConnection.getElementByPath(command)
      if (node.contents.type !== Model.ElementType.Parameter) return

      logger.debug(`Subscription of channel level: ${command}`)
      this.emberConnection.subscribe(
        node as NumberedTreeNode<EmberElement>,
        () => {
          const level: number = (node.contents as Model.Parameter)
            .value as number

          logger.trace(`Receiving Level from ${command} Ch ${ch - 1}: ${level}`)

          if (
            !state.channels[0].chMixerConnection[this.mixerIndex].channel[
              ch - 1
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
                faderIndex: ch - 1,
                level: level,
              })
            }
            // update the output level anyway
            store.dispatch({
              type: ChannelActionTypes.SET_OUTPUT_LEVEL,
              mixerIndex: this.mixerIndex,
              channel: ch - 1,
              level: level,
            })

            // toggle pgm based on level
            logger.trace(
              `Set Ch ${ch - 1} pgmOn ${level > 0} from ${command} level ${level}: ${level}`
            )
            store.dispatch({
              type: FaderActionTypes.SET_PGM,
              faderIndex: ch - 1,
              pgmOn: isPgm,
            })

            global.mainThreadHandler.updatePartialStore(ch - 1)
            if (remoteConnections) {
              remoteConnections.updateRemoteFaderState(ch - 1, level)
            }
          }
        }
      )
    } catch (e) {
      logger.data(e).debug('error when subscribing to fader level')
    }
  }
  private async subscribeGainLevel(
    ch: number,
    typeIndex: number,
    channelTypeIndex: number
  ) {
    const sourceName = this.faders[ch]
    if (!sourceName) return

    const proto =
      this.mixerProtocol.channelTypes[typeIndex].fromMixer.CHANNEL_INPUT_GAIN[0]
    let command = proto.mixerMessage.replace('{channel}', sourceName)

    try {
      const node = await this.emberConnection.getElementByPath(command)
      if (node.contents.type !== Model.ElementType.Parameter) return

      logger.debug(`Subscription of channel gain: ${command}`)
      this.emberConnection.subscribe(
        node as NumberedTreeNode<EmberElement>,
        () => {
          const level = (node.contents as Model.Parameter).value as number
          logger.trace(
            `Receiving Gain from ${command} Ch ${ch - 1}: ${level}`
          )
          if (
            ((node.contents as Model.Parameter).value as number) > proto.min
          ) {
            store.dispatch({
              type: FaderActionTypes.SET_INPUT_GAIN,
              faderIndex: ch - 1,
              level: level,
            })
            global.mainThreadHandler.updatePartialStore(ch - 1)
          }
        }
      )
    } catch (e) {
      logger.data(e).debug('Error when subscribing to gain level')
    }
  }
  private async subscribeInputSelector(
    ch: number,
    typeIndex: number,
    channelTypeIndex: number
  ) {
    const sourceName = this.faders[ch]
    if (!sourceName) return

    let command = this.mixerProtocol.channelTypes[
      typeIndex
    ].fromMixer.CHANNEL_INPUT_SELECTOR[0].mixerMessage.replace(
      '{channel}',
      sourceName
    )

    try {
      const node = await this.emberConnection.getElementByPath(command)
      logger.debug(`set_cap ${ch - 1} hasInputSel true`)
      store.dispatch({
        type: FaderActionTypes.SET_CAPABILITY,
        faderIndex: ch - 1,
        capability: 'hasInputSelector',
        enabled: true,
      })
      if (node.contents.type !== Model.ElementType.Parameter) {
        return
      }

      logger.debug(`Subscription of channel input selector: ${command}`)
      this.emberConnection.subscribe(
        node as NumberedTreeNode<EmberElement>,
        () => {
          logger.trace(`Receiving InpSelector from ${command} Ch ${ch - 1}`)
          this.mixerProtocol.channelTypes[
            typeIndex
          ].fromMixer.CHANNEL_INPUT_SELECTOR.forEach((selector, i) => {
            if (selector.value === (node.contents as Model.Parameter).value) {
              store.dispatch({
                type: FaderActionTypes.SET_INPUT_SELECTOR,
                faderIndex: ch - 1,
                selected: i + 1,
              })
              global.mainThreadHandler.updatePartialStore(ch - 1)
            }
          })
        }
      )
    } catch (e) {
      if (e.message.match(/could not find node/i)) {
        logger.debug(`set_cap ${ch - 1} hasInputSel false`)
        store.dispatch({
          type: FaderActionTypes.SET_CAPABILITY,
          faderIndex: ch - 1,
          capability: 'hasInputSelector',
          enabled: false,
        })
      }
      logger.data(e).debug('Error when subscribing to input selector')
    }
  }
  private async subscribeAMixState(
    ch: number,
    typeIndex: number,
    channelTypeIndex: number
  ) {
    const sourceName = this.faders[ch]
    if (!sourceName) return

    let command = this.mixerProtocol.channelTypes[
      typeIndex
    ].fromMixer.CHANNEL_AMIX[0].mixerMessage.replace('{channel}', sourceName)

    try {
      const node = await this.emberConnection.getElementByPath(command)
      logger.debug(`set_cap ${ch - 1} hasAMix true`)
      store.dispatch({
        type: FaderActionTypes.SET_CAPABILITY,
        faderIndex: ch - 1,
        capability: 'hasAMix',
        enabled: true,
      })
      if (node.contents.type !== Model.ElementType.Parameter) {
        return
      }

      logger.debug(`Subscription of AMix state: ${command}`)
      this.emberConnection.subscribe(
        node as NumberedTreeNode<EmberElement>,
        () => {
          logger.trace(`Receiving AMix state from ${command} Ch ${ch - 1}`)

          store.dispatch({
            type: FaderActionTypes.SET_AMIX,
            faderIndex: ch - 1,
            state: (node.contents as Model.Parameter).value === true,
          })
          global.mainThreadHandler.updatePartialStore(ch - 1)
        }
      )
    } catch (e) {
      if (e.message.match(/could not find node/i)) {
        logger.debug(`set_cap ${command} Ch ${ch - 1} hasAMix false`)
        store.dispatch({
          type: FaderActionTypes.SET_CAPABILITY,
          faderIndex: ch - 1,
          capability: 'hasAMix',
          enabled: false,
        })
      }
      logger
        .data(e)
        .debug(`error when subscribing to input selector ${command}`)
    }
  }

  private setAttributeOnChannel(
    mixerMessage: string,
    channel: number,
    value: string | number | boolean,
    type?: string
  ) {
    const channelString = this.faders[channel]

    if (!channelString) return

    let message = mixerMessage.replace('{channel}', channelString)

    const timestamp0 = performance.now()

    this.dhdConnection.setAttribute(message, value)
      .then()

    // .getElementByPath(message)
    // .then((element: any) => {
    //   const v = typeof value === 'string' ? parseFloat(value) : value
    //   if (element.contents.value === v)
    //     return { response: undefined, sentOk: false } // contents is already the same - a bit risky but yolo
    //   logger.trace(
    //     `Sending out message: ${message} val: ${v} typeof: ${typeof v}`,
    //     {
    //       epochBegin: timestamp0,
    //       diff: performance.now() - timestamp0,
    //     }
    //   )
    //   return this.emberConnection.setValue(element, v)
    // })
    // .then((req) => req.response)
    // .catch((error: any) => {
    //   logger.data(error).error('Ember Error for ' + message + ' -> ' + value)
    // })
  }

  private sendOutLevelMessage(channel: number, value: number) {
    const source = this.faders[channel]
    if (!channel) return

    const mixerMessage =
      this.mixerProtocol.channelTypes[0].toMixer.CHANNEL_OUT_GAIN[0]
        .mixerMessage

    logger.trace(`Sending out value: ${value}  To ${source}`)

    this.setAttributeOnChannel(mixerMessage, channel, value)
  }

  updateFadeIOLevel(channelIndex: number, outputLevel: number) {
    const channelType =
      state.channels[0].chMixerConnection[this.mixerIndex].channel[channelIndex]
        .channelType
    const channelTypeIndex =
      state.channels[0].chMixerConnection[this.mixerIndex].channel[channelIndex]
        .channelTypeIndex

    this.sendOutLevelMessage(channelTypeIndex + 1, outputLevel)
  }

  async updatePflState(channelIndex: number) {
    const channel =
      state.channels[0].chMixerConnection[this.mixerIndex].channel[channelIndex]
    let channelType = channel.channelType
    let channelTypeIndex =
      state.channels[0].chMixerConnection[this.mixerIndex].channel[channelIndex]
        .channelTypeIndex

    // fetch source name and function node
    const fader = this.faders[channelTypeIndex + 1]
    const fn = (await this.emberConnection.getElementByPath(
      'Ruby.Functions.SetPFLState'
    )) as Model.NumberedTreeNode<Model.EmberFunction>

    if (!fader || !fn)
      throw new Error(
        'Oops could not find node or function to update PFL state'
      )

    try {
      const { response } = await this.emberConnection.invoke(
        fn,
        {
          value: fader,
          type: Model.ParameterType.String,
        },
        {
          value: state.faders[0].fader[channelIndex].pflOn,
          type: Model.ParameterType.Boolean,
        }
      )
      if (response) {
        await response
      }
    } catch (e) {
      logger.data(e).error('Ember Error while updating PFL State')
    }
  }

  updateMuteState(channelIndex: number, muteOn: boolean) {
    return true
  }

  updateAMixState(channelIndex: number, amixOn: boolean) {
    const channel =
      state.channels[0].chMixerConnection[this.mixerIndex].channel[channelIndex]
    const channelType = channel.channelType
    const channelTypeIndex = channel.channelTypeIndex
    const protocol =
      this.mixerProtocol.channelTypes[channelType].toMixer.CHANNEL_AMIX[0]

    this.setAttributeOnChannel(protocol.mixerMessage, channelTypeIndex + 1, amixOn, protocol.type)
  }

  updateNextAux(channelIndex: number, level: number) {
    return true
  }

  updateInputGain(channelIndex: number, gain: number) {
    const channel =
      state.channels[0].chMixerConnection[this.mixerIndex].channel[channelIndex]
    const channelType = channel.channelType
    const channelTypeIndex = channel.channelTypeIndex
    const protocol =
      this.mixerProtocol.channelTypes[channelType].toMixer.CHANNEL_INPUT_GAIN[0]

    this.setAttributeOnChannel(protocol.mixerMessage, channelTypeIndex + 1, gain, protocol.type)
  }
  updateInputSelector(channelIndex: number, inputSelected: number) {
    logger.debug(`input select ${channelIndex} ${inputSelected}`)
    const channel =
      state.channels[0].chMixerConnection[this.mixerIndex].channel[channelIndex]
    let channelType = channel.channelType
    let channelTypeIndex = channel.channelTypeIndex
    let msg =
      this.mixerProtocol.channelTypes[channelType].toMixer
        .CHANNEL_INPUT_SELECTOR[inputSelected - 1]

    this.setAttributeOnChannel(msg.mixerMessage, channelTypeIndex + 1, msg.value, '')
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
type DHDUpdateHandler = (subTreeValue: Readonly<any>) => void

class DHDWebSocketClient extends EventEmitter<{
  'error': [string]
  'close': [],
  'open': [],
}> {

  private msgIDListeners: Map<number, DHDResponseHandler> = new Map()
  private updateListeners: Map<string, DHDUpdateHandler[]> = new Map()

  private protocolLastMsgID = 0

  private wsConnection: WebSocket

  private pingInterval: NodeJS.Timeout
  private KEEP_ALIVE_PING_INTERVAL = 20 * 1000

  constructor(url: string, token: string) {
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
        this.emit('error', `WebSockets connection not establised: ${error.message}`)
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
      logger.info('Connected to DHD Mixer')

      this.authorize(token).then(() => {
        this.emit('open')
        this.pingInterval = setInterval(() => {
          this.wsConnection.ping()
        }, this.KEEP_ALIVE_PING_INTERVAL)
      }).catch((err) => {
        this.emit('error', `Could not authorize: ${err}`)
        this.close()
      })
    })
  }

  private sendMessage = (message: DHDUntaggedOutgoingMessage, onReply?: DHDResponseHandler): { msgID: number } => {
    if (this.wsConnection.readyState !== 1) return

    const taggedMessage = message as DHDOutgoingMessage
    taggedMessage.msgID = this.protocolLastMsgID++

    if (onReply) {
      this.msgIDListeners.set(taggedMessage.msgID, onReply)
    }

    this.wsConnection.send(JSON.stringify(message))

    return {
      msgID: taggedMessage.msgID,
    }
  }

  private onMessage = (data: Buffer | ArrayBuffer | Buffer[]) => {
    function getValueAtPath(path: string, obj: any) {
      const explodedPath = path.substring(1).split("/")
      let target = obj
      for (let i = 0; i < explodedPath.length; i++) {
        target = target[explodedPath[i]]
        if (target === undefined) return undefined
      }
      return target
    }

    try {
      const message = JSON.parse(data.toString('utf-8'))
      if (message.msgID !== undefined) {
        const msgID = message.msgID
        const listener = this.msgIDListeners.get(msgID)
        if (listener) {
          listener(message)
        }
        this.msgIDListeners.delete(msgID)
      } else if (message.method === "update") {
        const updateMessage = message as DHDUpdateMessage
        for (const [path, listeners] of this.updateListeners.entries()) {
          const value = getValueAtPath(path, updateMessage.payload)
          // the path is not present in the update message, skip
          if (value === undefined) continue

          // only send the sub-tree into the listeners
          for (const listener of listeners) {
            listener(value)
          }
        }
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
  public getAttribute = async (path: string): Promise<any> => {
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
   * @returns A method that will end sending updates to the `listener`
   */
  public subscribeToPath = async (path: string, listener: DHDUpdateHandler): Promise<() => Promise<void>> => {
    return new Promise((resolve, reject) => {
      this.sendMessage({
        "method": "subscribe",
        "path": path,
      } satisfies Omit<DHDSubscribeReqMessage, 'msgID'> as DHDUntaggedOutgoingMessage, (response) => {
        if (response.success && response.method === "subscribe") {
          let updateListeners = this.updateListeners.get(path)
          if (!updateListeners) {
            updateListeners = []
            this.updateListeners.set(path, updateListeners)
          }

          updateListeners.push(listener)

          resolve(() => {
            return new Promise((resolve, reject) => {
              const filteredListeners = this.updateListeners.get(path).filter((handler) => handler !== listener)
              this.updateListeners.set(path, filteredListeners)
              if (filteredListeners.length === 0) {
                this.sendMessage({
                  "method": "unsubscribe",
                  "path": path,
                } satisfies Omit<DHDUnsubscribeReqMessage, 'msgID'> as DHDUntaggedOutgoingMessage, (response) => {
                  if (response.success && response.method === "unsubscribe") {
                    resolve()
                  } else {
                    reject(`Invalid response: "${JSON.stringify(response)}"`)
                  }
                })
              } else {
                resolve()
              }
            })
          })
        } else {
          reject(`Invalid response: "${JSON.stringify(response)}"`)
        }
      })
    })
  }
}