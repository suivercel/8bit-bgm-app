import { midiToFrequency, getStepDurationSeconds, isTrackAudible } from './music';
import { DrumEvent, MusicProject, NoteEvent, PatternEvent, Track } from './types';

function createNoiseBuffer(context: BaseAudioContext) {
  const buffer = context.createBuffer(1, context.sampleRate * 0.2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function scheduleOscillator(
  context: BaseAudioContext,
  destination: AudioNode,
  wave: OscillatorType,
  frequency: number,
  startTime: number,
  duration: number,
  volume: number,
  pan: number,
) {
  const oscillator = context.createOscillator();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, startTime);

  const gainNode = context.createGain();
  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.max(0.02, duration));

  const panner = new StereoPannerNode(context as AudioContext, { pan });

  oscillator.connect(gainNode);
  gainNode.connect(panner);
  panner.connect(destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.03);
}

function scheduleNoise(
  context: BaseAudioContext,
  destination: AudioNode,
  event: DrumEvent,
  startTime: number,
  volume: number,
  pan: number,
) {
  const source = context.createBufferSource();
  source.buffer = createNoiseBuffer(context);

  const filter = context.createBiquadFilter();
  if (event.drumType === 'kick') {
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, startTime);
  } else if (event.drumType === 'snare') {
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, startTime);
  } else {
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(5000, startTime);
  }

  const gainNode = context.createGain();
  const eventVolume = event.drumType === 'hat' ? volume * 0.45 : volume * 0.8;
  gainNode.gain.setValueAtTime(eventVolume, startTime);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + (event.drumType === 'hat' ? 0.05 : 0.12));

  const panner = new StereoPannerNode(context as AudioContext, { pan });

  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(panner);
  panner.connect(destination);

  source.start(startTime);
  source.stop(startTime + 0.15);
}

function scheduleEvent(
  context: BaseAudioContext,
  destination: AudioNode,
  track: Track,
  event: PatternEvent,
  startTime: number,
  stepDuration: number,
  masterVolume: number,
) {
  const volume = Math.max(0.0001, track.volume * masterVolume * ('velocity' in event ? event.velocity : 1));
  const pan = track.pan;

  if (event.kind === 'drum') {
    scheduleNoise(context, destination, event, startTime, volume, pan);
    return;
  }

  const noteEvent = event as NoteEvent;
  const frequency = midiToFrequency(noteEvent.pitch + track.octaveShift * 12);
  const duration = Math.max(0.03, stepDuration * noteEvent.length * noteEvent.gate);
  const wave: OscillatorType = track.waveType === 'triangle' ? 'triangle' : 'square';
  scheduleOscillator(context, destination, wave, frequency, startTime, duration, volume, pan);
}

export function renderProject(project: MusicProject, context: BaseAudioContext, startAt = 0) {
  const destination = context.createGain();
  destination.gain.value = 1;
  destination.connect(context.destination);

  const stepDuration = getStepDurationSeconds(project.bpm);
  const loopStartBar = project.loopSettings.enabled ? project.loopSettings.startBar : startAt;
  const loopEndBar = project.loopSettings.enabled ? project.loopSettings.endBar : project.totalBars - 1;

  for (let barIndex = loopStartBar; barIndex <= loopEndBar; barIndex += 1) {
    for (const track of project.tracks) {
      if (!isTrackAudible(track, project.tracks)) continue;
      const patternId = project.arrangement[barIndex]?.patternIdByTrack[track.id];
      const pattern = project.patterns.find((item) => item.id === patternId);
      if (!pattern) continue;

      for (const event of pattern.events) {
        const eventStart = context.currentTime + (barIndex - loopStartBar) * 16 * stepDuration + event.step * stepDuration;
        scheduleEvent(context, destination, track, event, eventStart, stepDuration, project.masterVolume);
      }
    }
  }

  return {
    totalDuration: (loopEndBar - loopStartBar + 1) * 16 * stepDuration,
  };
}

function audioBufferToWaveBlob(audioBuffer: AudioBuffer, bitDepth: 16 | 24) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.length;
  const bytesPerSample = bitDepth === 24 ? 3 : 2;
  const blockAlign = numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples * blockAlign);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples * blockAlign, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, samples * blockAlign, true);

  let offset = 44;
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < numChannels; channel += 1) {
    channels.push(audioBuffer.getChannelData(channel));
  }

  for (let i = 0; i < samples; i += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      if (bitDepth === 16) {
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      } else {
        const intSample = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
        view.setUint8(offset, intSample & 0xff);
        view.setUint8(offset + 1, (intSample >> 8) & 0xff);
        view.setUint8(offset + 2, (intSample >> 16) & 0xff);
        offset += 3;
      }
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export async function exportWav(project: MusicProject) {
  const stepDuration = getStepDurationSeconds(project.bpm);
  const barCount = project.loopSettings.enabled
    ? project.loopSettings.endBar - project.loopSettings.startBar + 1
    : project.totalBars;
  const duration = Math.max(1, barCount * 16 * stepDuration + 0.5);

  const offlineContext = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(project.exportSettings.sampleRate * duration),
    sampleRate: project.exportSettings.sampleRate,
  });

  renderProject(project, offlineContext, project.loopSettings.startBar);
  const audioBuffer = await offlineContext.startRendering();
  return audioBufferToWaveBlob(audioBuffer, project.exportSettings.bitDepth);
}
