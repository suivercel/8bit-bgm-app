'use client';

import { useMemo, useRef, useState } from 'react';
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
import { MusicProject, NoteEvent, Pattern, PatternEvent, Track } from '@/lib/types';

const NOTE_OPTIONS = ['C3', 'D3', 'Eb3', 'F3', 'G3', 'Ab3', 'Bb3', 'C4', 'D4', 'Eb4', 'F4', 'G4', 'Ab4', 'Bb4', 'C5', 'D5', 'Eb5', 'F5', 'G5', 'Ab5', 'Bb5', 'C6'];

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

export default function ComposerApp() {
  const [project, setProject] = useState<MusicProject>(createDefaultProject);
  const [selectedTrackId, setSelectedTrackId] = useState<string>('t1');
  const [selectedBar, setSelectedBar] = useState<number>(0);
  const [playingStep, setPlayingStep] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('準備完了');
  const [loopCheckMode, setLoopCheckMode] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedTrack = useMemo(
    () => project.tracks.find((track) => track.id === selectedTrackId) ?? project.tracks[0],
    [project.tracks, selectedTrackId],
  );

  const selectedPattern = useMemo(() => getPattern(project, selectedTrackId, selectedBar), [project, selectedTrackId, selectedBar]);

  const updateProject = (updater: (draft: MusicProject) => MusicProject) => {
    setProject((current) => updater(cloneProject(current)));
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

  const onStepToggle = (step: number, checked: boolean) => {
    if (!selectedPattern || !selectedTrack) return;

    const currentEvent = getEventAtStep(selectedPattern, step);
    let nextEvent: PatternEvent | null = null;

    if (checked) {
      if (selectedTrack.trackType === 'drum') {
        const drumType = currentEvent && currentEvent.kind === 'drum' ? currentEvent.drumType : 'kick';
        nextEvent = createDrumEvent(step, drumType);
      } else {
        const noteName = currentEvent && currentEvent.kind === 'note' ? midiToNoteName(currentEvent.pitch) : 'C5';
        nextEvent = {
          kind: 'note',
          step,
          length: 2,
          pitch: noteNameToMidi(noteName),
          velocity: 1,
          gate: 0.9,
        } satisfies NoteEvent;
      }
    }

    updateProject((draft) => {
      draft.patterns = draft.patterns.map((pattern: Pattern) =>
        pattern.id === selectedPattern.id ? upsertStepEvent(pattern, step, nextEvent) : pattern,
      );
      return draft;
    });
  };

  const updateNoteField = (step: number, field: 'pitch' | 'length' | 'drumType', value: string | number) => {
    if (!selectedPattern) return;
    const event = getEventAtStep(selectedPattern, step);
    if (!event) return;

    let nextEvent: PatternEvent = event;

    if (event.kind === 'note') {
      nextEvent = {
        ...event,
        pitch: field === 'pitch' && typeof value === 'string' ? noteNameToMidi(value) : event.pitch,
        length: field === 'length' && typeof value === 'number' ? value : event.length,
      };
    }

    if (event.kind === 'drum') {
      nextEvent = {
        ...event,
        drumType: field === 'drumType' && typeof value === 'string' ? (value as 'kick' | 'snare' | 'hat') : event.drumType,
      };
    }

    updateProject((draft) => {
      draft.patterns = draft.patterns.map((pattern: Pattern) =>
        pattern.id === selectedPattern.id ? upsertStepEvent(pattern, step, nextEvent) : pattern,
      );
      return draft;
    });
  };

  const duplicateCurrentPattern = () => {
    if (!selectedPattern) return;
    const newId = `p${Date.now()}`;
    const newPattern: Pattern = {
      ...(JSON.parse(JSON.stringify(selectedPattern)) as Pattern),
      id: newId,
      name: `${selectedPattern.name} Copy`,
    };

    updateProject((draft) => {
      draft.patterns.push(newPattern);
      draft.arrangement[selectedBar].patternIdByTrack[selectedTrackId] = newId;
      return draft;
    });
    setStatus('選択パターンを複製しました');
  };

  const saveProjectFile = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    downloadBlob(blob, createProjectFileName(project.title));
    setStatus('プロジェクトを保存しました');
  };

  const loadProjectFile = async (file: File) => {
    const text = await file.text();
    const data = JSON.parse(text) as MusicProject;
    setProject(data);
    setSelectedTrackId(data.tracks[0]?.id ?? 't1');
    setSelectedBar(0);
    setStatus('プロジェクトを読み込みました');
  };

  const handleExport = async () => {
    if (project.exportSettings.format !== 'wav') {
      setStatus('この版ではMP3未実装です。WAVを選んでください。');
      return;
    }
    setStatus('WAVを書き出し中');
    const blob = await exportWav(project);
    downloadBlob(blob, `${project.title || 'bgm'}.wav`);
    setStatus('WAVを書き出しました');
  };

  const applyTrackPatch = (trackId: string, patch: Partial<Track>) => {
    updateProject((draft) => {
      draft.tracks = draft.tracks.map((track: Track) => (track.id === trackId ? { ...track, ...patch } : track));
      return draft;
    });
  };

  return (
    <main className="page shell-bg">

      <section className="panel topbar-panel">
        <div className="topbar-grid">
          <div className="field wide">
            <label>曲名</label>
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
            <label>キー</label>
            <select value={project.keyRoot} onChange={(e) => updateProject((draft) => ({ ...draft, keyRoot: e.target.value }))}>
              {['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].map((key: string) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </div>
          <div className="field compact">
            <label>スケール</label>
            <select value={project.scale} onChange={(e) => updateProject((draft) => ({ ...draft, scale: e.target.value as MusicProject['scale'] }))}>
              <option value="major">major</option>
              <option value="minor">minor</option>
            </select>
          </div>
        </div>
        <div className="button-row toolbar-actions">
          <button onClick={() => setProject(createDefaultProject())}>新規</button>
          <button className="primary" onClick={() => startPlayback(false)}>
            再生
          </button>
          <button onClick={stopPlayback}>停止</button>
          <button onClick={saveProjectFile}>保存</button>
          <button onClick={() => fileInputRef.current?.click()}>読込</button>
        </div>
      </section>

      <div className="app-grid">
        <section className="panel section-panel">
          <div className="section-header">
            <div>
              <h2>トラック</h2>
            </div>
          </div>

          <div className="track-list">
            {project.tracks.map((track: Track) => (
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
                  <button onClick={() => applyTrackPatch(track.id, { muted: !track.muted })}>{track.muted ? 'ミュート解除' : 'ミュート'}</button>
                  <button onClick={() => applyTrackPatch(track.id, { solo: !track.solo })}>{track.solo ? 'ソロ解除' : 'ソロ'}</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel section-panel editor-panel">
          <div className="section-header">
            <div>
              <h2>パターン編集</h2>
              <p className="small">
                選択中: 小節 {selectedBar + 1} / {selectedTrack?.name}
              </p>
            </div>
            <div className="button-row compact-actions">
              <button onClick={duplicateCurrentPattern}>パターン複製</button>
              <button onClick={() => setLoopCheckMode((prev) => !prev)}>{loopCheckMode ? 'ループ重点確認 OFF' : 'ループ重点確認 ON'}</button>
            </div>
          </div>

          <div className="pattern-grid">
            <div className="step-grid">
              {Array.from({ length: 16 }, (_, step) => {
                const event = getEventAtStep(selectedPattern, step);
                return (
                  <div key={step} className={`step-cell ${playingStep === step ? 'playing' : ''}`}>
                    <div className="step-header">
                      <strong>Step {step + 1}</strong>
                      <input
                        className="checkbox"
                        type="checkbox"
                        checked={Boolean(event)}
                        onChange={(e) => onStepToggle(step, e.target.checked)}
                      />
                    </div>
                    {!event && <div className="small">空き</div>}
                    {event?.kind === 'note' && (
                      <>
                        <div className="field">
                          <label>Note</label>
                          <select value={midiToNoteName(event.pitch)} onChange={(e) => updateNoteField(step, 'pitch', e.target.value)}>
                            {NOTE_OPTIONS.map((note: string) => (
                              <option key={note} value={note}>
                                {note}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label>Length</label>
                          <select value={event.length} onChange={(e) => updateNoteField(step, 'length', Number(e.target.value))}>
                            {[1, 2, 3, 4].map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                    {event?.kind === 'drum' && (
                      <div className="field">
                        <label>Drum</label>
                        <select value={event.drumType} onChange={(e) => updateNoteField(step, 'drumType', e.target.value)}>
                          {['kick', 'snare', 'hat'].map((drum: string) => (
                            <option key={drum} value={drum}>
                              {drum}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="panel section-panel side-panel">
          <div className="section-header">
            <div>
              <h2>ループ / 書き出し</h2>
            </div>
          </div>

          <div className="field">
            <label>ループ</label>
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
          <div className="loop-range-grid">
            <div className="field">
              <label>開始小節</label>
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
            <div className="field">
              <label>終了小節</label>
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
          <div className="button-row stretch-row">
            <button className="primary" onClick={() => startPlayback(loopCheckMode)}>
              {loopCheckMode ? 'ループ重点確認を再生' : '通常再生'}
            </button>
          </div>

          <div className="divider" />

          <div className="field">
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
              <option value="mp3">MP3 (未実装)</option>
            </select>
          </div>
          <div className="field">
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
          <div className="field">
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
              <option value={16}>16bit PCM</option>
              <option value={24}>24bit PCM</option>
            </select>
          </div>
          <div className="button-row stretch-row">
            <button className="primary" onClick={handleExport}>
              書き出し
            </button>
          </div>
          <div className="status-box">{status}</div>
        </section>
      </div>

      <section className="panel section-panel arrangement-panel">
        <div className="section-header">
          <div>
            <h2>曲順</h2>
          </div>
        </div>
        <div className="arrangement-grid">
          {project.arrangement.map((bar) => (
            <div key={bar.barIndex} className={`arrangement-cell ${selectedBar === bar.barIndex ? 'selected' : ''}`}>
              <strong>Bar {bar.barIndex + 1}</strong>
              <div className="small arrangement-copy">編集対象</div>
              <button onClick={() => setSelectedBar(bar.barIndex)}>{selectedBar === bar.barIndex ? '選択中' : '選択する'}</button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel section-panel help-panel">
        <div className="section-header">
          <div>
            <h2>使い方</h2>
          </div>
        </div>
        <div className="help-copy">
          <p className="small">曲名、BPM、キーを決めてトラックを選び、各ステップをオンにして音を置きます。</p>
          <p className="small">小節を切り替えながらパターンを作り、必要に応じて複製して曲順を組みます。</p>
          <p className="small">保存は <span className="kbd">.eightbit.json</span> のプロジェクトファイルです。完成したらWAVで書き出します。</p>
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
