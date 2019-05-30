import { IMixerProtocol } from '../MixerProtocolPresets';

export const BehringerXrClient: IMixerProtocol = {
    protocol: 'OSC',
    label: 'Behringer XR 12,14,16 Clientmode',
    mode: "client", //master (ignores mixers faderlevel, and use faderlevel as gain preset),
                    //client (use feedback from mixers fader level)
    leadingZeros: true,
    pingCommand: [
        {
            oscMessage: "/xremote",
            value: 0,
            type: "f"
        },
        {
            oscMessage: "/meters",
            value: "/meters/1",
            type: "s"
        },
        {
            oscMessage: "/meters",
            value: "/meters/5",
            type: "s"
        }
    ],
    pingTime: 9500,
    initializeCommands: [
        {
            oscMessage: "/info",
            value: 0,
            type: "f"
        }
    ],
    fromMixer: {
        CHANNEL_FADER_LEVEL: '/ch/{channel}/mix/fader',        //'none' ignores this command
        CHANNEL_OUT_GAIN: '/ch/{channel}/mix/01/level',
        CHANNEL_VU: '/meters/1',
        CHANNEL_NAME: '/ch/{channel}/config/name',
        GRP_VU: 'none',
        GRP_NAME: '/dca/{channel}/config/name',
        GRP_OUT_GAIN: '/dca/{channel}/fader',
    },
    toMixer: {
        CHANNEL_FADER_LEVEL: '/ch/{channel}/mix/fader',
        CHANNEL_OUT_GAIN: '/ch/{channel}/mix/01/level',
        GRP_OUT_GAIN: '/dca/{channel}/fader',
    },
    fader: {
        min: 0,
        max: 1,
        zero: 0.75,
        step: 0.01,
        fadeTime: 40,
    },
    meter: {
        min: 0,
        max: 1,
        zero: 0.75,
        test: 0.6,
    },
}
