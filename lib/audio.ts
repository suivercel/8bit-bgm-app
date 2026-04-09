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

function normalizeBarRange(startBar: number, endBar: number, totalBars: number) {
  const safeStart = Math.min(Math.max(1, startBar), totalBars);
  const safeEnd = Math.min(Math.max(safeStart, endBar), totalBars);
  return { startBar: safeStart, endBar: safeEnd };
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
  const panner = new StereoPannerNode(context as AudioContext, { pan });
  panner.connect(destination);

  if (event.drumType === 'kick') {
    // --- kick: 正弦波の胴鳴り（ピッチダウン）+ ノイズのアタック層を合成 ---
    const boostVolume = volume * 10.0;

    // 正弦波レイヤー: 120Hz → 50Hz へピッチダウンして胴鳴りを再現
    const sineOsc = context.createOscillator();
    sineOsc.type = 'sine';
    sineOsc.frequency.setValueAtTime(120, startTime);
    sineOsc.frequency.exponentialRampToValueAtTime(50, startTime + 0.08);

    const sineGain = context.createGain();
    sineGain.gain.setValueAtTime(boostVolume, startTime);
    sineGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.30);

    sineOsc.connect(sineGain);
    sineGain.connect(panner);
    sineOsc.start(startTime);
    sineOsc.stop(startTime + 0.35);

    // ノイズレイヤー: 2kHz 以下を通してアタックの「バスッ」感を追加
    const noiseSource = context.createBufferSource();
    noiseSource.buffer = createNoiseBuffer(context);

    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(2000, startTime);

    const noiseGain = context.createGain();
    noiseGain.gain.setValueAtTime(boostVolume * 0.6, startTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.06);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(panner);
    noiseSource.start(startTime);
    noiseSource.stop(startTime + 0.10);

  } else if (event.drumType === 'snare') {
    // --- snare: 帯域を広げ（800-3000Hz）、ノイズ層を強化 ---
    const boostVolume = volume * 6.0;

    const source = context.createBufferSource();
    source.buffer = createNoiseBuffer(context);

    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, startTime);
    filter.Q.value = 0.5;

    const gainNode = context.createGain();
    gainNode.gain.setValueAtTime(boostVolume, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.18);

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(panner);
    source.start(startTime);
    source.stop(startTime + 0.25);

  } else {
    // --- hat: highpass はそのままに boost を強化 ---
    const boostVolume = volume * 4.0;

    const source = context.createBufferSource();
    source.buffer = createNoiseBuffer(context);

    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(5000, startTime);

    const gainNode = context.createGain();
    gainNode.gain.setValueAtTime(boostVolume, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.08);

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(panner);
    source.start(startTime);
    source.stop(startTime + 0.12);
  }
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
  const volume = Math.max(
    0.0001,
    track.volume * masterVolume * (event.kind === 'note' ? event.velocity : 1),
  );

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

export function renderProject(
  project: MusicProject,
  context: BaseAudioContext,
  options?: { startBar?: number; endBar?: number; loopEnabled?: boolean; baseTime?: number },
) {
  const destination = context.createGain();
  destination.gain.value = 1;
  destination.connect(context.destination);

  const stepDuration = getStepDurationSeconds(project.bpm);
  const fallbackRange = project.loopSettings.enabled
    ? { startBar: project.loopSettings.startBar, endBar: project.loopSettings.endBar }
    : { startBar: 1, endBar: project.totalBars };
  const requestedStart = options?.startBar ?? fallbackRange.startBar;
  const requestedEnd = options?.endBar ?? fallbackRange.endBar;
  const range = normalizeBarRange(requestedStart, requestedEnd, project.totalBars);
  const startIndex = range.startBar - 1;
  const endIndex = range.endBar - 1;

  for (let barIndex = startIndex; barIndex <= endIndex; barIndex += 1) {
    for (const track of project.tracks) {
      if (!isTrackAudible(track, project.tracks)) continue;
      const patternId = project.arrangement[barIndex]?.patternIdByTrack[track.id];
      const pattern = project.patterns.find((item) => item.id === patternId);
      if (!pattern) continue;

      for (const event of pattern.events) {
        const timelineBase = options?.baseTime ?? context.currentTime;
        const eventStart = timelineBase + (barIndex - startIndex) * 16 * stepDuration + event.step * stepDuration;
        scheduleEvent(context, destination, track, event, eventStart, stepDuration, project.masterVolume);
      }
    }
  }

  return {
    totalDuration: (endIndex - startIndex + 1) * 16 * stepDuration,
    startBar: range.startBar,
    endBar: range.endBar,
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

export async function exportWav(project: MusicProject, range?: { startBar?: number; endBar?: number }) {
  const stepDuration = getStepDurationSeconds(project.bpm);
  const normalized = normalizeBarRange(range?.startBar ?? project.exportSettings.startBar, range?.endBar ?? project.exportSettings.endBar, project.totalBars);
  const barCount = normalized.endBar - normalized.startBar + 1;
  const duration = Math.max(1, barCount * 16 * stepDuration + 0.5);

  const offlineContext = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(project.exportSettings.sampleRate * duration),
    sampleRate: project.exportSettings.sampleRate,
  });

  renderProject(project, offlineContext, { startBar: normalized.startBar, endBar: normalized.endBar, loopEnabled: false });
  const audioBuffer = await offlineContext.startRendering();
  return audioBufferToWaveBlob(audioBuffer, project.exportSettings.bitDepth);
}
