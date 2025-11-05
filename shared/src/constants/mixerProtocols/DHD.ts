import {
    MixerProtocol,
    emptyMixerMessage,
    VuLabelConversionType,
    MixerConnectionTypes
} from '../MixerProtocolInterface'

export const LawoRuby: MixerProtocol = {
  protocol: MixerConnectionTypes.DHD,
  label: 'DHD.audio Series52',
  presetFileExtension: '',
  loadPresetCommand: [emptyMixerMessage()],
  MAX_UPDATES_PER_SECOND: 10,
  leadingZeros: false, //some OSC protocols needs channels to be 01, 02 etc.
  pingCommand: [emptyMixerMessage()],
  pingResponseCommand: [emptyMixerMessage()],
  pingTime: 0, //Bypass ping when pingTime is zero
  initializeCommands: [emptyMixerMessage()],
  vuLabelConversionType: VuLabelConversionType.Decibel,
  vuLabelValues: [0, 0.5, 0.75, 1],
  channelTypes: [
    {
      channelTypeName: 'CH',
      channelTypeColor: '#2f2f2f',
      fromMixer: {
        CHANNEL_INPUT_GAIN: [
          {
            mixerMessage: '/audio/mixers/{mixerID}/faders/{faderID}/params/gain',
            value: 0,
            type: 'int',
            min: -30,
            max: 18,
            zero: 0,
          },
        ],
        // CHANNEL_INPUT_SELECTOR: [
          // {
          //   mixerMessage: 'Ruby.Sources.{channel}.DSP.Input.LR Mode',
          //   value: 0,
          //   type: 'int',
          //   label: 'LR',
          // },
          // {
          //   mixerMessage: 'Ruby.Sources.{channel}.DSP.Input.LR Mode',
          //   value: 4,
          //   type: 'int',
          //   label: 'LL',
          // },
          // {
          //   mixerMessage: 'Ruby.Sources.{channel}.DSP.Input.LR Mode',
          //   value: 1,
          //   type: 'int',
          //   label: 'RR',
          // },
          // {
          //   mixerMessage: 'Ruby.Sources.{channel}.DSP.Input.LR Mode',
          //   value: 5,
          //   type: 'int',
          //   label: 'MONO',
          // },
        // ],
        CHANNEL_OUT_GAIN: [
          {
            mixerMessage: '/audio/mixers/{mixerID}/faders/{faderID}/fader',
            value: 0,
            type: 'int',
            min: -16000,
            max: 1000,
            zero: 0,
          },
        ],
        CHANNEL_NAME: [
          {
            mixerMessage: '/audio/mixers/{mixerID}/faders/{faderID}/label',
            value: 0,
            type: 'real',
            min: -200,
            max: 20,
            zero: 0,
          },
        ],
        PFL: [emptyMixerMessage()],
        CHANNEL_AMIX: [
          {
            mixerMessage: '/audio/mixers/{mixerID}/faders/{faderID}/busparams/automix/group',
          },
        ],
      },
      toMixer: {
        CHANNEL_INPUT_GAIN: [
          {
            mixerMessage: '/audio/mixers/{mixerID}/faders/{faderID}/params/gain',
            value: 0,
            type: 'int',
            min: -30,
            max: 18,
            zero: 0,
          },
        ],
        // CHANNEL_INPUT_SELECTOR: [
          // {
          //   mixerMessage: 'Ruby.Sources.{channel}.DSP.Input.LR Mode',
          //   value: 0,
          //   type: 'int',
          //   label: 'LR',
          // },
          // {
          //   mixerMessage: 'Ruby.Sources.{channel}.DSP.Input.LR Mode',
          //   value: 4,
          //   type: 'int',
          //   label: 'LL',
          // },
          // {
          //   mixerMessage: 'Ruby.Sources.{channel}.DSP.Input.LR Mode',
          //   value: 1,
          //   type: 'int',
          //   label: 'RR',
          // },
          // {
          //   mixerMessage: 'Ruby.Sources.{channel}.DSP.Input.LR Mode',
          //   value: 5,
          //   type: 'int',
          //   label: 'MONO',
          // },
        // ],
        CHANNEL_OUT_GAIN: [
          {
            mixerMessage: '/audio/mixers/{mixerID}/faders/{faderID}/fader',
            value: 0,
            type: 'int',
            min: -160,
            max: 10,
            zero: 0,
          },
        ],
        CHANNEL_NAME: [
          {
            mixerMessage: '/audio/mixers/{mixerID}/faders/{faderID}/label',
            value: 0,
            type: 'real',
            min: -200,
            max: 20,
            zero: 0,
          },
        ],
        PFL_ON: [emptyMixerMessage()],
        PFL_OFF: [emptyMixerMessage()],
        CHANNEL_AMIX: [
          {
            mixerMessage: '/audio/mixers/{mixerID}/faders/{faderID}/busparams/automix/group',
          },
        ],
      },
    },
  ],
  fader: {
    min: -16000,
    max: 1000,
    zero: 0,
    step: 1,
  },
  meter: {
    min: 0,
    max: 1,
    zero: 0.75,
    test: 0.6,
  },
}
