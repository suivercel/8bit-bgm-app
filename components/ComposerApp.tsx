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
import { DrumType, MusicProject, NoteEvent, Pattern, PatternEvent, Track } from '@/lib/types';

const KEY_OPTIONS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const NOTE_ROW_NAMES = ['C6', 'B5', 'Bb5', 'A5', 'Ab5', 'G5', 'F#5', 'F5', 'E5', 'Eb5', 'D5', 'C#5', 'C5', 'B4', 'Bb4', 'A4', 'Ab4', 'G4', 'F#4', 'F4', 'E4', 'Eb4', 'D4', 'C#4', 'C4'];
const NOTE_ROWS = NOTE_ROW_NAMES.map((name) => ({ name, midi: noteNameToMidi(name) }));
const DRUM_ROWS: DrumType[] = ['kick', 'snare', 'hat'];
const LENGTH_OPTIONS = [1, 2, 3, 4] as const;
const STAFF_LINE_CLASSES = new Set([2, 4, 5, 7, 11]);

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

export default function ComposerApp() {
  const [project, setProject] = useState<MusicProject>(createDefaultProject);
  const [selectedTrackId, setSelectedTrackId] = useState<string>('t1');
  const [selectedBar, setSelectedBar] = useState<number>(0);
  const [playingStep, setPlayingStep] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('Ready');
  const [loopCheckMode, setLoopCheckMode] = useState(false);
  const [clipboardPattern, setClipboardPattern] = useState<Pattern | null>(null);
  const [clipboardMeta, setClipboardMeta] = useState<{ barIndex: number; trackName: string } | null>(null);
  const [selectedEventStep, setSelectedEventStep] = useState<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedTrack = useMemo(
    () => project.tracks.find((track) => track.id === selectedTrackId) ?? project.tracks[0],
    [project.tracks, selectedTrackId],
  );

  const selectedPattern = useMemo(() => getPattern(project, selectedTrackId, selectedBar), [project, selectedTrackId, selectedBar]);
  const selectedEvent = useMemo(() => {
    if (selectedEventStep === null) return null;
    return getEventAtStep(selectedPattern, selectedEventStep);
  }, [selectedEventStep, selectedPattern]);

  useEffect(() => {
    setSelectedEventStep(null);
  }, [selectedBar, selectedTrackId]);

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

  const stopPlayback = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setPlayingStep(null);
  };

  const startPlayback = async (loopOnly = false) => {
    stopPlayback();
    const context = new AudioContext();
    audioContextRef.current = context;

    const tempProject = cloneProject(project);
    if (loopOnly) {
      tempProject.loopSettings.enabled = true;
    }

    const { totalDuration } = renderProject(tempProject, context, tempProject.loopSettings.startBar);
    const stepDurationMs = (60 / tempProject.bpm) * 0.25 * 1000;
    const loopStepCount = (tempProject.loopSettings.endBar - tempProject.loopSettings.startBar + 1) * 16;
    const startedAt = performance.now();
    setStatus(loopOnly ? 'ループ重点確認を再生中' : '再生中');

    intervalRef.current = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const rawStep = Math.floor(elapsed / stepDurationMs);
      const currentStep = loopStepCount > 0 ? rawStep % loopStepCount : rawStep;
      setPlayingStep(currentStep % 16);
      if (!tempProject.loopSettings.enabled && elapsed > totalDuration * 1000 + 50) {
        stopPlayback();
        setStatus('再生停止');
      }
    }, 50);

    if (!tempProject.loopSettings.enabled) {
      window.setTimeout(() => {
        stopPlayback();
        setStatus('再生停止');
      }, totalDuration * 1000 + 80);
    }
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
        length: existingEvent?.kind === 'note' ? existingEvent.length : 2,
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
    const data = JSON.parse(text) as MusicProject;
    setProject(data);
    setSelectedTrackId(data.tracks[0]?.id ?? 't1');
    setSelectedBar(0);
    setSelectedEventStep(null);
    setStatus('Project loaded');
  };

  const handleExport = async () => {
    if (project.exportSettings.format !== 'wav') {
      setStatus('MP3 is not implemented in this version. Please select WAV.');
      return;
    }
    setStatus('Exporting WAV');
    const blob = await exportWav(project);
    downloadBlob(blob, `${project.title || 'bgm'}.wav`);
    setStatus('WAV exported');
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
            <div className="topbar-grid">
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
              <button onClick={() => setProject(createDefaultProject())}>New</button>
              <button className="primary" onClick={() => startPlayback(false)}>
                Play
              </button>
              <button onClick={stopPlayback}>Stop</button>
              <button onClick={saveProjectFile}>Save</button>
              <button onClick={() => fileInputRef.current?.click()}>Load</button>
            </div>
          </div>

          <div className="topbar-side">
            <div className="topbar-side-grid">
              <div className="mini-panel">
                <div className="mini-panel-title">Loop</div>
                <div className="mini-grid three">
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
                      min={0}
                      max={project.totalBars - 1}
                      value={project.loopSettings.startBar}
                      onChange={(e) =>
                        updateProject((draft) => ({
                          ...draft,
                          loopSettings: { ...draft.loopSettings, startBar: Number(e.target.value) },
                        }))
                      }
                    />
                  </div>
                  <div className="field slim">
                    <label>End bar</label>
                    <input
                      type="number"
                      min={project.loopSettings.startBar}
                      max={project.totalBars - 1}
                      value={project.loopSettings.endBar}
                      onChange={(e) =>
                        updateProject((draft) => ({
                          ...draft,
                          loopSettings: { ...draft.loopSettings, endBar: Number(e.target.value) },
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="button-row">
                  <button onClick={() => setLoopCheckMode((prev) => !prev)}>{loopCheckMode ? 'Focused Loop Off' : 'Focused Loop On'}</button>
                  <button className="primary" onClick={() => startPlayback(loopCheckMode)}>
                    {loopCheckMode ? 'Play Focused Loop' : 'Play Range'}
                  </button>
                </div>
              </div>

              <div className="mini-panel">
                <div className="mini-panel-title">Export</div>
                <div className="mini-grid three">
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

      <section className="panel section-panel track-panel">
        <div className="section-header compact-section-header">
          <div>
            <h2>Track</h2>
          </div>
        </div>

        <div className="track-list">
          {project.tracks.map((track) => (
            <div key={track.id} className={`track-row ${selectedTrackId === track.id ? 'active' : ''}`}>
              <button className="track-select" onClick={() => setSelectedTrackId(track.id)}>
                <span>{track.name}</span>
                <span className="track-badge">{track.trackType}</span>
              </button>
              <div className="field slim">
                <label>Volume</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={track.volume}
                  onChange={(e) => applyTrackPatch(track.id, { volume: Number(e.target.value) })}
                />
              </div>
              <div className="field slim">
                <label>Pan</label>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={track.pan}
                  onChange={(e) => applyTrackPatch(track.id, { pan: Number(e.target.value) })}
                />
              </div>
              <div className="track-actions">
                <button onClick={() => applyTrackPatch(track.id, { muted: !track.muted })}>{track.muted ? 'Unmute' : 'Mute'}</button>
                <button onClick={() => applyTrackPatch(track.id, { solo: !track.solo })}>{track.solo ? 'Solo Off' : 'Solo'}</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel section-panel editor-panel">
        <div className="section-header editor-header">
          <div>
            <h2>Pattern Editor</h2>
            <p className="small">
              bar {selectedBar + 1} / {selectedTrack?.name}
              {clipboardMeta ? ` / clipboard: ${clipboardMeta.trackName} bar ${clipboardMeta.barIndex + 1}` : ''}
            </p>
          </div>
          <div className="button-row compact-actions">
            <button onClick={copyCurrentPattern}>Copy</button>
            <button onClick={pastePatternToCurrentBar} disabled={!clipboardPattern}>
              Paste into bar {selectedBar + 1}
            </button>
          </div>
        </div>

        <div className="editor-toolbar">
          <div className="editor-selection-box">
            {!selectedEvent && <span className="small">Tap an empty cell to place a note. Tap the same start cell again to remove it.</span>}
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
          <div className="drum-board-wrap">
            <div className="drum-board">
              <div className="step-number-row">
                <div className="lane-label lane-label-header">lane</div>
                {Array.from({ length: 16 }, (_, step) => (
                  <div key={step} className={`step-number ${playingStep === step ? 'playing' : ''}`}>
                    {step + 1}
                  </div>
                ))}
              </div>
              {DRUM_ROWS.map((drumType) => (
                <div key={drumType} className="drum-row">
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
          <div className="staff-wrap">
            <div className="staff-board">
              <div className="step-number-row">
                <div className="lane-label lane-label-header">pitch</div>
                {Array.from({ length: 16 }, (_, step) => (
                  <div key={step} className={`step-number ${playingStep === step ? 'playing' : ''}`}>
                    {step + 1}
                  </div>
                ))}
              </div>
              {NOTE_ROWS.map((row) => {
                const noteName = midiToNoteName(row.midi);
                const isStaffLine = STAFF_LINE_CLASSES.has(row.midi % 12);
                const isNatural = !noteName.includes('#') && !noteName.includes('b');
                return (
                  <div key={row.midi} className={`staff-row ${isStaffLine ? 'staff-line' : ''} ${isNatural ? 'natural-row' : 'accidental-row'}`}>
                    <div className="lane-label">{noteName}</div>
                    {Array.from({ length: 16 }, (_, step) => {
                      const startEvent = getEventAtStep(selectedPattern, step);
                      const covering = getCoveringNoteAt(selectedPattern, row.midi, step);
                      const isStart = startEvent?.kind === 'note' && startEvent.pitch === row.midi;
                      const isHold = Boolean(covering) && !isStart;
                      const isSelected =
                        selectedEvent?.kind === 'note' &&
                        covering !== null &&
                        covering.step === selectedEvent.step &&
                        covering.pitch === row.midi;
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
          <p className="small">Select a bar in Arrangement, choose a track, then tap the grid directly.</p>
          <p className="small">Copy stores the selected track and bar. Paste applies it to the currently selected bar.</p>
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
