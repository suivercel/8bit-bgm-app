'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { exportWav, renderProject } from '@/lib/audio';
import { createDefaultProject } from '@/lib/defaultProject';
import {
  cloneProject,
  createDrumEvent,
  getEventAtStep,
  getPattern,
  midiToNoteName,
  noteNameToMidi,
  upsertStepEvent,
} from '@/lib/music';
import { DrumType, MusicProject, NoteEvent, Pattern, Track } from '@/lib/types';

const KEY_OPTIONS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const DRUM_ROWS: DrumType[] = ['kick', 'snare', 'hat'];
const LENGTH_OPTIONS = [1, 2, 3, 4] as const;
const STAFF_LINE_CLASSES = new Set([0, 4, 7, 11]);
const NATURAL_NOTE_SEQUENCE = ['B', 'A', 'G', 'F', 'E', 'D', 'C'] as const;
const CHROMATIC_NOTE_SEQUENCE = ['B', 'A#', 'A', 'G#', 'G', 'F#', 'F', 'E', 'D#', 'D', 'C#', 'C'] as const;
const MIN_EDITOR_OCTAVE = 1;
const MAX_EDITOR_OCTAVE = 7;

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function createProjectFileName(title: string) {
  const safe = title.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_') || 'project';
  return `${safe}.eightbit.json`;
}

function getCoveringNoteAt(pattern: Pattern | null, pitch: number, step: number): NoteEvent | null {
  if (!pattern) return null;
  for (const event of pattern.events) {
    if (event.kind !== 'note') continue;
    if (event.pitch !== pitch) continue;
    if (step >= event.step && step < event.step + event.length) return event;
  }
  return null;
}

function clampBar(value: number, totalBars: number) {
  return Math.min(Math.max(1, value), totalBars);
}

function normalizeBarRange(startBar: number, endBar: number, totalBars: number) {
  const safeStart = clampBar(startBar, totalBars);
  const safeEnd = Math.min(Math.max(safeStart, endBar), totalBars);
  return { startBar: safeStart, endBar: safeEnd };
}

function clampEditorOctave(value: number) {
  return Math.min(Math.max(MIN_EDITOR_OCTAVE, value), MAX_EDITOR_OCTAVE);
}

function getDefaultEditorOctave(track: Track | undefined) {
  if (!track) return 4;
  if (track.trackType === 'bass') return 3;
  return 4;
}

function getVisibleNoteRows(octave: number, mode: 'natural' | 'chromatic') {
  const sequence = mode === 'chromatic' ? CHROMATIC_NOTE_SEQUENCE : NATURAL_NOTE_SEQUENCE;
  return sequence.map((name) => {
    const noteName = `${name}${octave}`;
    return { name: noteName, midi: noteNameToMidi(noteName) };
  });
}

function normalizeProject(project: MusicProject): MusicProject {
  const totalBars = project.totalBars || 16;
  const loopLooksZeroBased = project.loopSettings.startBar === 0 || project.loopSettings.endBar === totalBars - 1;
  const rawLoopStart = loopLooksZeroBased ? project.loopSettings.startBar + 1 : project.loopSettings.startBar || 1;
  const rawLoopEnd = loopLooksZeroBased ? project.loopSettings.endBar + 1 : project.loopSettings.endBar || totalBars;
  const loopRange = normalizeBarRange(rawLoopStart, rawLoopEnd, totalBars);
  const rawExportStart = project.exportSettings.startBar ?? 1;
  const rawExportEnd = project.exportSettings.endBar ?? totalBars;
  const exportRange = normalizeBarRange(rawExportStart, rawExportEnd, totalBars);

  return {
    ...project,
    loopSettings: {
      ...project.loopSettings,
      startBar: loopRange.startBar,
      endBar: loopRange.endBar,
    },
    exportSettings: {
      ...project.exportSettings,
      startBar: exportRange.startBar,
      endBar: exportRange.endBar,
    },
  };
}

export default function ComposerApp() {
  const [project, setProject] = useState<MusicProject>(createDefaultProject);
  const [selectedTrackId, setSelectedTrackId] = useState<string>('t1');
  const [selectedBar, setSelectedBar] = useState<number>(0);
  const [playingStep, setPlayingStep] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState<string>('Ready');
  const [clipboardPattern, setClipboardPattern] = useState<Pattern | null>(null);
  const [clipboardMeta, setClipboardMeta] = useState<{ barIndex: number; trackName: string } | null>(null);
  const [selectedEventStep, setSelectedEventStep] = useState<number | null>(null);
  const [editorOctave, setEditorOctave] = useState<number>(4);
  const [editorOctaveByTrack, setEditorOctaveByTrack] = useState<Record<string, number>>({ t1: 4, t2: 4, t3: 3 });
  const [pitchViewMode, setPitchViewMode] = useState<'natural' | 'chromatic'>('natural');
  const audioContextRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<number | null>(null);
  const schedulerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectRef = useRef<MusicProject>(project);
  const playbackLoopRef = useRef<{
    currentStartTime: number;
    currentEndTime: number;
    nextStartTime: number | null;
    nextEndTime: number | null;
    startBar: number;
    endBar: number;
    loopStepCount: number;
    stepDuration: number;
  } | null>(null);

  const selectedTrack = useMemo(
    () => project.tracks.find((track) => track.id === selectedTrackId) ?? project.tracks[0],
    [project.tracks, selectedTrackId],
  );

  const visibleNoteRows = useMemo(() => getVisibleNoteRows(editorOctave, pitchViewMode), [editorOctave, pitchViewMode]);

  const selectedPattern = useMemo(() => getPattern(project, selectedTrackId, selectedBar), [project, selectedTrackId, selectedBar]);
  const selectedEvent = useMemo(() => {
    if (selectedEventStep === null) return null;
    return getEventAtStep(selectedPattern, selectedEventStep);
  }, [selectedEventStep, selectedPattern]);

  const stepIndicators = useMemo(() => {
    return Array.from({ length: 16 }, (_, step) => {
      const startEvent = selectedPattern?.events.find((event) => event.step === step) ?? null;
      if (!startEvent) return '';
      if (startEvent.kind === 'drum') return '•';
      const octave = Math.floor(startEvent.pitch / 12) - 1;
      return String(octave);
    });
  }, [selectedPattern]);

  useEffect(() => {
    setSelectedEventStep(null);
  }, [selectedBar, selectedTrackId]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);


  const selectTrack = (trackId: string) => {
    const nextTrack = project.tracks.find((track) => track.id === trackId);
    setSelectedTrackId(trackId);
    if (nextTrack && nextTrack.trackType !== 'drum') {
      setEditorOctave(editorOctaveByTrack[trackId] ?? getDefaultEditorOctave(nextTrack));
    }
  };

  const getPatternUsageCount = (draft: MusicProject, patternId: string, trackId: string) => {
    return draft.arrangement.filter((bar) => bar.patternIdByTrack[trackId] === patternId).length;
  };

  const ensureEditablePatternId = (draft: MusicProject, trackId: string, barIndex: number) => {
    const currentPatternId = draft.arrangement[barIndex]?.patternIdByTrack[trackId];
    if (!currentPatternId) return null;
    const currentPattern = draft.patterns.find((pattern) => pattern.id === currentPatternId);
    if (!currentPattern) return null;
    const usageCount = getPatternUsageCount(draft, currentPatternId, trackId);
    if (usageCount <= 1) return currentPatternId;

    const clonedPattern: Pattern = {
      ...JSON.parse(JSON.stringify(currentPattern)),
      id: `p${Date.now()}_${barIndex}_${trackId}`,
      name: `${currentPattern.name} bar ${barIndex + 1}`,
      trackId,
    };

    draft.patterns.push(clonedPattern);
    draft.arrangement[barIndex].patternIdByTrack[trackId] = clonedPattern.id;
    return clonedPattern.id;
  };

  const updateProject = (updater: (draft: MusicProject) => MusicProject) => {
    setProject((current) => updater(cloneProject(current)));
  };

  const updateSelectedPattern = (mutator: (pattern: Pattern) => Pattern) => {
    updateProject((draft) => {
      const editablePatternId = ensureEditablePatternId(draft, selectedTrackId, selectedBar);
      if (!editablePatternId) return draft;
      draft.patterns = draft.patterns.map((pattern) => (pattern.id === editablePatternId ? mutator(pattern) : pattern));
      return draft;
    });
  };

  const stopPlayback = (nextStatus = 'Stopped') => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (schedulerRef.current) {
      window.clearInterval(schedulerRef.current);
      schedulerRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    playbackLoopRef.current = null;
    setPlayingStep(null);
    setIsPlaying(false);
    setStatus(nextStatus);
  };

  const startPlayback = async () => {
    stopPlayback('Ready');
    const context = new AudioContext();
    audioContextRef.current = context;

    const initialProject = cloneProject(projectRef.current);
    const playbackLoops = initialProject.loopSettings.enabled;
    const playRange = normalizeBarRange(initialProject.loopSettings.startBar, initialProject.loopSettings.endBar, initialProject.totalBars);
    const stepDuration = (60 / initialProject.bpm) * 0.25;
    const loopStepCount = (playRange.endBar - playRange.startBar + 1) * 16;
    const leadTime = 0.25;

    const scheduleRangeAt = (snapshot: MusicProject, startTime: number) => {
      const rendered = renderProject(snapshot, context, {
        startBar: playRange.startBar,
        endBar: playRange.endBar,
        loopEnabled: false,
        baseTime: startTime,
      });
      return rendered.totalDuration;
    };

    const initialStartTime = context.currentTime + 0.05;
    const initialDuration = scheduleRangeAt(initialProject, initialStartTime);

    if (playbackLoops) {
      playbackLoopRef.current = {
        currentStartTime: initialStartTime,
        currentEndTime: initialStartTime + initialDuration,
        nextStartTime: null,
        nextEndTime: null,
        startBar: playRange.startBar,
        endBar: playRange.endBar,
        loopStepCount,
        stepDuration,
      };

      schedulerRef.current = window.setInterval(() => {
        const loopState = playbackLoopRef.current;
        if (!loopState || context.state === 'closed') return;
        const now = context.currentTime;

        if (loopState.nextStartTime === null && now >= loopState.currentEndTime - leadTime) {
          const nextSnapshot = cloneProject(projectRef.current);
          const nextDuration = scheduleRangeAt(nextSnapshot, loopState.currentEndTime);
          loopState.nextStartTime = loopState.currentEndTime;
          loopState.nextEndTime = loopState.currentEndTime + nextDuration;
        }

        if (loopState.nextStartTime !== null && now >= loopState.currentEndTime) {
          loopState.currentStartTime = loopState.nextStartTime;
          loopState.currentEndTime = loopState.nextEndTime ?? loopState.currentEndTime;
          loopState.nextStartTime = null;
          loopState.nextEndTime = null;
        }
      }, 40);

      intervalRef.current = window.setInterval(() => {
        const loopState = playbackLoopRef.current;
        if (!loopState) return;
        const now = context.currentTime;
        const elapsed = Math.max(0, now - loopState.currentStartTime);
        const rawStep = Math.floor(elapsed / loopState.stepDuration);
        const currentStep = loopState.loopStepCount > 0 ? rawStep % loopState.loopStepCount : rawStep;
        setPlayingStep(currentStep % 16);
      }, 50);

      setIsPlaying(true);
      setStatus(`Playing: bar ${playRange.startBar}-${playRange.endBar}`);
      return;
    }

    intervalRef.current = window.setInterval(() => {
      const elapsed = Math.max(0, context.currentTime - initialStartTime);
      const rawStep = Math.floor(elapsed / stepDuration);
      setPlayingStep(rawStep % 16);
      if (elapsed > initialDuration + 0.05) {
        stopPlayback('Stopped');
      }
    }, 50);

    setIsPlaying(true);
    setStatus(`Playing: bar ${playRange.startBar}-${playRange.endBar}`);

    window.setTimeout(() => {
      stopPlayback('Stopped');
    }, initialDuration * 1000 + 120);
  };

  const setNoteAt = (step: number, pitch: number) => {
    if (!selectedPattern || !selectedTrack || selectedTrack.trackType === 'drum') return;
    const existingEvent = getEventAtStep(selectedPattern, step);
    const isSameNote = existingEvent?.kind === 'note' && existingEvent.pitch === pitch;

    updateSelectedPattern((pattern) => {
      if (isSameNote) {
        return upsertStepEvent(pattern, step, null);
      }
      const nextEvent: NoteEvent = {
        kind: 'note',
        step,
        length: existingEvent?.kind === 'note' ? existingEvent.length : 1,
        pitch,
        velocity: 1,
        gate: 0.9,
      };
      return upsertStepEvent(pattern, step, nextEvent);
    });

    setSelectedEventStep(isSameNote ? null : step);
    setStatus(isSameNote ? `Removed note from bar ${selectedBar + 1}` : `Placed ${midiToNoteName(pitch)} in bar ${selectedBar + 1}`);
  };

  const setDrumAt = (step: number, drumType: DrumType) => {
    if (!selectedPattern || !selectedTrack || selectedTrack.trackType !== 'drum') return;
    const existingEvent = getEventAtStep(selectedPattern, step);
    const isSameDrum = existingEvent?.kind === 'drum' && existingEvent.drumType === drumType;

    updateSelectedPattern((pattern) => upsertStepEvent(pattern, step, isSameDrum ? null : createDrumEvent(step, drumType)));
    setSelectedEventStep(isSameDrum ? null : step);
    setStatus(isSameDrum ? `Removed ${drumType} from bar ${selectedBar + 1}` : `Placed ${drumType} in bar ${selectedBar + 1}`);
  };

  const updateSelectedNoteLength = (length: number) => {
    if (!selectedEvent || selectedEvent.kind !== 'note') return;
    updateSelectedPattern((pattern) =>
      upsertStepEvent(pattern, selectedEvent.step, {
        ...selectedEvent,
        length,
      }),
    );
    setStatus(`Set selected note length to ${length} step`);
  };

  const deleteSelectedEvent = () => {
    if (!selectedEvent) return;
    updateSelectedPattern((pattern) => upsertStepEvent(pattern, selectedEvent.step, null));
    setSelectedEventStep(null);
    setStatus('Deleted selected event');
  };

  const copyCurrentPattern = () => {
    if (!selectedPattern || !selectedTrack) return;
    setClipboardPattern(JSON.parse(JSON.stringify(selectedPattern)) as Pattern);
    setClipboardMeta({ barIndex: selectedBar, trackName: selectedTrack.name });
    setStatus(`Copy: ${selectedTrack.name} / bar ${selectedBar + 1}`);
  };

  const pastePatternToCurrentBar = () => {
    if (!clipboardPattern || !selectedTrack) return;
    const newId = `p${Date.now()}`;
    const newPattern: Pattern = {
      ...(JSON.parse(JSON.stringify(clipboardPattern)) as Pattern),
      id: newId,
      trackId: selectedTrackId,
      name: `${clipboardPattern.name} paste`,
    };

    updateProject((draft) => {
      draft.patterns.push(newPattern);
      draft.arrangement[selectedBar].patternIdByTrack[selectedTrackId] = newId;
      return draft;
    });
    setSelectedEventStep(null);
    setStatus(`Paste: ${selectedTrack.name} / bar ${selectedBar + 1}`);
  };

  const saveProjectFile = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    downloadBlob(blob, createProjectFileName(project.title));
    setStatus('Project saved');
  };

  const loadProjectFile = async (file: File) => {
    const text = await file.text();
    const data = normalizeProject(JSON.parse(text) as MusicProject);
    setProject(data);
    setSelectedTrackId(data.tracks[0]?.id ?? 't1');
    setSelectedBar(0);
    setSelectedEventStep(null);
    const nextOctaves: Record<string, number> = {};
    data.tracks.forEach((track) => {
      nextOctaves[track.id] = getDefaultEditorOctave(track);
    });
    setEditorOctaveByTrack(nextOctaves);
    setEditorOctave(nextOctaves[data.tracks[0]?.id ?? 't1'] ?? getDefaultEditorOctave(data.tracks[0]));
    setStatus('Project loaded');
  };

  const handleExport = async () => {
    if (project.exportSettings.format !== 'wav') {
      setStatus('MP3 is not implemented in this version. Please select WAV.');
      return;
    }
    const exportRange = normalizeBarRange(project.exportSettings.startBar, project.exportSettings.endBar, project.totalBars);
    setStatus(`Exporting WAV: bar ${exportRange.startBar}-${exportRange.endBar}`);
    const blob = await exportWav(project, exportRange);
    downloadBlob(blob, `${project.title || 'bgm'}.wav`);
    setStatus(`WAV exported: bar ${exportRange.startBar}-${exportRange.endBar}`);
  };

  const applyTrackPatch = (trackId: string, patch: Partial<Track>) => {
    updateProject((draft) => {
      draft.tracks = draft.tracks.map((track) => (track.id === trackId ? { ...track, ...patch } : track));
      return draft;
    });
  };

  return (
    <main className="page shell-bg">
      <section className="panel topbar-panel">
        <div className="topbar-layout">
          <div className="topbar-main">
            <div className="topbar-grid compact-topbar-grid">
              <div className="field wide">
                <label>Title</label>
                <input value={project.title} onChange={(e) => updateProject((draft) => ({ ...draft, title: e.target.value }))} />
              </div>
              <div className="field compact">
                <label>BPM</label>
                <input
                  type="number"
                  min={60}
                  max={220}
                  value={project.bpm}
                  onChange={(e) => updateProject((draft) => ({ ...draft, bpm: Number(e.target.value) }))}
                />
              </div>
              <div className="field compact">
                <label>Key</label>
                <select value={project.keyRoot} onChange={(e) => updateProject((draft) => ({ ...draft, keyRoot: e.target.value }))}>
                  {KEY_OPTIONS.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field compact">
                <label>Scale</label>
                <select value={project.scale} onChange={(e) => updateProject((draft) => ({ ...draft, scale: e.target.value as MusicProject['scale'] }))}>
                  <option value="major">major</option>
                  <option value="minor">minor</option>
                </select>
              </div>
            </div>
            <div className="button-row toolbar-actions">
              <button
                onClick={() => {
                  stopPlayback('Ready');
                  const freshProject = createDefaultProject();
                  setProject(freshProject);
                  setSelectedTrackId('t1');
                  setSelectedBar(0);
                  setSelectedEventStep(null);
                  const nextOctaves: Record<string, number> = {};
                  freshProject.tracks.forEach((track) => {
                    nextOctaves[track.id] = getDefaultEditorOctave(track);
                  });
                  setEditorOctaveByTrack(nextOctaves);
                  setEditorOctave(nextOctaves[freshProject.tracks[0]?.id ?? 't1'] ?? getDefaultEditorOctave(freshProject.tracks[0]));
                }}
              >
                New
              </button>
              <button onClick={saveProjectFile}>Save</button>
              <button onClick={() => fileInputRef.current?.click()}>Load</button>
            </div>
          </div>

          <div className="topbar-side">
            <div className="topbar-side-grid">
              <div className="mini-panel">
                <div className="mini-panel-title">Loop / Play</div>
                <div className="mini-grid four">
                  <div className="field slim">
                    <label>Status</label>
                    <select
                      value={project.loopSettings.enabled ? 'on' : 'off'}
                      onChange={(e) =>
                        updateProject((draft) => ({
                          ...draft,
                          loopSettings: { ...draft.loopSettings, enabled: e.target.value === 'on' },
                        }))
                      }
                    >
                      <option value="on">ON</option>
                      <option value="off">OFF</option>
                    </select>
                  </div>
                  <div className="field slim">
                    <label>Start bar</label>
                    <input
                      type="number"
                      min={1}
                      max={project.totalBars}
                      value={project.loopSettings.startBar}
                      onChange={(e) =>
                        updateProject((draft) => {
                          const startBar = clampBar(Number(e.target.value), draft.totalBars);
                          const range = normalizeBarRange(startBar, draft.loopSettings.endBar, draft.totalBars);
                          return {
                            ...draft,
                            loopSettings: { ...draft.loopSettings, startBar: range.startBar, endBar: range.endBar },
                          };
                        })
                      }
                    />
                  </div>
                  <div className="field slim">
                    <label>End bar</label>
                    <input
                      type="number"
                      min={1}
                      max={project.totalBars}
                      value={project.loopSettings.endBar}
                      onChange={(e) =>
                        updateProject((draft) => {
                          const endBar = clampBar(Number(e.target.value), draft.totalBars);
                          const range = normalizeBarRange(draft.loopSettings.startBar, endBar, draft.totalBars);
                          return {
                            ...draft,
                            loopSettings: { ...draft.loopSettings, startBar: range.startBar, endBar: range.endBar },
                          };
                        })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="mini-panel">
                <div className="mini-panel-title">Export</div>
                <div className="mini-grid five">
                  <div className="field slim">
                    <label>Format</label>
                    <select
                      value={project.exportSettings.format}
                      onChange={(e) =>
                        updateProject((draft) => ({
                          ...draft,
                          exportSettings: { ...draft.exportSettings, format: e.target.value as 'wav' | 'mp3' },
                        }))
                      }
                    >
                      <option value="wav">WAV</option>
                      <option value="mp3">MP3</option>
                    </select>
                  </div>
                  <div className="field slim">
                    <label>Sample Rate</label>
                    <select
                      value={project.exportSettings.sampleRate}
                      onChange={(e) =>
                        updateProject((draft) => ({
                          ...draft,
                          exportSettings: { ...draft.exportSettings, sampleRate: Number(e.target.value) as 44100 | 48000 },
                        }))
                      }
                    >
                      <option value={44100}>44.1kHz</option>
                      <option value={48000}>48kHz</option>
                    </select>
                  </div>
                  <div className="field slim">
                    <label>Bit Depth</label>
                    <select
                      value={project.exportSettings.bitDepth}
                      onChange={(e) =>
                        updateProject((draft) => ({
                          ...draft,
                          exportSettings: { ...draft.exportSettings, bitDepth: Number(e.target.value) as 16 | 24 },
                        }))
                      }
                    >
                      <option value={16}>16bit</option>
                      <option value={24}>24bit</option>
                    </select>
                  </div>
                  <div className="field slim">
                    <label>Start bar</label>
                    <input
                      type="number"
                      min={1}
                      max={project.totalBars}
                      value={project.exportSettings.startBar}
                      onChange={(e) =>
                        updateProject((draft) => {
                          const startBar = clampBar(Number(e.target.value), draft.totalBars);
                          const range = normalizeBarRange(startBar, draft.exportSettings.endBar, draft.totalBars);
                          return {
                            ...draft,
                            exportSettings: { ...draft.exportSettings, startBar: range.startBar, endBar: range.endBar },
                          };
                        })
                      }
                    />
                  </div>
                  <div className="field slim">
                    <label>End bar</label>
                    <input
                      type="number"
                      min={1}
                      max={project.totalBars}
                      value={project.exportSettings.endBar}
                      onChange={(e) =>
                        updateProject((draft) => {
                          const endBar = clampBar(Number(e.target.value), draft.totalBars);
                          const range = normalizeBarRange(draft.exportSettings.startBar, endBar, draft.totalBars);
                          return {
                            ...draft,
                            exportSettings: { ...draft.exportSettings, startBar: range.startBar, endBar: range.endBar },
                          };
                        })
                      }
                    />
                  </div>
                </div>
                <div className="button-row">
                  <button className="primary" onClick={handleExport}>
                    Export
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="status-box topbar-status">{status}</div>
      </section>

      <section className="panel section-panel arrangement-panel">
        <div className="section-header compact-section-header">
          <div>
            <h2>Arrangement</h2>
          </div>
        </div>
        <div className="arrangement-grid">
          {project.arrangement.map((bar) => {
            const pattern = getPattern(project, selectedTrackId, bar.barIndex);
            const isCopied = clipboardMeta?.barIndex === bar.barIndex && clipboardMeta?.trackName === selectedTrack?.name;
            return (
              <button
                key={bar.barIndex}
                className={`arrangement-cell ${selectedBar === bar.barIndex ? 'selected' : ''}`}
                onClick={() => setSelectedBar(bar.barIndex)}
                title={`bar ${bar.barIndex + 1}`}
              >
                <strong>bar {bar.barIndex + 1}</strong>
                <span className="arrangement-meta">{pattern?.events.length ?? 0} events</span>
                {isCopied && <span className="arrangement-flag">copied</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel section-panel editor-panel compact-editor-panel">
        <div className="section-header editor-header compact-section-header">
          <div>
            <h2>Pattern Editor</h2>
            <p className="small compact-editor-meta">
              bar {selectedBar + 1} / {selectedTrack?.name}
              {selectedTrack?.trackType !== 'drum' ? ` / view C${editorOctave}-B${editorOctave}` : ''}
              {clipboardMeta ? ` / clipboard: ${clipboardMeta.trackName} bar ${clipboardMeta.barIndex + 1}` : ''}
            </p>
          </div>
        </div>

        <div className="editor-control-bar">
          <div className="editor-track-cluster">
            <div className="track-tab-row">
              {project.tracks.map((track) => (
                <button
                  key={track.id}
                  className={`track-tab ${selectedTrackId === track.id ? 'state-active' : ''}`}
                  onClick={() => selectTrack(track.id)}
                >
                  {track.name}
                </button>
              ))}
            </div>
            {selectedTrack && (
              <div className="track-compact-controls">
                <div className="inline-control slider-inline-control">
                  <span className="toolbar-label">Vol</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={selectedTrack.volume}
                    onChange={(e) => applyTrackPatch(selectedTrack.id, { volume: Number(e.target.value) })}
                  />
                </div>
                <div className="inline-control slider-inline-control">
                  <span className="toolbar-label">Pan</span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={selectedTrack.pan}
                    onChange={(e) => applyTrackPatch(selectedTrack.id, { pan: Number(e.target.value) })}
                  />
                </div>
                <button className={selectedTrack.muted ? 'state-active' : ''} onClick={() => applyTrackPatch(selectedTrack.id, { muted: !selectedTrack.muted })}>
                  {selectedTrack.muted ? 'Unmute' : 'Mute'}
                </button>
                <button className={selectedTrack.solo ? 'state-active' : ''} onClick={() => applyTrackPatch(selectedTrack.id, { solo: !selectedTrack.solo })}>
                  {selectedTrack.solo ? 'Solo Off' : 'Solo'}
                </button>
              </div>
            )}
          </div>

          <div className="editor-action-cluster">
            <div className="button-row compact-actions compact-actions-tight">
              <button onClick={copyCurrentPattern}>Copy</button>
              <button onClick={pastePatternToCurrentBar} disabled={!clipboardPattern}>
                Paste
              </button>
              <button className={`transport-button ${isPlaying ? 'state-active' : ''}`} onClick={() => startPlayback()}>
                Play
              </button>
              <button className={`transport-button ${!isPlaying ? 'state-active' : ''}`} onClick={() => stopPlayback('Stopped')}>
                Stop
              </button>
            </div>
            {selectedTrack?.trackType !== 'drum' && (
              <div className="octave-switch-row">
                <span className="toolbar-label">View</span>
                <div className="pitch-mode-toggle">
                  <button className={pitchViewMode === 'natural' ? 'state-active' : ''} onClick={() => setPitchViewMode('natural')}>
                    7 tones
                  </button>
                  <button className={pitchViewMode === 'chromatic' ? 'state-active' : ''} onClick={() => setPitchViewMode('chromatic')}>
                    12 tones
                  </button>
                </div>
                <span className="toolbar-label">Octave</span>
                <button
                  onClick={() => {
                    const next = clampEditorOctave(editorOctave - 1);
                    setEditorOctave(next);
                    setEditorOctaveByTrack((current) => ({ ...current, [selectedTrack.id]: next }));
                  }}
                  disabled={editorOctave <= MIN_EDITOR_OCTAVE}
                >
                  -
                </button>
                <div className="octave-readout">C{editorOctave} to B{editorOctave}</div>
                <button
                  onClick={() => {
                    const next = clampEditorOctave(editorOctave + 1);
                    setEditorOctave(next);
                    setEditorOctaveByTrack((current) => ({ ...current, [selectedTrack.id]: next }));
                  }}
                  disabled={editorOctave >= MAX_EDITOR_OCTAVE}
                >
                  +
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="editor-toolbar compact-editor-toolbar">
          <div className="editor-selection-box compact-selection-box">
            {!selectedEvent && <span className="small">Tap the grid directly to place a note. New notes start at len 1.</span>}
            {selectedEvent?.kind === 'note' && (
              <>
                <span className="selection-text">Selected: {midiToNoteName(selectedEvent.pitch)} / {selectedEvent.length} step</span>
                <div className="chip-group compact-chip-group">
                  {LENGTH_OPTIONS.map((length) => (
                    <button
                      key={length}
                      className={`chip ${selectedEvent.length === length ? 'active' : ''}`}
                      onClick={() => updateSelectedNoteLength(length)}
                    >
                      len {length}
                    </button>
                  ))}
                  <button className="chip danger" onClick={deleteSelectedEvent}>
                    delete
                  </button>
                </div>
              </>
            )}
            {selectedEvent?.kind === 'drum' && (
              <>
                <span className="selection-text">Selected: {selectedEvent.drumType}</span>
                <button className="chip danger" onClick={deleteSelectedEvent}>
                  delete
                </button>
              </>
            )}
          </div>
        </div>

        {selectedTrack?.trackType === 'drum' ? (
          <div className="drum-board-wrap compact-grid-wrap">
            <div className="drum-board compact-grid-board">
              <div className="step-number-row compact-step-row">
                <div className="lane-label lane-label-header">lane</div>
                {Array.from({ length: 16 }, (_, step) => {
                  const indicator = stepIndicators[step];
                  return (
                    <div key={step} className={`step-number ${playingStep === step ? 'playing' : ''} ${indicator ? 'has-event' : ''}`}>
                      <span className="step-number-main">{step + 1}</span>
                      {indicator ? <span className="step-number-badge">{indicator}</span> : null}
                    </div>
                  );
                })}
              </div>
              {DRUM_ROWS.map((drumType) => (
                <div key={drumType} className="drum-row compact-grid-row">
                  <div className="lane-label">{drumType}</div>
                  {Array.from({ length: 16 }, (_, step) => {
                    const event = getEventAtStep(selectedPattern, step);
                    const active = event?.kind === 'drum' && event.drumType === drumType;
                    return (
                      <button
                        key={`${drumType}-${step}`}
                        className={`drum-cell ${active ? 'active' : ''} ${playingStep === step ? 'playing' : ''}`}
                        onClick={() => setDrumAt(step, drumType)}
                        title={`${drumType} / step ${step + 1}`}
                      >
                        <span className="drum-dot" />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="staff-wrap compact-grid-wrap">
            <div className="staff-board compact-grid-board">
              <div className="step-number-row compact-step-row">
                <div className="lane-label lane-label-header">pitch</div>
                {Array.from({ length: 16 }, (_, step) => {
                  const indicator = stepIndicators[step];
                  return (
                    <div key={step} className={`step-number ${playingStep === step ? 'playing' : ''} ${indicator ? 'has-event' : ''}`}>
                      <span className="step-number-main">{step + 1}</span>
                      {indicator ? <span className="step-number-badge">{indicator}</span> : null}
                    </div>
                  );
                })}
              </div>
              {visibleNoteRows.map((row) => {
                const noteName = row.name;
                const isStaffLine = STAFF_LINE_CLASSES.has(row.midi % 12);
                return (
                  <div key={row.midi} className={`staff-row compact-grid-row natural-row ${isStaffLine ? 'staff-line' : ''}`}>
                    <div className="lane-label">{noteName}</div>
                    {Array.from({ length: 16 }, (_, step) => {
                      const startEvent = getEventAtStep(selectedPattern, step);
                      const covering = getCoveringNoteAt(selectedPattern, row.midi, step);
                      const isStart = startEvent?.kind === 'note' && startEvent.pitch === row.midi;
                      const isHold = Boolean(covering) && !isStart;
                      const isSelected =
                        selectedEvent?.kind === 'note' && covering !== null && covering.step === selectedEvent.step && covering.pitch === row.midi;
                      return (
                        <button
                          key={`${row.midi}-${step}`}
                          className={`note-cell ${isStart ? 'note-start' : ''} ${isHold ? 'note-hold' : ''} ${isSelected ? 'selected' : ''} ${playingStep === step ? 'playing' : ''}`}
                          onClick={() => {
                            if (covering) {
                              const isSelectedStart =
                                selectedEvent?.kind === 'note' &&
                                selectedEvent.step === covering.step &&
                                selectedEvent.pitch === covering.pitch &&
                                covering.step === step;
                              setSelectedEventStep(covering.step);
                              if (isSelectedStart) {
                                setNoteAt(step, row.midi);
                              }
                              return;
                            }
                            setNoteAt(step, row.midi);
                          }}
                          title={`${noteName} / step ${step + 1}`}
                        >
                          {isStart && <span className="note-head" />}
                          {isHold && <span className="note-tail" />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="panel section-panel help-panel">
        <div className="section-header compact-section-header">
          <div>
            <h2>How to use</h2>
          </div>
        </div>
        <div className="help-copy compact-help-copy">
          <p className="small">Pick a bar in Arrangement, choose a track near the editor, then tap the grid directly.</p>
          <p className="small">Use the octave switch to change the visible octave. Drum lanes stay fixed as kick, snare, and hat.</p>
        </div>
      </section>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json,.eightbit.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void loadProjectFile(file);
          }
        }}
      />
    </main>
  );
}
