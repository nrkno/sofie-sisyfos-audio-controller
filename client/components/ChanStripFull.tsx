import React from 'react'
import ReactSlider from 'react-slider'
import Draggable from 'react-draggable'

import '../assets/css/ChanStripFull.css'
import { Store } from 'redux'
import { connect } from 'react-redux'
import {
    storeShowOptions,
    storeShowMonitorOptions,
    storeShowChanStripFull,
} from '../../server/reducers/settingsActions'
import { IFader, IFxParam } from '../../server/reducers/fadersReducer'
import {
    SOCKET_SET_THRESHOLD,
    SOCKET_SET_RATIO,
    SOCKET_SET_DELAY_TIME,
    SOCKET_SET_FX,
    SOCKET_SET_AUX_LEVEL,
    SOCKET_SET_INPUT_GAIN,
    SOCKET_SET_INPUT_SELECTOR,
} from '../../server/constants/SOCKET_IO_DISPATCHERS'
import CcgChannelInputSettings from './CcgChannelSettings'
import ReductionMeter from './ReductionMeter'
import ClassNames from 'classnames'
import {
    fxParamsList,
    IFxProtocol,
} from '../../server/constants/MixerProtocolInterface'
import { IChannel } from '../../server/reducers/channelsReducer'

interface IChanStripFullInjectProps {
    label: string
    selectedProtocol: string
    numberOfChannelsInType: Array<number>
    channel: IChannel[]
    fader: IFader[]
    fxParam: IFxParam[]
    auxSendIndex: number
    offtubeMode: boolean
}

interface IChanStripFullProps {
    faderIndex: number
}

enum EqColors {
    'rgb(93, 184, 180)',
    'rgb(53, 112, 127)',
    'rgb(217, 21, 133)',
    'rgb(229, 159, 34)',
}

interface IFreqLabels {
    label: string
    posY: number
}
const EQ_FREQ_LABELS: IFreqLabels[] = [
    {
        label: '50',
        posY: 300,
    },
    {
        label: '100',
        posY: 550,
    },
    {
        label: '500',
        posY: 800,
    },
    {
        label: '1k',
        posY: 1050,
    },
    {
        label: '5k',
        posY: 1300,
    },
    {
        label: '10k',
        posY: 1550,
    },
]

// Constant for calculation Eq dot positions:
const EQ_MIN_HZ = 20
const EQ_MAX_HZ = 20000
const EQ_X_SIZE = 140
const EQ_WIN_X = 450
const EQ_X_OFFSET = 350
const EQ_Y_SIZE = 330
const EQ_Y_OFFSET = 840

class ChanStripFull extends React.PureComponent<
    IChanStripFullProps & IChanStripFullInjectProps & Store
> {
    canvas: HTMLCanvasElement | undefined
    state = {
        dragStartX: 0,
        dragStartY: 0,
        dragCurrentX: 0,
        dragCurrentY: 0,
    }
    constructor(props: any) {
        super(props)
    }

    shouldComponentUpdate(
        nextProps: IChanStripFullInjectProps & IChanStripFullProps
    ) {
        if (nextProps.faderIndex > -1) {
            return true
        } else {
            return false
        }
    }

    handleShowRoutingOptions() {
        this.props.dispatch(storeShowOptions(this.props.faderIndex))
        this.props.dispatch(storeShowChanStripFull(-1))
    }

    handleShowMonitorOptions() {
        this.props.dispatch(storeShowMonitorOptions(this.props.faderIndex))
        this.props.dispatch(storeShowChanStripFull(-1))
    }

    handleClose = () => {
        this.props.dispatch(storeShowChanStripFull(-1))
    }
    handleInputSelect(selected: number) {
        window.socketIoClient.emit(SOCKET_SET_INPUT_SELECTOR, {
            faderIndex: this.props.faderIndex,
            selected: selected,
        })
    }
    handleInputGain(event: any) {
        window.socketIoClient.emit(SOCKET_SET_INPUT_GAIN, {
            faderIndex: this.props.faderIndex,
            level: parseFloat(event),
        })
    }
    handleThreshold(event: any) {
        window.socketIoClient.emit(SOCKET_SET_THRESHOLD, {
            channel: this.props.faderIndex,
            level: parseFloat(event),
        })
    }
    handleRatio(event: any) {
        window.socketIoClient.emit(SOCKET_SET_RATIO, {
            channel: this.props.faderIndex,
            level: parseFloat(event),
        })
    }

    handleDelay(event: any) {
        window.socketIoClient.emit(SOCKET_SET_DELAY_TIME, {
            channel: this.props.faderIndex,
            delayTime: parseFloat(event),
        })
    }

    changeDelay(currentValue: number, addValue: number) {
        window.socketIoClient.emit(SOCKET_SET_DELAY_TIME, {
            channel: this.props.faderIndex,
            delayTime: currentValue + addValue,
        })
    }

    handleFx(fxParam: fxParamsList, level: any) {
        window.socketIoClient.emit(SOCKET_SET_FX, {
            fxParam: fxParam,
            channel: this.props.faderIndex,
            level: parseFloat(level),
        })
    }

    handleMonitorLevel(event: any, channelIndex: number) {
        window.socketIoClient.emit(SOCKET_SET_AUX_LEVEL, {
            channel: channelIndex,
            auxIndex: this.props.auxSendIndex,
            level: parseFloat(event),
        })
    }

    handleDragCaptureEq(key: number, event: MouseEvent) {
        let eqFreqKey =
            fxParamsList[
                String(fxParamsList[key]).replace(
                    'EqGain',
                    'EqFreq'
                ) as keyof typeof fxParamsList
            ]

        this.handleFx(eqFreqKey, this.freqPositionToValue(event.clientX))
        this.handleFx(
            key,
            Math.round((100 * (EQ_Y_OFFSET - event.clientY)) / EQ_Y_SIZE) / 100
        )
    }

    valueToFreqPosition(value: number) {
        return (
            EQ_X_SIZE *
                (Math.log2(value * (EQ_MAX_HZ - EQ_MIN_HZ) + EQ_MIN_HZ) - 1) -
            EQ_WIN_X
        )
    }
    freqPositionToValue(position: number) {
        let newFreq = Math.pow(
            2,
            (position + EQ_WIN_X - EQ_X_OFFSET) / EQ_X_SIZE + 1
        )
        return (newFreq - EQ_MIN_HZ) / (EQ_MAX_HZ - EQ_MIN_HZ)
    }

    setRef = (el: HTMLCanvasElement) => {
        this.canvas = el
        this.paintEqGraphics()
    }

    paintEqGraphics() {
        if (!this.canvas) {
            return
        }
        this.canvas.width = this.canvas.clientWidth
        this.canvas.height = this.canvas.clientHeight
        const context = this.canvas.getContext('2d', {
            antialias: false,
            stencil: false,
            preserveDrawingBuffer: true,
        }) as CanvasRenderingContext2D

        if (!context) return

        // Draw X-Y axis:
        context.beginPath()
        context.strokeStyle = 'white'
        context.moveTo(175, 0)
        context.lineTo(175, 405)
        context.lineTo(1700, 405)
        context.stroke()
        // Draw zero gain line:
        context.beginPath()
        context.strokeStyle = 'rgba(128, 128, 128, 0.244) 10px'
        context.moveTo(175, 200)
        context.lineTo(1700, 200)
        context.stroke()
        // Freq on zero gain line:
        context.beginPath()
        EQ_FREQ_LABELS.forEach((freq: IFreqLabels) => {
            context.font = '20px Ariel'
            context.strokeStyle = 'white'
            context.strokeText(freq.label, freq.posY, 220)
        })
        // Freq on zero gain line:
        context.strokeText(
            String(
                window.mixerProtocol.channelTypes[0].fromMixer.FX_PARAMS?.[0]
                    .params[fxParamsList.EqGain01].maxLabel
            ) + ' dB',
            120,
            20
        )
        context.strokeText('0 dB', 120, 210)
        context.strokeText(
            String(
                window.mixerProtocol.channelTypes[0].fromMixer.FX_PARAMS?.[0]
                    .params[fxParamsList.EqGain01].maxLabel
            ) + ' dB',
            120,
            400
        )
        context.stroke()
    }

    eq() {
        return (
            <div className="eq-full">
                <canvas className="eq-canvas" ref={this.setRef}></canvas>
                <div className="title">EQUALIZER</div>
                <div className="eq-window">
                    {window.mixerProtocol.channelTypes[0].fromMixer.FX_PARAMS?.filter(
                        (param) => {
                            return fxParamsList[param.key].includes('EqGain')
                        }
                    ).map((param: IFxProtocol) => {
                        let eqFreqKey =
                            fxParamsList[
                                String(fxParamsList[param.key]).replace(
                                    'EqGain',
                                    'EqFreq'
                                ) as keyof typeof fxParamsList
                            ]
                        return (
                            <Draggable
                                position={{
                                    x: this.valueToFreqPosition(
                                        this.props.fxParam[eqFreqKey].value
                                    ),
                                    y:
                                        EQ_Y_SIZE -
                                        this.props.fxParam[param.key].value *
                                            EQ_Y_SIZE,
                                }}
                                grid={[1, 1]}
                                scale={100}
                                onDrag={(event) =>
                                    this.handleDragCaptureEq(
                                        param.key,
                                        event as MouseEvent
                                    )
                                }
                            >
                                <div
                                    className="dot"
                                    style={{
                                        color: String(EqColors[param.key]),
                                    }}
                                >
                                    O
                                </div>
                            </Draggable>
                        )
                    })}
                </div>
                <div className="eq-text">
                    {window.mixerProtocol.channelTypes[0].fromMixer.FX_PARAMS?.filter(
                        (param) => {
                            return fxParamsList[param.key].includes('EqGain')
                        }
                    ).map((param: IFxProtocol) => {
                        let eqFreqKey =
                            fxParamsList[
                                String(fxParamsList[param.key]).replace(
                                    'EqGain',
                                    'EqFreq'
                                ) as keyof typeof fxParamsList
                            ]
                        let eqQKey =
                            fxParamsList[
                                String(fxParamsList[param.key]).replace(
                                    'EqGain',
                                    'EqQ'
                                ) as keyof typeof fxParamsList
                            ]
                        return (
                            <div style={{ color: EqColors[param.key] }}>
                                <br />
                                {param.params[0].label}
                                {'  Gain : '}
                                {Math.round(
                                    100 * this.props.fxParam[param.key].value
                                ) / 100}
                                {'  Freq :'}
                                {Math.round(
                                    100 * this.props.fxParam[eqFreqKey].value
                                ) / 100}

                                {this.qFader(eqQKey)}
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }
    inputSelectorButton(index: number) {
        const isActive =
            this.props.fader[this.props.faderIndex].inputSelector === index + 1
        return (
            <button
                className={ClassNames('input-select', {
                    active: isActive,
                })}
                // className={'input-select' + (isActive ? ' active' : '')}
                onClick={() => {
                    this.handleInputSelect(index + 1)
                }}
            >
                {window.mixerProtocol.channelTypes[0].toMixer
                    .CHANNEL_INPUT_SELECTOR
                    ? window.mixerProtocol.channelTypes[0].toMixer
                          .CHANNEL_INPUT_SELECTOR[index].label
                    : null}
            </button>
        )
    }

    inputSelector() {
        return (
            <div
                className={ClassNames('input-buttons', {
                    disabled:
                        this.props.fader[this.props.faderIndex].capabilities &&
                        !this.props.fader[this.props.faderIndex].capabilities!
                            .hasInputSelector,
                })}
            >
                {window.mixerProtocol.channelTypes[0].toMixer
                    .CHANNEL_INPUT_SELECTOR ? (
                    <React.Fragment>
                        {window.mixerProtocol.channelTypes[0].toMixer.CHANNEL_INPUT_SELECTOR.map(
                            (none: any, index: number) => {
                                return this.inputSelectorButton(index)
                            }
                        )}
                    </React.Fragment>
                ) : null}
            </div>
        )
    }

    inputGain() {
        let maxLabel: number =
            window.mixerProtocol.channelTypes[0].fromMixer
                .CHANNEL_INPUT_GAIN?.[0].maxLabel ?? 1
        let minLabel =
            window.mixerProtocol.channelTypes[0].fromMixer
                .CHANNEL_INPUT_GAIN?.[0].minLabel ?? 0
        return (
            <div className="parameter-text">
                Gain
                <div className="parameter-mini-text">{maxLabel + ' dB'}</div>
                {window.mixerProtocol.channelTypes[0].toMixer
                    .CHANNEL_INPUT_GAIN ? (
                    <React.Fragment>
                        <ReactSlider
                            className="chan-strip-fader"
                            thumbClassName="chan-strip-thumb"
                            orientation="vertical"
                            invert
                            min={0}
                            max={1}
                            step={0.01}
                            value={
                                this.props.fader[this.props.faderIndex]
                                    .inputGain
                            }
                            onChange={(event: any) => {
                                this.handleInputGain(event)
                            }}
                        />
                    </React.Fragment>
                ) : null}
                <div className="parameter-mini-text">{minLabel + ' dB'}</div>
            </div>
        )
    }

    threshold() {
        let maxLabel: number =
            window.mixerProtocol.channelTypes[0].fromMixer.THRESHOLD?.[0]
                .maxLabel ?? 1
        let minLabel =
            window.mixerProtocol.channelTypes[0].fromMixer.THRESHOLD?.[0]
                .minLabel ?? 0
        return (
            <div className="parameter-text">
                Threshold
                <div className="parameter-mini-text">{maxLabel + ' dB'}</div>
                <ReactSlider
                    className="chan-strip-fader"
                    thumbClassName="chan-strip-thumb"
                    orientation="vertical"
                    invert
                    min={0}
                    max={1}
                    step={0.01}
                    value={this.props.fader[this.props.faderIndex].threshold}
                    renderThumb={(props: any, state: any) => (
                        <div {...props}>
                            {Math.round(
                                (maxLabel - minLabel) *
                                    parseFloat(state.valueNow) +
                                    minLabel
                            )}
                            dB
                        </div>
                    )}
                    onChange={(event: any) => {
                        this.handleThreshold(event)
                    }}
                />
                <div className="parameter-mini-text">{minLabel + ' dB'}</div>
            </div>
        )
    }

    ratio() {
        let maxLabel: number =
            window.mixerProtocol.channelTypes[0].fromMixer.RATIO?.[0]
                .maxLabel ?? 1
        let minLabel =
            window.mixerProtocol.channelTypes[0].fromMixer.RATIO?.[0]
                .minLabel ?? 0
        return (
            <div className="parameter-text">
                Ratio
                <div className="parameter-mini-text">{maxLabel + ':1'}</div>
                <ReactSlider
                    className="chan-strip-fader"
                    thumbClassName="chan-strip-thumb"
                    orientation="vertical"
                    invert
                    min={0}
                    max={1}
                    step={0.01}
                    value={this.props.fader[this.props.faderIndex].ratio}
                    renderThumb={(props: any, state: any) => (
                        <div {...props}>
                            {Math.round(
                                (maxLabel - minLabel) *
                                    parseFloat(state.valueNow) +
                                    minLabel
                            ) + ':1'}
                        </div>
                    )}
                    onChange={(event: any) => {
                        this.handleRatio(event)
                    }}
                />
                <div className="parameter-mini-text">{minLabel + ':1'}</div>
            </div>
        )
    }

    gainReduction() {
        return (
            <div className="parameter-text">
                Redution
                <ReductionMeter faderIndex={this.props.faderIndex} />
            </div>
        )
    }
    delay() {
        let maxLabel: number =
            window.mixerProtocol.channelTypes[0].fromMixer.DELAY_TIME?.[0]
                .maxLabel ?? 1
        let minLabel =
            window.mixerProtocol.channelTypes[0].fromMixer.DELAY_TIME?.[0]
                .minLabel ?? 0
        return (
            <React.Fragment>
                <div className="parameter-text">
                    Time
                    <div className="parameter-mini-text">
                        {maxLabel + ' ms'}
                    </div>
                    <ReactSlider
                        className="chan-strip-fader"
                        thumbClassName="chan-strip-thumb"
                        orientation="vertical"
                        invert
                        min={0}
                        max={1}
                        step={0.01}
                        value={
                            this.props.fader[this.props.faderIndex].delayTime ||
                            0
                        }
                        renderThumb={(props: any, state: any) => (
                            <div {...props}>
                                {Math.round(
                                    (maxLabel - minLabel) *
                                        parseFloat(state.valueNow) +
                                        minLabel
                                )}
                                ms
                            </div>
                        )}
                        onChange={(event: any) => {
                            this.handleDelay(event)
                        }}
                    />
                    <div className="parameter-mini-text">
                        {minLabel + ' ms'}
                    </div>
                </div>
                <div className="delayButtons">
                    <button
                        className="delayTime"
                        onClick={() => {
                            this.changeDelay(
                                this.props.fader[this.props.faderIndex]
                                    .delayTime || 0,
                                10 / 500
                            )
                        }}
                    >
                        +10ms
                    </button>
                    <button
                        className="delayTime"
                        onClick={() => {
                            this.changeDelay(
                                this.props.fader[this.props.faderIndex]
                                    .delayTime || 0,
                                1 / 500
                            )
                        }}
                    >
                        +1ms
                    </button>
                    <button
                        className="delayTime"
                        onClick={() => {
                            this.changeDelay(
                                this.props.fader[this.props.faderIndex]
                                    .delayTime || 0,
                                -1 / 500
                            )
                        }}
                    >
                        -1ms
                    </button>
                    <button
                        className="delayTime"
                        onClick={() => {
                            this.changeDelay(
                                this.props.fader[this.props.faderIndex]
                                    .delayTime || 0,
                                -10 / 500
                            )
                        }}
                    >
                        -10ms
                    </button>
                </div>
            </React.Fragment>
        )
    }
    qFader(fxParam: fxParamsList) {
        let maxLabel: number =
            window.mixerProtocol.channelTypes[0].fromMixer.FX_PARAMS?.[fxParam]
                .params[0].maxLabel ?? 1
        let minLabel =
            window.mixerProtocol.channelTypes[0].fromMixer.FX_PARAMS?.[fxParam]
                .params[0].minLabel ?? 0
        return (
            <div className="parameter-text">
                <div className="parameter-mini-text">
                    Q :{this.props.fxParam[fxParam].value}
                </div>
                <ReactSlider
                    className="chan-strip-q"
                    thumbClassName="chan-strip-q-thumb"
                    orientation="horisontal"
                    min={0}
                    max={1}
                    step={0.01}
                    value={this.props.fxParam[fxParam].value}
                    renderThumb={(props: any, state: any) => (
                        <div {...props}>
                            {Math.round(
                                (maxLabel - minLabel) *
                                    parseFloat(state.valueNow) +
                                    minLabel
                            )}
                            Q
                        </div>
                    )}
                    onChange={(event: any) => {
                        this.handleFx(fxParam, event)
                    }}
                />
            </div>
        )
    }

    fxFader(fxParam: fxParamsList) {
        let maxLabel: number =
            window.mixerProtocol.channelTypes[0].fromMixer.FX_PARAMS?.[fxParam]
                .params[0].maxLabel ?? 1
        let minLabel =
            window.mixerProtocol.channelTypes[0].fromMixer.FX_PARAMS?.[fxParam]
                .params[0].minLabel ?? 0
        return (
            <div className="parameter-text">
                {
                    window.mixerProtocol.channelTypes[0].fromMixer.FX_PARAMS?.[
                        fxParam
                    ].params[0].label
                }
                <div className="parameter-mini-text">{maxLabel}</div>
                <ReactSlider
                    className="chan-strip-fader"
                    thumbClassName="chan-strip-thumb"
                    orientation="vertical"
                    invert
                    min={0}
                    max={1}
                    step={0.01}
                    value={this.props.fxParam[fxParam].value}
                    renderThumb={(props: any, state: any) => (
                        <div {...props}>
                            {Math.round(
                                (maxLabel - minLabel) *
                                    parseFloat(state.valueNow) +
                                    minLabel
                            )}
                            dB
                        </div>
                    )}
                    onChange={(event: any) => {
                        this.handleFx(fxParam, event)
                    }}
                />
                <div className="parameter-mini-text">{minLabel}</div>
            </div>
        )
    }

    monitor(channelIndex: number) {
        let faderIndex = this.props.channel[channelIndex].assignedFader
        if (faderIndex === -1) return null
        let monitorName = this.props.fader[faderIndex]
            ? this.props.fader[faderIndex].label
            : ''
        if (monitorName === '') {
            monitorName =
                'Fader ' +
                String(this.props.channel[channelIndex].assignedFader + 1)
        }
        return (
            <li key={channelIndex}>
                {monitorName}
                <ReactSlider
                    className="chan-strip-fader"
                    thumbClassName="chan-strip-thumb"
                    orientation="vertical"
                    invert
                    min={0}
                    max={1}
                    step={0.01}
                    value={
                        this.props.channel[channelIndex].auxLevel[
                            this.props.auxSendIndex
                        ]
                    }
                    onChange={(event: any) => {
                        this.handleMonitorLevel(event, channelIndex)
                    }}
                />
                <p className="zero-monitor">_______</p>
            </li>
        )
    }

    parameters() {
        if (this.props.offtubeMode) {
            const hasInput =
                window.mixerProtocol.channelTypes[0].toMixer
                    .CHANNEL_INPUT_GAIN ||
                window.mixerProtocol.channelTypes[0].toMixer
                    .CHANNEL_INPUT_SELECTOR
            const hasComp =
                window.mixerProtocol.channelTypes[0].toMixer.THRESHOLD ||
                window.mixerProtocol.channelTypes[0].toMixer.DELAY_TIME
            const hasDelay =
                window.mixerProtocol.channelTypes[0].toMixer.DELAY_TIME
            const hasEq =
                window.mixerProtocol.channelTypes[0].toMixer.FX_PARAMS?.[
                    fxParamsList.EqGain01
                ] ||
                window.mixerProtocol.channelTypes[0].toMixer.FX_PARAMS?.[
                    fxParamsList.EqGain02
                ] ||
                window.mixerProtocol.channelTypes[0].toMixer.FX_PARAMS?.[
                    fxParamsList.EqGain03
                ] ||
                window.mixerProtocol.channelTypes[0].toMixer.FX_PARAMS?.[
                    fxParamsList.EqGain04
                ]
            const hasMonitorSends = this.props.channel.find(
                (ch: any) => ch.auxLevel[this.props.auxSendIndex] >= 0
            )
            return (
                <div className="parameters">
                    <div className="horizontal">
                        {hasInput && (
                            <React.Fragment>
                                <div className="item">
                                    <div className="title">INPUT</div>
                                    <div className="content">
                                        {this.inputSelector()}
                                        {this.inputGain()}
                                    </div>
                                </div>
                            </React.Fragment>
                        )}
                        {hasComp && (
                            <React.Fragment>
                                <div className="item">
                                    <div className="title">COMPRESSOR</div>
                                    <div className="content">
                                        {this.threshold()}
                                        <p className="zero-comp">______</p>
                                        {this.ratio()}
                                        <p className="zero-comp">______</p>
                                        {this.gainReduction()}
                                    </div>
                                </div>
                            </React.Fragment>
                        )}
                        {hasDelay && (
                            <React.Fragment>
                                <div className="item">
                                    <div className="title">DELAY</div>
                                    <div className="content">
                                        {this.delay()}
                                    </div>
                                </div>
                            </React.Fragment>
                        )}
                        {hasMonitorSends && (
                            <React.Fragment>
                                <div className="item">
                                    <div className="title">
                                        {this.props.label ||
                                            'FADER ' +
                                                (this.props.faderIndex + 1)}
                                        {' - MONITOR MIX MINUS'}
                                    </div>
                                    <div className="content">
                                        <ul className="monitor-sends">
                                            {this.props.channel.map(
                                                (ch: any, index: number) => {
                                                    if (
                                                        ch.auxLevel[
                                                            this.props
                                                                .auxSendIndex
                                                        ] >= 0
                                                    ) {
                                                        return this.monitor(
                                                            index
                                                        )
                                                    }
                                                }
                                            )}
                                        </ul>
                                    </div>
                                </div>
                            </React.Fragment>
                        )}
                    </div>
                    <React.Fragment>
                        <hr />
                        <div className="horizontal">{hasEq && this.eq()}</div>
                    </React.Fragment>
                </div>
            )
        } else {
            return null
        }
    }

    render() {
        if (this.props.faderIndex >= 0) {
            return (
                <div className="chan-strip-full-body">
                    <div className="header">
                        {this.props.label ||
                            'FADER ' + (this.props.faderIndex + 1)}
                        <button
                            className="close"
                            onClick={() => this.handleClose()}
                        >
                            X
                        </button>
                        {window.location.search.includes(
                            'settings=0'
                        ) ? null : (
                            <button
                                className="button half"
                                onClick={() => this.handleShowRoutingOptions()}
                            >
                                Ch.Setup
                            </button>
                        )}
                        {window.location.search.includes(
                            'settings=0'
                        ) ? null : (
                            <button
                                className="button half"
                                onClick={() => this.handleShowMonitorOptions()}
                            >
                                Mon.Setup
                            </button>
                        )}
                    </div>
                    <hr />
                    {this.props.selectedProtocol.includes('caspar') ? (
                        <CcgChannelInputSettings
                            channelIndex={this.props.faderIndex}
                        />
                    ) : (
                        this.parameters()
                    )}
                </div>
            )
        } else {
            return <div className="chan-strip-full-body"></div>
        }
    }
}

const mapStateToProps = (state: any, props: any): IChanStripFullInjectProps => {
    let inject: IChanStripFullInjectProps = {
        label: '',
        selectedProtocol: state.settings[0].mixers[0].mixerProtocol,
        numberOfChannelsInType:
            state.settings[0].mixers[0].numberOfChannelsInType,
        channel: state.channels[0].chConnection[0].channel,
        fader: state.faders[0].fader,
        auxSendIndex: -1,
        fxParam: [],
        offtubeMode: state.settings[0].offtubeMode,
    }
    if (props.faderIndex >= 0) {
        inject = {
            label: state.faders[0].fader[props.faderIndex].label,
            selectedProtocol: state.settings[0].mixers[0].mixerProtocol,
            numberOfChannelsInType:
                state.settings[0].mixers[0].numberOfChannelsInType,
            channel: state.channels[0].chConnection[0].channel,
            fader: state.faders[0].fader,
            fxParam: state.faders[0].fader[props.faderIndex].fxParam,
            auxSendIndex: state.faders[0].fader[props.faderIndex].monitor - 1,
            offtubeMode: state.settings[0].offtubeMode,
        }
    }
    return inject
}

export default connect<any, IChanStripFullInjectProps>(mapStateToProps)(
    ChanStripFull
) as any
