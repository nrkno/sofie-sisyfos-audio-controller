# Producers Audio-Mixer

## Audiomixer control build with the logic from a videomixer.

You use the fader for the level, and PGM on/off for fade-in/out.
TAKE crossfades between PGM & PST:
<img src="Docs/pix/ProducersAudioMixer01.png">


### Snaps takes preset into PST:


<img src="Docs/pix/ProducersAudioMixer.png">



### Install:
```
git clone https://github.com/olzzon/producers-audio-mixer.git
cd producers-audio-mixer
yarn
yarn start
```
Settings for Mixer protol are in ./src/utils/MixerProtocolPresets.js
