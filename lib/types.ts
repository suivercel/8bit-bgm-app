export type WaveType = 'pulse' | 'triangle' | 'noise';
export type TrackType = 'lead' | 'sub' | 'bass' | 'drum';
export type ScaleType = 'major' | 'minor';
export type ExportFormat = 'wav' | 'mp3';
export type BitDepth = 16 | 24;
export type SampleRate = 44100 | 48000;
export type DrumType = 'kick' | 'snare' | 'hat';

export interface ExportSettings {
  format: ExportFormat;
  sampleRate: SampleRate;
  bitDepth: BitDepth;
  channels: 2;
}

export interface PulseInstrumentSettings {
  pulseWidth: number;
  attack: number;
  release: number;
  vibratoDepth: number;
}

export interface TriangleInstrumentSettings {
  attack: number;
  release: number;
}

export interface NoiseInstrumentSettings {
  kickLevel: number;
  snareLevel: number;
  hatLevel: number;
}

export type InstrumentSettings =
  | PulseInstrumentSettings
  | TriangleInstrumentSettings
  | NoiseInstrumentSettings;

export interface Track {
  id: string;
  name: string;
  trackType: TrackType;
  waveType: WaveType;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
  octaveShift: number;
  instrumentSettings: InstrumentSettings;
}

export interface NoteEvent {
  kind: 'note';
  step: number;
  length: number;
  pitch: number;
  velocity: number;
  gate: number;
}

export interface DrumEvent {
  kind: 'drum';
  step: number;
  length: number;
  drumType: DrumType;
  velocity: number;
  gate: number;
}

export type PatternEvent = NoteEvent | DrumEvent;

export interface Pattern {
  id: string;
  trackId: string;
  name: string;
  lengthInBars: number;
  stepsPerBar: 16;
  events: PatternEvent[];
}

export interface ArrangementBar {
  barIndex: number;
  patternIdByTrack: Record<string, string | null>;
}

export interface LoopSettings {
  enabled: boolean;
  startBar: number;
  endBar: number;
}

export interface MusicProject {
  projectVersion: 1;
  title: string;
  bpm: number;
  keyRoot: string;
  scale: ScaleType;
  totalBars: number;
  masterVolume: number;
  loopSettings: LoopSettings;
  exportSettings: ExportSettings;
  tracks: Track[];
  patterns: Pattern[];
  arrangement: ArrangementBar[];
}
