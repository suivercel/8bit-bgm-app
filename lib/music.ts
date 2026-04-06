import { DrumEvent, MusicProject, Pattern, PatternEvent, Track } from './types';

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function midiToNoteName(midi: number) {
  const note = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

export function noteNameToMidi(noteName: string): number {
  const match = noteName.match(/^([A-G])(#|b)?(\d)$/);
  if (!match) return 60;
  const [, root, accidental = '', octaveStr] = match;
  const normalized = `${root}${accidental === 'b' ? 'b' : accidental}`;
  const sharpMap: Record<string, string> = { Db: 'C#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
  const name = sharpMap[normalized] || normalized;
  const noteIndexMap: Record<string, number> = {
    C: 0,
    'C#': 1,
    D: 2,
    Eb: 3,
    E: 4,
    F: 5,
    'F#': 6,
    G: 7,
    Ab: 8,
    A: 9,
    Bb: 10,
    B: 11,
    'G#': 8,
    'A#': 10,
  };
  return (Number(octaveStr) + 1) * 12 + (noteIndexMap[name] ?? 0);
}

export function getPattern(project: MusicProject, trackId: string, barIndex: number) {
  const patternId = project.arrangement[barIndex]?.patternIdByTrack[trackId];
  return project.patterns.find((pattern) => pattern.id === patternId) || null;
}

export function getEventAtStep(pattern: Pattern | null, step: number): PatternEvent | null {
  if (!pattern) return null;
  return pattern.events.find((event) => event.step === step) || null;
}

export function upsertStepEvent(
  pattern: Pattern,
  step: number,
  event: PatternEvent | null,
): Pattern {
  const filtered = pattern.events.filter((item) => item.step !== step);
  return {
    ...pattern,
    events: event ? [...filtered, event].sort((a, b) => a.step - b.step) : filtered,
  };
}

export function getStepDurationSeconds(bpm: number, stepsPerBar = 16) {
  const beatsPerBar = 4;
  return (60 / bpm) * (beatsPerBar / stepsPerBar);
}

export function midiToFrequency(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function hasSolo(tracks: Track[]) {
  return tracks.some((track) => track.solo);
}

export function isTrackAudible(track: Track, tracks: Track[]) {
  if (track.muted) return false;
  if (hasSolo(tracks)) return track.solo;
  return true;
}

export function cloneProject<T>(project: T): T {
  return JSON.parse(JSON.stringify(project));
}

export function createDrumEvent(step: number, drumType: DrumEvent['drumType']): DrumEvent {
  return {
    kind: 'drum',
    step,
    length: 1,
    drumType,
    velocity: drumType === 'hat' ? 0.55 : 1,
    gate: drumType === 'hat' ? 0.2 : 0.4,
  };
}
