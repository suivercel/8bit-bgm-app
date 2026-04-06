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

function createEmptyPattern(track: Track, barIndex: number): Pattern {
  return {
    id: `${track.id}_b${barIndex + 1}`,
    trackId: track.id,
    name: `${track.name} Bar ${barIndex + 1}`,
    lengthInBars: 1,
    stepsPerBar: 16,
    events: [],
  };
}

export const createDefaultProject = (): MusicProject => {
  const patterns: Pattern[] = [];
  const arrangement = Array.from({ length: 16 }, (_, barIndex) => {
    const patternIdByTrack: Record<string, string> = {};
    tracks.forEach((track) => {
      const pattern = createEmptyPattern(track, barIndex);
      patterns.push(pattern);
      patternIdByTrack[track.id] = pattern.id;
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
