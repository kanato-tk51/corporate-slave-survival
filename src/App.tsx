import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  type ActiveTask,
  type AvatarId,
  type BestRecord,
  type EndReason,
  type GamePhase,
  type PersonId,
  type PersonImageSource,
  type PersonSetting,
  type PersonSettings,
  type Result,
  type StatDelta,
  type Stats,
  type TaskType,
  AVATAR_ORDER,
  AVATAR_PRESETS,
  PERSON_DEFINITIONS,
  PERSON_ORDER,
  TASK_DEFINITIONS,
  GAME_DURATION_MS,
  INITIAL_STATS,
  LANE_COUNT,
  applyEffect,
  createResult,
  getSpawnInterval,
  getResolvedEffect,
  loadBestRecord,
  loadPersonSettings,
  pickPersonForTask,
  pickTaskType,
  saveBestRecord,
  savePersonSettings,
} from "./game";

type LogTone = "good" | "bad" | "neutral" | "rest" | "warn";

type LogEntry = {
  id: number;
  message: string;
  tone: LogTone;
};

type SoundKind = "start" | "normal" | "break" | "miss" | "warning" | "end";

type WindowWithWebkitAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const statusLabels: Array<{
  key: keyof Stats;
  label: string;
  max: number;
  tone: "good" | "warning" | "danger" | "neutral";
}> = [
  { key: "stamina", label: "体力", max: 100, tone: "good" },
  { key: "trust", label: "信頼", max: 100, tone: "good" },
  { key: "focus", label: "集中力", max: 100, tone: "warning" },
  { key: "fire", label: "炎上度", max: 100, tone: "danger" },
  { key: "backlog", label: "残タスク", max: 50, tone: "neutral" },
];

const statDisplayNames: Record<keyof Stats, string> = {
  stamina: "体力",
  trust: "信頼",
  focus: "集中力",
  fire: "炎上",
  backlog: "残タスク",
};

const statOrder: Array<keyof Stats> = ["stamina", "trust", "focus", "fire", "backlog"];
const taskGuideTypes: TaskType[] = ["meeting", "slack", "emergency", "document", "break"];

function getPersonName(personId: PersonId, settings: PersonSettings) {
  return settings[personId]?.name.trim() || PERSON_DEFINITIONS[personId].defaultName;
}

function getPersonRole(personId: PersonId, settings: PersonSettings) {
  return settings[personId]?.role.trim() || PERSON_DEFINITIONS[personId].role;
}

function getPersonLabel(personId: PersonId, settings: PersonSettings) {
  const role = getPersonRole(personId, settings);
  const name = getPersonName(personId, settings);
  return personId === "self" ? name : `${role}・${name}`;
}

function resizeImageFile(file: File, maxSize = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("画像ファイルを選んでください。"));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("画像を読み込めませんでした。"));
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) {
          reject(new Error("画像を変換できませんでした。"));
          return;
        }

        canvas.width = width;
        canvas.height = height;
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function App() {
  const [phaseState, setPhaseState] = useState<GamePhase>("ready");
  const [statsState, setStatsState] = useState<Stats>(INITIAL_STATS);
  const [activeTasksState, setActiveTasksState] = useState<ActiveTask[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [handledCountState, setHandledCountState] = useState(0);
  const [missedCountState, setMissedCountState] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [bestRecordState, setBestRecordState] = useState<BestRecord | null>(() => loadBestRecord());
  const [personSettingsState, setPersonSettingsState] = useState<PersonSettings>(() => loadPersonSettings());
  const [mutedState, setMutedState] = useState(false);
  const [guideOpenState, setGuideOpenState] = useState(false);
  const [pausedState, setPausedState] = useState(false);

  const phaseRef = useRef<GamePhase>("ready");
  const statsRef = useRef<Stats>(INITIAL_STATS);
  const activeTasksRef = useRef<ActiveTask[]>([]);
  const handledCountRef = useRef(0);
  const missedCountRef = useRef(0);
  const nextTaskIdRef = useRef(1);
  const nextSpawnAtRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const logIdRef = useRef(1);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mutedRef = useRef(false);
  const fireWarningRef = useRef(false);
  const bestRecordRef = useRef<BestRecord | null>(bestRecordState);
  const personSettingsRef = useRef<PersonSettings>(personSettingsState);
  const guideOpenRef = useRef(false);
  const guideOpenedAtRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const pauseStartedAtRef = useRef<number | null>(null);

  const setPhase = useCallback((phase: GamePhase) => {
    phaseRef.current = phase;
    setPhaseState(phase);
  }, []);

  const updateStats = useCallback((updater: (previous: Stats) => Stats) => {
    const next = updater(statsRef.current);
    statsRef.current = next;
    setStatsState(next);
    return next;
  }, []);

  const updateActiveTasks = useCallback((updater: (previous: ActiveTask[]) => ActiveTask[]) => {
    const next = updater(activeTasksRef.current);
    activeTasksRef.current = next;
    setActiveTasksState(next);
    return next;
  }, []);

  const setBestRecord = useCallback((record: BestRecord | null) => {
    bestRecordRef.current = record;
    setBestRecordState(record);
  }, []);

  const shiftGameClock = useCallback(
    (pauseStartedAt: number, currentTime = performance.now()) => {
      const pauseMs = currentTime - pauseStartedAt;
      const currentStartedAt = startedAtRef.current;

      if (currentStartedAt !== null) {
        const adjustedStartedAt = currentStartedAt + pauseMs;
        startedAtRef.current = adjustedStartedAt;
        setStartedAt(adjustedStartedAt);
      }

      nextSpawnAtRef.current += pauseMs;
      updateActiveTasks((previous) =>
        previous.map((task) => ({
          ...task,
          spawnedAt: task.spawnedAt + pauseMs,
        })),
      );
      setNow(currentTime);
    },
    [updateActiveTasks],
  );

  const updatePersonSetting = useCallback((id: PersonId, patch: Partial<Pick<PersonSetting, "role" | "name" | "avatarId" | "imageSource" | "imageDataUrl">>) => {
    setPersonSettingsState((previous) => {
      const next: PersonSettings = {
        ...previous,
        [id]: {
          ...previous[id],
          ...patch,
          id,
        },
      };

      personSettingsRef.current = next;
      savePersonSettings(next);
      return next;
    });
  }, []);

  const addLog = useCallback((message: string, tone: LogTone = "neutral") => {
    setLogs((previous) => [{ id: logIdRef.current++, message, tone }, ...previous].slice(0, 8));
  }, []);

  const playSound = useCallback((kind: SoundKind) => {
    if (mutedRef.current) {
      return;
    }

    try {
      const AudioCtor = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
      if (!AudioCtor) {
        return;
      }

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtor();
      }

      const context = audioContextRef.current;
      void context.resume();

      const presets: Record<SoundKind, { frequency: number; duration: number; type: OscillatorType; gain: number }> = {
        start: { frequency: 440, duration: 0.08, type: "triangle", gain: 0.05 },
        normal: { frequency: 620, duration: 0.08, type: "square", gain: 0.035 },
        break: { frequency: 330, duration: 0.12, type: "sine", gain: 0.05 },
        miss: { frequency: 150, duration: 0.16, type: "sawtooth", gain: 0.045 },
        warning: { frequency: 880, duration: 0.18, type: "square", gain: 0.04 },
        end: { frequency: 92, duration: 0.55, type: "sawtooth", gain: 0.09 },
      };

      const preset = presets[kind];
      const start = context.currentTime;

      if (kind === "end") {
        const output = context.createDynamicsCompressor();
        output.threshold.setValueAtTime(-18, start);
        output.knee.setValueAtTime(18, start);
        output.ratio.setValueAtTime(5, start);
        output.attack.setValueAtTime(0.003, start);
        output.release.setValueAtTime(0.28, start);
        output.connect(context.destination);

        const createNoiseBuffer = (duration: number) => {
          const sampleCount = Math.floor(context.sampleRate * duration);
          const noiseBuffer = context.createBuffer(1, sampleCount, context.sampleRate);
          const samples = noiseBuffer.getChannelData(0);

          for (let index = 0; index < sampleCount; index += 1) {
            const decay = 1 - index / sampleCount;
            samples[index] = (Math.random() * 2 - 1) * decay * decay;
          }

          return noiseBuffer;
        };

        const boom = context.createOscillator();
        const boomGain = context.createGain();
        boom.type = "sine";
        boom.frequency.setValueAtTime(86, start);
        boom.frequency.exponentialRampToValueAtTime(24, start + 0.72);
        boomGain.gain.setValueAtTime(0.001, start);
        boomGain.gain.exponentialRampToValueAtTime(0.19, start + 0.025);
        boomGain.gain.exponentialRampToValueAtTime(0.001, start + 0.72);
        boom.connect(boomGain);
        boomGain.connect(output);
        boom.start(start);
        boom.stop(start + 0.74);

        const thump = context.createOscillator();
        const thumpGain = context.createGain();
        thump.type = "triangle";
        thump.frequency.setValueAtTime(152, start);
        thump.frequency.exponentialRampToValueAtTime(42, start + 0.22);
        thumpGain.gain.setValueAtTime(0.13, start);
        thumpGain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
        thump.connect(thumpGain);
        thumpGain.connect(output);
        thump.start(start);
        thump.stop(start + 0.26);

        const blast = context.createBufferSource();
        const blastFilter = context.createBiquadFilter();
        const blastGain = context.createGain();
        blast.buffer = createNoiseBuffer(0.44);
        blastFilter.type = "bandpass";
        blastFilter.frequency.setValueAtTime(360, start);
        blastFilter.Q.setValueAtTime(0.9, start);
        blastGain.gain.setValueAtTime(0.26, start);
        blastGain.gain.exponentialRampToValueAtTime(0.001, start + 0.44);
        blast.connect(blastFilter);
        blastFilter.connect(blastGain);
        blastGain.connect(output);
        blast.start(start);
        blast.stop(start + 0.46);

        const crack = context.createBufferSource();
        const crackFilter = context.createBiquadFilter();
        const crackGain = context.createGain();
        crack.buffer = createNoiseBuffer(0.11);
        crackFilter.type = "highpass";
        crackFilter.frequency.setValueAtTime(1200, start);
        crackGain.gain.setValueAtTime(0.18, start);
        crackGain.gain.exponentialRampToValueAtTime(0.001, start + 0.11);
        crack.connect(crackFilter);
        crackFilter.connect(crackGain);
        crackGain.connect(output);
        crack.start(start);
        crack.stop(start + 0.12);

        const rumble = context.createBufferSource();
        const rumbleFilter = context.createBiquadFilter();
        const rumbleGain = context.createGain();
        const rumbleStart = start + 0.09;
        rumble.buffer = createNoiseBuffer(0.82);
        rumbleFilter.type = "lowpass";
        rumbleFilter.frequency.setValueAtTime(180, rumbleStart);
        rumbleFilter.frequency.exponentialRampToValueAtTime(48, rumbleStart + 0.7);
        rumbleGain.gain.setValueAtTime(0.075, rumbleStart);
        rumbleGain.gain.exponentialRampToValueAtTime(0.001, rumbleStart + 0.8);
        rumble.connect(rumbleFilter);
        rumbleFilter.connect(rumbleGain);
        rumbleGain.connect(output);
        rumble.start(rumbleStart);
        rumble.stop(rumbleStart + 0.84);

        return;
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.frequency.setValueAtTime(preset.frequency, start);
      oscillator.type = preset.type;
      gain.gain.setValueAtTime(preset.gain, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + preset.duration);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + preset.duration);
    } catch {
      // Audio is a nice-to-have for the demo. Ignore browser autoplay/device failures.
    }
  }, []);

  const finalizeGame = useCallback(
    (reason: EndReason) => {
      if (phaseRef.current !== "playing") {
        return;
      }

      const finalStats = statsRef.current;
      const finalResult = createResult(reason, finalStats, handledCountRef.current, missedCountRef.current);
      const currentBest = bestRecordRef.current;

      if (!currentBest || finalResult.score > currentBest.score) {
        const nextBest: BestRecord = {
          title: finalResult.title,
          score: finalResult.score,
          trust: finalStats.trust,
          handledCount: finalResult.handledCount,
          createdAt: new Date().toISOString(),
        };
        saveBestRecord(nextBest);
        setBestRecord(nextBest);
      }

      setResult(finalResult);
      updateActiveTasks(() => []);
      guideOpenRef.current = false;
      guideOpenedAtRef.current = null;
      pausedRef.current = false;
      pauseStartedAtRef.current = null;
      setGuideOpenState(false);
      setPausedState(false);
      setPhase("ended");
      addLog(`${finalResult.title} / スコア ${finalResult.score}`, reason === "survived" ? "good" : "bad");
      playSound("end");
    },
    [addLog, playSound, setBestRecord, setPhase, updateActiveTasks],
  );

  const resetGameState = useCallback(() => {
    statsRef.current = INITIAL_STATS;
    activeTasksRef.current = [];
    handledCountRef.current = 0;
    missedCountRef.current = 0;
    nextTaskIdRef.current = 1;
    nextSpawnAtRef.current = 0;
    startedAtRef.current = null;
    fireWarningRef.current = false;
    guideOpenRef.current = false;
    guideOpenedAtRef.current = null;
    pausedRef.current = false;
    pauseStartedAtRef.current = null;
    setStatsState(INITIAL_STATS);
    setActiveTasksState([]);
    setHandledCountState(0);
    setMissedCountState(0);
    setGuideOpenState(false);
    setPausedState(false);
    setStartedAt(null);
    setNow(0);
    setLogs([]);
    setResult(null);
  }, []);

  const startGame = useCallback(() => {
    resetGameState();
    const start = performance.now();
    startedAtRef.current = start;
    nextSpawnAtRef.current = start + 650;
    setStartedAt(start);
    setNow(start);
    setPhase("playing");
    addLog("出社。60秒だけ耐える。", "neutral");
    playSound("start");
  }, [addLog, playSound, resetGameState, setPhase]);

  const returnHome = useCallback(() => {
    resetGameState();
    setPhase("ready");
  }, [resetGameState, setPhase]);

  const processMiss = useCallback(
    (task: ActiveTask) => {
      const definition = TASK_DEFINITIONS[task.type];
      const effect = getResolvedEffect(task.type, task.personId, "miss");
      const hasPenalty = Object.keys(effect).length > 0;

      if (hasPenalty) {
        updateStats((previous) => applyEffect(previous, effect));
        missedCountRef.current += 1;
        setMissedCountState(missedCountRef.current);
        addLog(`${getPersonLabel(task.personId, personSettingsRef.current)}からの${definition.label}を見逃した。火種が増えた。`, "bad");
        playSound("miss");
        return;
      }

      addLog("休憩チャンスを見送った。", "neutral");
    },
    [addLog, playSound, updateStats],
  );

  const handleTaskClick = useCallback(
    (task: ActiveTask) => {
      if (phaseRef.current !== "playing") {
        return;
      }

      if (guideOpenRef.current) {
        return;
      }

      if (pausedRef.current) {
        return;
      }

      const exists = activeTasksRef.current.some((activeTask) => activeTask.id === task.id);
      if (!exists) {
        return;
      }

      const definition = TASK_DEFINITIONS[task.type];
      const effect = getResolvedEffect(task.type, task.personId, "click");
      let focusPenalty = false;

      updateActiveTasks((previous) => previous.filter((activeTask) => activeTask.id !== task.id));
      updateStats((previous) => {
        let next = applyEffect(previous, effect);
        if (definition.work && previous.focus < 15) {
          focusPenalty = true;
          next = applyEffect(next, { trust: -3, fire: 5 });
        }
        return next;
      });

      handledCountRef.current += 1;
      setHandledCountState(handledCountRef.current);

      if (definition.work) {
        addLog(
          `${getPersonLabel(task.personId, personSettingsRef.current)}からの${definition.label}を処理${
            focusPenalty ? "。集中切れで雑になった。" : "。"
          }`,
          focusPenalty ? "warn" : "good",
        );
        playSound("normal");
      } else {
        addLog(`${getPersonLabel(task.personId, personSettingsRef.current)}からの休憩で少しだけ人間に戻った。`, "rest");
        playSound("break");
      }
    },
    [addLog, playSound, updateActiveTasks, updateStats],
  );

  const pauseGame = useCallback(() => {
    if (phaseRef.current !== "playing" || pausedRef.current || guideOpenRef.current) {
      return;
    }

    const currentTime = performance.now();
    pausedRef.current = true;
    pauseStartedAtRef.current = currentTime;
    setPausedState(true);
    setNow(currentTime);
    addLog("一時停止中。", "neutral");
  }, [addLog]);

  const resumeGame = useCallback(() => {
    if (!pausedRef.current) {
      return;
    }

    const pauseStartedAt = pauseStartedAtRef.current;

    if (phaseRef.current === "playing" && pauseStartedAt !== null) {
      shiftGameClock(pauseStartedAt);
    }

    pausedRef.current = false;
    pauseStartedAtRef.current = null;
    setPausedState(false);
    addLog("勤務再開。", "neutral");
  }, [addLog, shiftGameClock]);

  const togglePause = useCallback(() => {
    if (pausedRef.current) {
      resumeGame();
      return;
    }

    pauseGame();
  }, [pauseGame, resumeGame]);

  const openGuide = useCallback(() => {
    if (phaseRef.current !== "playing" || guideOpenRef.current) {
      return;
    }

    guideOpenRef.current = true;
    guideOpenedAtRef.current = performance.now();
    setGuideOpenState(true);
    addLog("効果一覧を確認中。時間は止まっている。", "neutral");
  }, [addLog]);

  const closeGuide = useCallback(() => {
    if (!guideOpenRef.current) {
      return;
    }

    const pauseStartedAt = guideOpenedAtRef.current;
    const currentTime = performance.now();

    if (phaseRef.current === "playing" && pauseStartedAt !== null) {
      const pauseMs = currentTime - pauseStartedAt;
      if (pauseMs > 0) {
        shiftGameClock(pauseStartedAt, currentTime);
      }
    }

    guideOpenRef.current = false;
    guideOpenedAtRef.current = null;
    setGuideOpenState(false);
  }, [shiftGameClock]);

  useEffect(() => {
    mutedRef.current = mutedState;
  }, [mutedState]);

  useEffect(() => {
    if (!guideOpenState) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeGuide();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeGuide, guideOpenState]);

  useEffect(() => {
    if (phaseState !== "playing") {
      return;
    }

    if (statsState.fire >= 75 && !fireWarningRef.current) {
      fireWarningRef.current = true;
      addLog("炎上度が危険水域。", "warn");
      playSound("warning");
    }

    if (statsState.fire < 60) {
      fireWarningRef.current = false;
    }
  }, [addLog, phaseState, playSound, statsState.fire]);

  useEffect(() => {
    if (phaseState !== "playing") {
      return undefined;
    }

    const tick = () => {
      const currentTime = performance.now();
      const gameStartedAt = startedAtRef.current;

      if (gameStartedAt === null) {
        return;
      }

      if (guideOpenRef.current || pausedRef.current) {
        return;
      }

      setNow(currentTime);

      const elapsedMs = currentTime - gameStartedAt;
      const currentStats = statsRef.current;

      if (currentStats.stamina <= 0) {
        finalizeGame("stamina");
        return;
      }

      if (currentStats.fire >= 100) {
        finalizeGame("fire");
        return;
      }

      if (elapsedMs >= GAME_DURATION_MS) {
        finalizeGame("survived");
        return;
      }

      const expiredTasks = activeTasksRef.current.filter((task) => currentTime - task.spawnedAt >= task.durationMs);
      if (expiredTasks.length > 0) {
        const expiredIds = new Set(expiredTasks.map((task) => task.id));
        updateActiveTasks((previous) => previous.filter((task) => !expiredIds.has(task.id)));
        expiredTasks.forEach(processMiss);

        if (statsRef.current.fire >= 100) {
          finalizeGame("fire");
          return;
        }
      }

      if (currentTime >= nextSpawnAtRef.current) {
        const additions: ActiveTask[] = [];
        let nextSpawnAt = nextSpawnAtRef.current;
        let guard = 0;

        while (currentTime >= nextSpawnAt && guard < 2) {
          const type = pickTaskType();
          additions.push({
            id: nextTaskIdRef.current++,
            type,
            personId: pickPersonForTask(type),
            lane: Math.floor(Math.random() * LANE_COUNT),
            spawnedAt: currentTime,
            durationMs: TASK_DEFINITIONS[type].durationMs,
          });
          nextSpawnAt += getSpawnInterval(elapsedMs) + Math.round(Math.random() * 300 - 120);
          guard += 1;
        }

        nextSpawnAtRef.current = nextSpawnAt;

        if (additions.length > 0) {
          updateActiveTasks((previous) => [...previous, ...additions].slice(-16));
        }
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 80);
    return () => window.clearInterval(intervalId);
  }, [finalizeGame, phaseState, processMiss, updateActiveTasks]);

  const elapsedMs = phaseState === "playing" && startedAt !== null ? Math.min(GAME_DURATION_MS, now - startedAt) : 0;
  const remainingSeconds = Math.max(0, Math.ceil((GAME_DURATION_MS - elapsedMs) / 1000));
  const progressPercent = Math.min(100, (elapsedMs / GAME_DURATION_MS) * 100);
  const fireIntensity = statsState.fire / 100;
  const fireClass = [
    statsState.fire >= 50 ? "fire-mid" : "",
    statsState.fire >= 75 ? "fire-high" : "",
    statsState.fire >= 90 ? "fire-critical" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const bestLabel = bestRecordState ? `${bestRecordState.title} / ${bestRecordState.score}点` : "記録なし";

  const appStyle = {
    "--fire": fireIntensity,
  } as CSSProperties;

  return (
    <main className={`app-shell ${fireClass}`} style={appStyle}>
      {phaseState === "ready" && (
        <StartScreen
          bestLabel={bestLabel}
          personSettings={personSettingsState}
          muted={mutedState}
          onAvatarChange={(id, avatarId) => updatePersonSetting(id, { avatarId })}
          onImageChange={(id, imageDataUrl, imageSource) => updatePersonSetting(id, { imageDataUrl, imageSource })}
          onMute={() => setMutedState((value) => !value)}
          onNameChange={(id, name) => updatePersonSetting(id, { name })}
          onRoleChange={(id, role) => updatePersonSetting(id, { role })}
          onStart={startGame}
        />
      )}

      {phaseState === "playing" && (
        <section className="game-screen" aria-label="社畜サバイバル プレイ画面">
          <header className="top-bar">
            <div>
              <p className="eyebrow">Shachiku Survival</p>
              <h1>社畜サバイバル</h1>
            </div>
            <div className="timer-box" aria-label={`残り${remainingSeconds}秒`}>
              <span>{remainingSeconds}</span>
              <small>秒</small>
            </div>
            <button className="menu-button" type="button" onClick={openGuide}>
              効果一覧
            </button>
            <button className={`menu-button pause-button ${pausedState ? "active" : ""}`} type="button" onClick={togglePause}>
              {pausedState ? "再開" : "一時停止"}
            </button>
            <button className="menu-button home-button" type="button" onClick={returnHome}>
              ホーム
            </button>
            <button className="icon-button" type="button" onClick={() => setMutedState((value) => !value)} aria-label="ミュート切替">
              {mutedState ? "音OFF" : "音ON"}
            </button>
          </header>

          <div className="time-track" aria-hidden="true">
            <div className="time-fill" style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="game-layout">
            <StatusPanel stats={statsState} />
            <PlayField activeTasks={activeTasksState} now={now} personSettings={personSettingsState} onTaskClick={handleTaskClick} />
            <SidePanel
              logs={logs}
              handledCount={handledCountState}
              missedCount={missedCountState}
              bestLabel={bestLabel}
              spawnInterval={getSpawnInterval(elapsedMs)}
            />
          </div>

          {pausedState && !guideOpenState && <PauseOverlay onHome={returnHome} onResume={resumeGame} />}
          {guideOpenState && <GuideOverlay personSettings={personSettingsState} onClose={closeGuide} onHome={returnHome} />}
        </section>
      )}

      {phaseState === "ended" && result && (
        <ResultScreen
          result={result}
          bestLabel={bestLabel}
          muted={mutedState}
          onMute={() => setMutedState((value) => !value)}
          onHome={returnHome}
          onRetry={startGame}
        />
      )}
    </main>
  );
}

function StartScreen({
  bestLabel,
  personSettings,
  muted,
  onAvatarChange,
  onImageChange,
  onMute,
  onNameChange,
  onRoleChange,
  onStart,
}: {
  bestLabel: string;
  personSettings: PersonSettings;
  muted: boolean;
  onAvatarChange: (id: PersonId, avatarId: AvatarId) => void;
  onImageChange: (id: PersonId, imageDataUrl: string | undefined, imageSource: PersonImageSource) => void;
  onMute: () => void;
  onNameChange: (id: PersonId, name: string) => void;
  onRoleChange: (id: PersonId, role: string) => void;
  onStart: () => void;
}) {
  return (
    <section className="start-screen">
      <div className="hero-copy">
        <p className="eyebrow">60 seconds office survival</p>
        <h1>社畜サバイバル</h1>
        <p className="lead">60秒、生き残れ。仕事を捌け。ただし休まないと燃え尽きる。</p>
        <div className="start-actions">
          <button className="primary-button" type="button" onClick={onStart}>
            出社する
          </button>
          <button className="secondary-button" type="button" onClick={onMute}>
            {muted ? "音を戻す" : "音を切る"}
          </button>
        </div>
      </div>

      <aside className="briefing-panel" aria-label="遊び方">
        <div className="briefing-row">
          <span>目的</span>
          <strong>体力と評価を残して60秒耐える</strong>
        </div>
        <div className="briefing-row">
          <span>操作</span>
          <strong>降ってくる予定をクリックして処理</strong>
        </div>
        <div className="briefing-row">
          <span>罠</span>
          <strong>休まないと集中力が落ち、処理が雑になる</strong>
        </div>
        <div className="briefing-row best">
          <span>最高記録</span>
          <strong>{bestLabel}</strong>
        </div>
        <PeopleSettingsPanel
          personSettings={personSettings}
          onAvatarChange={onAvatarChange}
          onImageChange={onImageChange}
          onNameChange={onNameChange}
          onRoleChange={onRoleChange}
        />
        <TaskGuide compact personSettings={personSettings} />
      </aside>
    </section>
  );
}

function PeopleSettingsPanel({
  personSettings,
  onAvatarChange,
  onImageChange,
  onNameChange,
  onRoleChange,
}: {
  personSettings: PersonSettings;
  onAvatarChange: (id: PersonId, avatarId: AvatarId) => void;
  onImageChange: (id: PersonId, imageDataUrl: string | undefined, imageSource: PersonImageSource) => void;
  onNameChange: (id: PersonId, name: string) => void;
  onRoleChange: (id: PersonId, role: string) => void;
}) {
  const handleImageFile = async (personId: PersonId, file: File | undefined) => {
    if (!file) {
      return;
    }

    try {
      const imageDataUrl = await resizeImageFile(file);
      onImageChange(personId, imageDataUrl, "custom");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "画像を読み込めませんでした。");
    }
  };

  return (
    <section className="people-settings" aria-label="登場人物設定">
      <div className="guide-heading">
        <span>登場人物設定</span>
        <strong>役職・名前・画像を差し替える</strong>
      </div>
      <div className="people-list">
        {PERSON_ORDER.map((personId) => {
          const definition = PERSON_DEFINITIONS[personId];
          const setting = personSettings[personId];
          const role = getPersonRole(personId, personSettings);

          return (
            <article
              className={`person-setting-card person-${personId}`}
              key={personId}
              style={{ "--person-color": definition.color } as CSSProperties}
            >
              <PersonAvatar personId={personId} personSettings={personSettings} size="settings" />
              <div className="person-setting-body">
                <div className="person-setting-title">
                  <span>{definition.role}枠</span>
                  <strong>{getPersonName(personId, personSettings)}</strong>
                </div>
                <label>
                  <span>役職</span>
                  <input
                    aria-label={`${definition.role}枠の役職`}
                    maxLength={10}
                    type="text"
                    value={setting.role}
                    onChange={(event) => onRoleChange(personId, event.target.value)}
                  />
                </label>
                <label>
                  <span>名前</span>
                  <input
                    aria-label={`${definition.role}枠の名前`}
                    maxLength={12}
                    type="text"
                    value={setting.name}
                    onChange={(event) => onNameChange(personId, event.target.value)}
                  />
                </label>
                <label>
                  <span>プリセット</span>
                  <select
                    aria-label={`${definition.role}枠のプリセット`}
                    value={setting.avatarId}
                    onChange={(event) => onAvatarChange(personId, event.target.value as AvatarId)}
                  >
                    {AVATAR_ORDER.map((avatarId) => (
                      <option key={avatarId} value={avatarId}>
                        {AVATAR_PRESETS[avatarId].label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="image-setting-row">
                  <label className="image-upload-label">
                    <span>画像</span>
                    <input
                      aria-label={`${definition.role}枠の画像`}
                      accept="image/*"
                      type="file"
                      onChange={(event) => {
                        void handleImageFile(personId, event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  {setting.imageDataUrl && (
                    <button className="tiny-button" type="button" onClick={() => onImageChange(personId, undefined, "none")}>
                      画像を外す
                    </button>
                  )}
                </div>
                <small className="person-effect-note">{role}枠の効果バランスを使います</small>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StatusPanel({ stats }: { stats: Stats }) {
  return (
    <aside className="status-panel" aria-label="ステータス">
      <div className="panel-heading">
        <span>STATUS</span>
        <strong>勤務状態</strong>
      </div>
      <div className="stat-list">
        {statusLabels.map((status) => (
          <StatBar
            key={status.key}
            label={status.label}
            value={stats[status.key]}
            max={status.max}
            tone={status.key === "fire" && stats.fire >= 75 ? "critical" : status.tone}
          />
        ))}
      </div>
      <div className="danger-note">体力0または炎上100で即終了</div>
    </aside>
  );
}

function StatBar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "good" | "warning" | "danger" | "neutral" | "critical";
}) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={`stat-bar ${tone}`}>
      <div className="stat-meta">
        <span>{label}</span>
        <strong>
          {Math.round(value)}
          {max !== 100 ? `/${max}` : ""}
        </strong>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function PlayField({
  activeTasks,
  now,
  personSettings,
  onTaskClick,
}: {
  activeTasks: ActiveTask[];
  now: number;
  personSettings: PersonSettings;
  onTaskClick: (task: ActiveTask) => void;
}) {
  return (
    <section className="play-field" aria-label="降ってくる予定">
      <div className="lane-grid" aria-hidden="true">
        {Array.from({ length: LANE_COUNT }).map((_, index) => (
          <span key={index} />
        ))}
      </div>

      <div className="office-backdrop" aria-hidden="true">
        <div className="desk-row" />
        <div className="monitor-row" />
        <div className="warning-stripe" />
      </div>

      {activeTasks.map((task) => {
        const definition = TASK_DEFINITIONS[task.type];
        const personDefinition = PERSON_DEFINITIONS[task.personId];
        const personName = getPersonName(task.personId, personSettings);
        const personRole = getPersonRole(task.personId, personSettings);
        const progress = Math.min(1, Math.max(0, (now - task.spawnedAt) / task.durationMs));
        const style = {
          left: `${task.lane * 20 + 1.2}%`,
          top: `${progress * 82 + 4}%`,
          borderColor: definition.color,
          "--task-color": definition.color,
          "--task-accent": definition.accent,
          "--person-color": personDefinition.color,
        } as CSSProperties;

        return (
          <button
            className={`task-card ${task.type} person-${task.personId}`}
            key={task.id}
            type="button"
            style={style}
            onClick={() => onTaskClick(task)}
            aria-label={`${personRole}・${personName}からの${definition.label}を処理`}
          >
            <div className="task-person-row">
              <PersonAvatar personId={task.personId} personSettings={personSettings} size="task" />
              <div className="task-person-copy">
                <span>{personRole}</span>
                <strong>{personName}</strong>
              </div>
            </div>
            <div className="task-kind-row">
              <span className="task-icon" aria-hidden="true">
                {definition.icon}
              </span>
              <span className="task-label">{definition.label}</span>
            </div>
            <strong className="task-title">{definition.text}</strong>
          </button>
        );
      })}
    </section>
  );
}

function PersonAvatar({
  personId,
  personSettings,
  size = "task",
}: {
  personId: PersonId;
  personSettings: PersonSettings;
  size?: "task" | "settings" | "guide";
}) {
  const person = PERSON_DEFINITIONS[personId];
  const setting = personSettings[personId];
  const avatar = AVATAR_PRESETS[setting.avatarId];

  return (
    <span
      className={`person-avatar ${avatar.tone} ${size}`}
      style={{ "--person-color": person.color } as CSSProperties}
      title={`${avatar.label}イラスト`}
      aria-hidden="true"
    >
      {setting.imageDataUrl ? <img src={setting.imageDataUrl} alt="" /> : <span>{avatar.glyph}</span>}
    </span>
  );
}

function SidePanel({
  logs,
  handledCount,
  missedCount,
  bestLabel,
  spawnInterval,
}: {
  logs: LogEntry[];
  handledCount: number;
  missedCount: number;
  bestLabel: string;
  spawnInterval: number;
}) {
  return (
    <aside className="side-panel" aria-label="勤務ログ">
      <div className="panel-heading">
        <span>LOG</span>
        <strong>勤務ログ</strong>
      </div>
      <div className="metrics-grid">
        <Metric label="処理" value={`${handledCount}`} />
        <Metric label="ミス" value={`${missedCount}`} />
        <Metric label="出現" value={`${spawnInterval}ms`} />
      </div>
      <div className="best-record">
        <span>最高記録</span>
        <strong>{bestLabel}</strong>
      </div>
      <ul className="log-list">
        {logs.length === 0 && <li className="empty-log">まだ平穏。</li>}
        {logs.map((log) => (
          <li className={log.tone} key={log.id}>
            {log.message}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TaskGuide({ compact = false, personSettings }: { compact?: boolean; personSettings: PersonSettings }) {
  return (
    <section className={compact ? "task-guide compact" : "task-guide"} aria-label="予定の効果一覧">
      <div className="guide-heading">
        <span>効果一覧</span>
        <strong>何を叩くと何が増減するか</strong>
      </div>
      <p className="score-note">最終スコアは、信頼・体力・集中力・処理数が高いほど有利。炎上度・残タスクが高いほど不利。</p>
      <div className="effect-table">
        {taskGuideTypes.map((type) => {
          const definition = TASK_DEFINITIONS[type];

          return (
            <article className="effect-row" key={type} style={{ "--task-color": definition.color } as CSSProperties}>
              <div className="effect-task">
                <span>
                  <span className="effect-task-icon" aria-hidden="true">
                    {definition.icon}
                  </span>
                  {definition.label}
                </span>
                <strong>{definition.text}</strong>
              </div>
              <div className="effect-cell">
                <span>クリック</span>
                <EffectPills effect={definition.clickEffect} />
              </div>
              <div className="effect-cell">
                <span>見逃し</span>
                <EffectPills effect={definition.missEffect} noneLabel="なし" />
              </div>
            </article>
          );
        })}
      </div>
      <p className="focus-note">集中力が15未満で仕事を処理すると、追加で信頼 -3 / 炎上 +5。</p>
      <PersonModifierGuide compact={compact} personSettings={personSettings} />
    </section>
  );
}

function PersonModifierGuide({ compact = false, personSettings }: { compact?: boolean; personSettings: PersonSettings }) {
  return (
    <section className={compact ? "person-modifier-guide compact" : "person-modifier-guide"} aria-label="人物補正一覧">
      <div className="guide-heading">
        <span>人物補正</span>
        <strong>誰から来たかで追加効果が乗る</strong>
      </div>
      <div className="effect-table person-effect-table">
        {PERSON_ORDER.map((personId) => {
          const definition = PERSON_DEFINITIONS[personId];
          const taskLabels = definition.allowedTaskTypes.map((type) => TASK_DEFINITIONS[type].label).join(" / ");
          const role = getPersonRole(personId, personSettings);

          return (
            <article className="effect-row person-effect-row" key={personId} style={{ "--task-color": definition.color } as CSSProperties}>
              <div className="effect-task person-effect-task">
                <PersonAvatar personId={personId} personSettings={personSettings} size="guide" />
                <div>
                  <span>
                    {role}
                    <small className="slot-label">/{definition.role}枠</small>
                  </span>
                  <strong>{getPersonName(personId, personSettings)}</strong>
                  <small>{taskLabels}</small>
                </div>
              </div>
              <div className="effect-cell">
                <span>クリック補正</span>
                <EffectPills effect={definition.clickModifier} />
              </div>
              <div className="effect-cell">
                <span>見逃し補正</span>
                <EffectPills effect={definition.missModifier} noneLabel="なし" />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EffectPills({ effect, noneLabel = "変化なし" }: { effect: StatDelta; noneLabel?: string }) {
  const entries = statOrder
    .map((key) => [key, effect[key]] as const)
    .filter((entry): entry is readonly [keyof Stats, number] => typeof entry[1] === "number" && entry[1] !== 0);

  if (entries.length === 0) {
    return <span className="effect-none">{noneLabel}</span>;
  }

  return (
    <div className="effect-pills">
      {entries.map(([key, value]) => (
        <span className={value > 0 ? "delta-chip positive" : "delta-chip negative"} key={key}>
          {statDisplayNames[key]} {value > 0 ? "+" : ""}
          {value}
        </span>
      ))}
    </div>
  );
}

function PauseOverlay({ onHome, onResume }: { onHome: () => void; onResume: () => void }) {
  return (
    <div className="pause-overlay" role="dialog" aria-modal="true" aria-label="一時停止">
      <div className="pause-modal">
        <p className="eyebrow">Paused</p>
        <strong>一時停止中</strong>
        <div className="pause-actions">
          <button className="primary-button" type="button" onClick={onResume}>
            再開
          </button>
          <button className="secondary-button" type="button" onClick={onHome}>
            ホームへ
          </button>
        </div>
      </div>
    </div>
  );
}

function GuideOverlay({
  personSettings,
  onClose,
  onHome,
}: {
  personSettings: PersonSettings;
  onClose: () => void;
  onHome: () => void;
}) {
  return (
    <div className="guide-overlay" role="dialog" aria-modal="true" aria-label="効果一覧メニュー">
      <div className="guide-modal">
        <div className="guide-modal-header">
          <div>
            <p className="eyebrow">Paused Menu</p>
            <h2>効果一覧</h2>
          </div>
          <div className="guide-modal-actions">
            <button className="secondary-button" type="button" onClick={onHome}>
              ホームへ
            </button>
            <button className="secondary-button" type="button" onClick={onClose}>
              戻る
            </button>
          </div>
        </div>
        <TaskGuide personSettings={personSettings} />
      </div>
    </div>
  );
}

function ResultScreen({
  result,
  bestLabel,
  muted,
  onMute,
  onHome,
  onRetry,
}: {
  result: Result;
  bestLabel: string;
  muted: boolean;
  onMute: () => void;
  onHome: () => void;
  onRetry: () => void;
}) {
  const reasonText = useMemo(() => {
    if (result.reason === "stamina") {
      return "体力が尽きた。";
    }

    if (result.reason === "fire") {
      return "炎上が全社に広がった。";
    }

    return "終業ベルまで耐え切った。";
  }, [result.reason]);

  return (
    <section className="result-screen">
      <ResultStamp result={result} />
      <div className="result-header">
        <p className="eyebrow">Result</p>
        <h1>{result.title}</h1>
        <p>{reasonText}</p>
      </div>

      <div className="result-grid">
        <Metric label="スコア" value={`${result.score}`} />
        <Metric label="処理数" value={`${result.handledCount}`} />
        <Metric label="ミス" value={`${result.missedCount}`} />
        <Metric label="信頼" value={`${result.stats.trust}`} />
        <Metric label="体力" value={`${result.stats.stamina}`} />
        <Metric label="炎上度" value={`${result.stats.fire}`} />
      </div>

      <div className="best-record result-best">
        <span>最高記録</span>
        <strong>{bestLabel}</strong>
      </div>

      <div className="start-actions">
        <button className="primary-button" type="button" onClick={onRetry}>
          再出社する
        </button>
        <button className="secondary-button" type="button" onClick={onHome}>
          ホームへ
        </button>
        <button className="secondary-button" type="button" onClick={onMute}>
          {muted ? "音を戻す" : "音を切る"}
        </button>
      </div>
    </section>
  );
}

function ResultStamp({ result }: { result: Result }) {
  const stamp = getResultStamp(result);

  return (
    <div className={`result-stamp ${stamp.tone}`} aria-label={stamp.label}>
      <div className="stamp-scene">
        <span className="stamp-prop">{stamp.prop}</span>
        <span className="stamp-person">{stamp.glyph}</span>
      </div>
      <strong>{stamp.label}</strong>
    </div>
  );
}

function getResultStamp(result: Result) {
  if (result.reason === "fire") {
    return { tone: "fire", label: "全社障害級の大炎上", glyph: "炎", prop: "警" };
  }

  if (result.reason === "stamina") {
    return { tone: "burnout", label: "机に突っ伏す社員", glyph: "疲", prop: "机" };
  }

  if (result.title.includes("炎上処理班")) {
    return { tone: "rescue", label: "消火器を持つ社員", glyph: "消", prop: "火" };
  }

  if (result.title.includes("昇進候補")) {
    return { tone: "ace", label: "光る限界エース", glyph: "光", prop: "拍" };
  }

  if (result.title.includes("会議")) {
    return { tone: "meeting", label: "資料山に埋もれる社員", glyph: "埋", prop: "紙" };
  }

  return { tone: "survive", label: "なんとか生存", glyph: "生", prop: "済" };
}

export default App;
