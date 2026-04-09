import { MusicProject, Pattern, Track } from './types';

const tracks: Track[] = [
  {
    id: 't1',
    name: 'Pulse Lead',
    trackType: 'lead',
    waveType: 'pulse',
    muted: false,
    solo: false,
    volume: 0.55,   // 0.7 → 0.55: 他トラックとのバランス確保のため抑制
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
    volume: 0.45,   // 0.6 → 0.45: Lead と被らないよう抑制
    pan: 0.15,
    octaveShift: -1, // 0 → -1: sub として1オクターブ下げ、Lead と音域を分離
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
    volume: 0.95,   // 0.85 → 0.95: 低域・triangle は小さいスピーカーで埋もれやすいため補強
    pan: 0,
    octaveShift: 0,  // -1 → 0: 実音域を C3-B3 に上げ、小さいスピーカーでも聞こえやすく
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
    volume: 0.9,    // 0.8 → 0.9: ドラム全体の存在感を上げる
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
      startBar: 1,
      endBar: 16,
    },
    exportSettings: {
      format: 'wav',
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      startBar: 1,
      endBar: 16,
    },
    tracks,
    patterns,
    arrangement,
  };
};
