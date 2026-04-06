import { MusicProject, Pattern, Track } from './types';

const tracks: Track[] = [
  {
    id: 't1',
    name: 'Pulse Lead',
    trackType: 'lead',
    waveType: 'pulse',
    muted: false,
    solo: false,
    volume: 0.8,
    pan: -0.15,
    octaveShift: 0,
    instrumentSettings: {
      pulseWidth: 0.5,
      attack: 0.01,
      release: 0.08,
      vibratoDepth: 0.04,
    },
  },
  {
    id: 't2',
    name: 'Pulse Sub',
    trackType: 'sub',
    waveType: 'pulse',
    muted: false,
    solo: false,
    volume: 0.65,
    pan: 0.15,
    octaveShift: 0,
    instrumentSettings: {
      pulseWidth: 0.25,
      attack: 0.01,
      release: 0.06,
      vibratoDepth: 0,
    },
  },
  {
    id: 't3',
    name: 'Triangle Bass',
    trackType: 'bass',
    waveType: 'triangle',
    muted: false,
    solo: false,
    volume: 0.7,
    pan: 0,
    octaveShift: -1,
    instrumentSettings: {
      attack: 0.01,
      release: 0.05,
    },
  },
  {
    id: 't4',
    name: 'Noise Drum',
    trackType: 'drum',
    waveType: 'noise',
    muted: false,
    solo: false,
    volume: 0.9,
    pan: 0,
    octaveShift: 0,
    instrumentSettings: {
      kickLevel: 1,
      snareLevel: 1,
      hatLevel: 1,
    },
  },
];


const basePatterns: Pattern[] = [
  {
    id: 'p1',
    trackId: 't1',
    name: 'Lead A',
    lengthInBars: 1,
    stepsPerBar: 16,
    events: [
      { kind: 'note', step: 0, length: 2, pitch: 72, velocity: 1, gate: 0.9 },
      { kind: 'note', step: 4, length: 2, pitch: 75, velocity: 0.9, gate: 0.9 },
      { kind: 'note', step: 8, length: 2, pitch: 79, velocity: 0.95, gate: 0.9 },
      { kind: 'note', step: 12, length: 2, pitch: 77, velocity: 0.9, gate: 0.9 },
    ],
  },
  {
    id: 'p2',
    trackId: 't2',
    name: 'Sub A',
    lengthInBars: 1,
    stepsPerBar: 16,
    events: [
      { kind: 'note', step: 2, length: 2, pitch: 67, velocity: 0.7, gate: 0.85 },
      { kind: 'note', step: 10, length: 2, pitch: 70, velocity: 0.7, gate: 0.85 },
    ],
  },
  {
    id: 'p3',
    trackId: 't3',
    name: 'Bass A',
    lengthInBars: 1,
    stepsPerBar: 16,
    events: [
      { kind: 'note', step: 0, length: 2, pitch: 48, velocity: 1, gate: 0.95 },
      { kind: 'note', step: 4, length: 2, pitch: 48, velocity: 1, gate: 0.95 },
      { kind: 'note', step: 8, length: 2, pitch: 43, velocity: 1, gate: 0.95 },
      { kind: 'note', step: 12, length: 2, pitch: 43, velocity: 1, gate: 0.95 },
    ],
  },
  {
    id: 'p4',
    trackId: 't4',
    name: 'Drum A',
    lengthInBars: 1,
    stepsPerBar: 16,
    events: [
      { kind: 'drum', step: 0, length: 1, drumType: 'kick', velocity: 1, gate: 0.5 },
      { kind: 'drum', step: 4, length: 1, drumType: 'snare', velocity: 0.85, gate: 0.4 },
      { kind: 'drum', step: 8, length: 1, drumType: 'kick', velocity: 1, gate: 0.5 },
      { kind: 'drum', step: 12, length: 1, drumType: 'snare', velocity: 0.85, gate: 0.4 },
      { kind: 'drum', step: 2, length: 1, drumType: 'hat', velocity: 0.55, gate: 0.2 },
      { kind: 'drum', step: 6, length: 1, drumType: 'hat', velocity: 0.55, gate: 0.2 },
      { kind: 'drum', step: 10, length: 1, drumType: 'hat', velocity: 0.55, gate: 0.2 },
      { kind: 'drum', step: 14, length: 1, drumType: 'hat', velocity: 0.55, gate: 0.2 },
    ],
  },
];

export const createDefaultProject = (): MusicProject => {
  const patterns: Pattern[] = [];
  const arrangement = Array.from({ length: 16 }, (_, barIndex) => {
    const patternIdByTrack: Record<string, string> = {};
    tracks.forEach((track, index) => {
      const template = basePatterns[index];
      const clonedPattern: Pattern = {
        ...JSON.parse(JSON.stringify(template)),
        id: `${template.id}_b${barIndex + 1}`,
        name: `${template.name} Bar ${barIndex + 1}`,
        trackId: track.id,
      };
      patterns.push(clonedPattern);
      patternIdByTrack[track.id] = clonedPattern.id;
    });
    return { barIndex, patternIdByTrack };
  });

  return {
  projectVersion: 1,
  title: 'new_project',
  bpm: 140,
  keyRoot: 'C',
  scale: 'minor',
  totalBars: 16,
  masterVolume: 0.9,
  loopSettings: {
    enabled: true,
    startBar: 0,
    endBar: 15,
  },
  exportSettings: {
    format: 'wav',
    sampleRate: 44100,
    bitDepth: 16,
    channels: 2,
  },
  tracks,
  patterns,
  arrangement,
};
};
