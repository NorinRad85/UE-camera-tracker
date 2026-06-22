import { useState, useEffect, useRef } from 'react';
import { 
  Play, Pause, RotateCcw, Sliders, Cpu, Layers, Download, 
  Terminal, Settings, ChevronRight, CheckCircle2, AlertTriangle, 
  HelpCircle, Code2, Video, PackageCheck, Eye, EyeOff, Radio,
  Folder, FolderOpen, Search, X, ChevronLeft, HardDrive, Monitor,
  FileVideo, FileSpreadsheet
} from 'lucide-react';
import VideoCanvas from './components/VideoCanvas';
import ThreeDViewport from './components/ThreeDViewport';
import { Tracker, SensorPreset, LensDistortion, CameraSolveData } from './types';
import { generateSimulationDataset, solveCamera } from './utils/motionSimulation';
import { generateUnrealPythonScript, generateInstallerGuide } from './utils/unrealExport';

const SENSOR_PRESETS: SensorPreset[] = [
  { name: 'Full Frame (35mm)', width: 36.0, height: 24.0, cropFactor: 1.0 },
  { name: 'Super 35mm (Default)', width: 24.89, height: 18.66, cropFactor: 1.45 },
  { name: 'APS-C (Cinema)', width: 22.2, height: 14.8, cropFactor: 1.62 },
  { name: 'Four Thirds', width: 17.3, height: 13.0, cropFactor: 2.0 },
  { name: 'iPhone 1/1.9" Sensor', width: 7.18, height: 5.32, cropFactor: 5.0 },
  { name: 'Custom Filmback...', width: 20.0, height: 15.0, cropFactor: 1.8 }
];

interface SimulatedFile {
  name: string;
  type: 'folder' | 'file';
  extension?: string;
  size?: string;
}

const SIMULATED_FS: Record<string, SimulatedFile[]> = {
  'D:': [
    { name: 'unreal_project', type: 'folder' },
    { name: 'System Volume Information', type: 'folder' },
    { name: 'Render_Outputs', type: 'folder' }
  ],
  'D:/unreal_project': [
    { name: 'Config', type: 'folder' },
    { name: 'Content', type: 'folder' },
    { name: 'Source', type: 'folder' },
    { name: 'unreal_project.uproject', type: 'file', extension: 'uproject' }
  ],
  'D:/unreal_project/Content': [
    { name: 'Cinematics', type: 'folder' },
    { name: 'Developers', type: 'folder' },
    { name: 'StarterContent', type: 'folder' }
  ],
  'D:/unreal_project/Content/Cinematics': [
    { name: 'Shot_01_SolverSequence', type: 'folder' },
    { name: 'Shot_02_DesertPan', type: 'folder' },
    { name: 'Shot_03_TrackingGrid', type: 'folder' },
    { name: 'shot_01_h264.mov', type: 'file', extension: 'mov', size: '142 MB' },
    { name: 'shot_02_tracker.mov', type: 'file', extension: 'mov', size: '286 MB' },
    { name: 'shot_03_original.mov', type: 'file', extension: 'mov', size: '190 MB' },
    { name: 'shot_04_plate_v03.mov', type: 'file', extension: 'mov', size: '412 MB' }
  ],
  'D:/unreal_project/Content/Cinematics/Shot_01_SolverSequence': [
    { name: 'shot_01_h264.mov', type: 'file', extension: 'mov', size: '142 MB' },
    { name: 'Shot_01_SolverSequence.uasset', type: 'file', extension: 'uasset', size: '4 MB' }
  ],
  'D:/unreal_project/Content/Cinematics/Shot_02_DesertPan': [
    { name: 'shot_02_tracker.mov', type: 'file', extension: 'mov', size: '286 MB' },
    { name: 'Shot_02_DesertSequence.uasset', type: 'file', extension: 'uasset', size: '3.6 MB' }
  ],
  'D:/unreal_project/Content/Cinematics/Shot_03_TrackingGrid': [
    { name: 'shot_03_original.mov', type: 'file', extension: 'mov', size: '190 MB' },
    { name: 'Shot_03_GridSequence.uasset', type: 'file', extension: 'uasset', size: '5.1 MB' }
  ]
};

export default function App() {
  const [activeStep, setActiveStep] = useState<number>(1);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Footage & Camera state
  const [sensorPreset, setSensorPreset] = useState<SensorPreset>(SENSOR_PRESETS[1]); // Super35
  const [customWidth, setCustomWidth] = useState<number>(25.0);
  const [customHeight, setCustomHeight] = useState<number>(18.7);
  const [selectedFocal, setSelectedFocal] = useState<number>(24.0); // 24mm default

  // True physical camera parameters (What's shot on footage: Super35 lens at 24mm with -0.15 radial distortion)
  const actualSensor = SENSOR_PRESETS[1]; 
  const actualFocal = 24.0;
  const actualLensDistortion: LensDistortion = {
    k1: -0.16, // barrel distortion
    k2: 0.05,
    p1: 0,
    p2: 0,
    scale: 1.05
  };

  // User calibrated lens distortion slider coefficients
  const [lensDistortion, setLensDistortion] = useState<LensDistortion>({
    k1: 0.0,
    k2: 0.0,
    p1: 0.0,
    p2: 0.0,
    scale: 1.0
  });

  const [showGridCalib, setShowGridCalib] = useState<boolean>(false);
  const [compareOriginal, setCompareOriginal] = useState<boolean>(true);

  // Log events simulation lines
  const [logs, setLogs] = useState<string[]>([
    '[INIT] Unreal motion tracker system loaded.',
    '[INFO] Cinematic plate (shot_01_h264.mov) linked. Standing by.'
  ]);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 30)]);
  };

  // Trackers collection initialized with some raw projected tracker marker points
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [selectedTrackerId, setSelectedTrackerId] = useState<string | null>(null);
  const [autoTrackingProgress, setAutoTrackingProgress] = useState<number | null>(null);
  const [manualAddedCount, setManualAddedCount] = useState<number>(0);

  // Solved camera path output storage state
  const [solveData, setSolveData] = useState<CameraSolveData>({
    frames: {},
    rmsError: 1.62, // starts with a high uncalibrated solve estimation error
    solved: false
  });
  const [isSolving, setIsSolving] = useState<boolean>(false);

  // Toggle paths generation whenever focal lens/preset updates
  const handleDatasetReset = () => {
    const dataset = generateSimulationDataset(
      100,
      actualFocal,
      actualSensor.width,
      actualSensor.height,
      actualLensDistortion,
      0.25 // sub-pixel visual noise
    );
    setTrackers(dataset.trackers);
    addLog('[FOOTAGE] Generated tracking targets from video plate successfully.');
  };

  useEffect(() => {
    handleDatasetReset();
  }, []);

  // Frame Timeline intervals handling
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setCurrentFrame((prev) => (prev >= 99 ? 0 : prev + 1));
      }, 55); // 18-20 fps fluid playback
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    }
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying]);

  const triggerAutoTracking = () => {
    setAutoTrackingProgress(0);
    addLog('[TRACKER] Initiated Harris Corner Point extraction sequence...');
    
    let prog = 0;
    const interval = setInterval(() => {
      prog += 10;
      setAutoTrackingProgress(prog);
      if (prog === 40) {
        addLog(`[TRACKER] Locking active pixel templates across 100 frames...`);
      }
      if (prog === 70) {
        addLog(`[TRACKER] Solved 32 high-correlation markers continuously.`);
      }
      if (prog >= 100) {
        clearInterval(interval);
        setAutoTrackingProgress(null);
        addLog('[TRACKER] Auto point track complete. Marker trails built.');
      }
    }, 180);
  };

  const handleCameraSolve = () => {
    setIsSolving(true);
    addLog('[SOLVER] Compiling camera projection matrices...');
    
    setTimeout(() => {
      // Execute simulated mathematical projection solve sequence
      const solved = solveCamera(
        trackers,
        100,
        selectedFocal,
        sensorPreset.name === 'Custom Filmback...' ? customWidth : sensorPreset.width,
        sensorPreset.name === 'Custom Filmback...' ? customHeight : sensorPreset.height,
        lensDistortion, // user's calibrated distortion
        actualLensDistortion, // physical true distortion
        actualFocal,
        actualSensor.width,
        actualSensor.height,
        manualAddedCount
      );

      setSolveData(solved);
      setIsSolving(false);
      addLog(`[SOLVER] 3D Camera Path triangles converged. RMS Error: ${solved.rmsError} px`);
    }, 1200);
  };

  // Check if Lens calibration matches accurately (k1 values must match within range)
  const isLensMatched = Math.abs(lensDistortion.k1 - actualLensDistortion.k1) < 0.035;

  // Render file downloader scripts
  const downloadPythonScript = () => {
    const script = generateUnrealPythonScript(
      solveData,
      trackers,
      sensorPreset,
      lensDistortion,
      24,
      100
    );
    const blob = new Blob([script], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'import_camera_tracking_ue5.py';
    link.click();
    addLog('[EXPORTS] Downloaded Unreal Engine Python import script.');
  };

  const downloadTrackingJSON = () => {
    const data = {
      footage: 'shot_01_h264.mov',
      sensor: sensorPreset,
      focal_length: selectedFocal,
      lens_distortion: lensDistortion,
      solves: solveData,
      trackers: trackers.map(t => ({ name: t.name, color: t.color, solved3D: t.solved3D, error: t.rmsError }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'unreal_camera_solve_data.json';
    link.click();
    addLog('[EXPORTS] Downloaded Raw Camera Solve JSON logs.');
  };

  // Unreal Bridge Widget Simulator state
  const [unrealImportConsole, setUnrealImportConsole] = useState<string[]>([
    'Waiting for connection from Unreal Engine 5.7 motion tracker server...'
  ]);
  const [ueCombinedPath, setUeCombinedPath] = useState<string>('D:/unreal_project/Content/Cinematics/Shot_01_SolverSequence/shot_01_h264.mov');
  const [unrealImporting, setUnrealImporting] = useState<boolean>(false);

  // States for folder picker dialogs
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [pickerType, setPickerType] = useState<'unreal' | 'windows'>('unreal');
  const [pickerCurrentDir, setPickerCurrentDir] = useState<string>('D:/unreal_project/Content/Cinematics');
  const [selectedFileSystemItem, setSelectedFileSystemItem] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState<string>('');

  // Derive sequence and footage name
  const getSequenceName = (pathStr: string) => {
    const cleanPath = pathStr.replace(/\\/g, '/');
    const bits = cleanPath.split('/');
    if (bits.length > 1) {
      const last = bits[bits.length - 1];
      if (last.includes('.')) {
        return bits[bits.length - 2] || 'Shot_01_SolverSequence';
      }
      return last;
    }
    return 'Shot_01_SolverSequence';
  };

  const ueSequenceName = getSequenceName(ueCombinedPath);
  const ueFootagePath = ueCombinedPath;

  // States for dynamic FPS and Clip Range
  const [selectedFps, setSelectedFps] = useState<string>('auto');
  const [selectedClipRange, setSelectedClipRange] = useState<string>('auto');

  // Active level spawning options
  const [spawnCameraInActiveLevel, setSpawnCameraInActiveLevel] = useState<boolean>(true);
  const [spawnBackplateInActiveLevel, setSpawnBackplateInActiveLevel] = useState<boolean>(true);

  // Auto-detect config based on path
  const getAutoDetectedSettings = (pathStr: string) => {
    const filename = pathStr.toLowerCase();
    if (filename.includes('shot_02') || filename.includes('desert')) {
      return { fps: 29.976, range: '0 - 119' };
    } else if (filename.includes('shot_03') || filename.includes('grid')) {
      return { fps: 23.976, range: '0 - 149' };
    } else if (filename.includes('shot_04') || filename.includes('plate')) {
      return { fps: 30, range: '0 - 79' };
    } else {
      // Default (Shot_01 or general fallback)
      return { fps: 24, range: '0 - 99' };
    }
  };

  const autoSettings = getAutoDetectedSettings(ueCombinedPath);
  const detectedFps = autoSettings.fps;
  const detectedClipRange = autoSettings.range;

  const getSelectedRangeInfo = () => {
    const rangeStr = selectedClipRange === 'auto' ? detectedClipRange : {
      'auto': detectedClipRange,
      'custom': '0 - 99',
      'head': '10 - 99',
      'tail': '0 - 89',
      'half': '0 - 49'
    }[selectedClipRange] || '0 - 99';
    
    const parts = rangeStr.split(' - ');
    const start = parseInt(parts[0]) || 0;
    const end = parseInt(parts[1]) || 99;
    const count = (end - start) + 1;
    return { start, end, count, label: rangeStr };
  };

  const rangeInfo = getSelectedRangeInfo();
  const activeFps = selectedFps === 'auto' ? detectedFps : parseFloat(selectedFps);

  const testUnrealBridgeImport = () => {
    setUnrealImporting(true);
    setUnrealImportConsole(prev => [
      `[UE 5.7 BRIDGE] Connecting to pipeline server...`,
      ...prev
    ]);

    setTimeout(() => {
      setUnrealImportConsole(prev => [
        `[UE 5.7 BRIDGE] Fetching tracking metadata from bridge...`,
        `[UE 5.7 BRIDGE] Found ${trackers.length} active tracker locators`,
        `[UE 5.7 BRIDGE] SUCCESS: Locked range limits to ${rangeInfo.label} (${rangeInfo.count} total frames)`,
        `[UE 5.7 BRIDGE] SUCCESS: Configured frame rate to ${activeFps} fps (${selectedFps === 'auto' ? 'auto-detected' : 'user override'})`,
        ...prev
      ]);
    }, 800);

    setTimeout(() => {
      const activeLevelLogs: string[] = [];
      if (spawnCameraInActiveLevel) {
        activeLevelLogs.push(`[UE 5.7 BRIDGE] Spawning CineCameraActor into the ACTIVE LEVEL actor pool`);
      } else {
        activeLevelLogs.push(`[UE 5.7 BRIDGE] Spawning CineCameraActor exclusively inside Sequencer workspace`);
      }
      
      if (spawnBackplateInActiveLevel) {
        activeLevelLogs.push(`[UE 5.7 BRIDGE] Registering Media Player and Camera Backplate Plane in ACTIVE LEVEL viewport`);
      } else {
        activeLevelLogs.push(`[UE 5.7 BRIDGE] Linking Backplate video texture content asset structure internally`);
      }

      setUnrealImportConsole(prev => [
        `[UE 5.7 BRIDGE] Creating Level Sequence Asset /Game/Cinematics/Solves/${ueSequenceName}`,
        `[UE 5.7 BRIDGE] Preset Filmback set to ${sensorPreset.name} (${sensorPreset.width}mm x ${sensorPreset.height}mm)`,
        ...activeLevelLogs,
        ...prev
      ]);
    }, 1800);

    setTimeout(() => {
      setUnrealImportConsole(prev => [
        `[UE 5.7 BRIDGE] Baking and keyframing ${rangeInfo.count} transform matrices...`,
        `[UE 5.7 BRIDGE] Re-projected ${trackers.filter(t => t.solved3D).length || 32} static survey markers into editor coordinate space`,
        `[UE 5.7 BRIDGE] SUCCESS: Level Sequence compiled and in-sync with active workspace!`,
        ...prev
      ]);
      setUnrealImporting(false);
    }, 3000);
  };

  return (
    <div className="min-h-screen bg-[#151515] text-[#e0e0e0] flex flex-col font-sans select-none antialiased">
      
      {/* Visual Header Grid Panel */}
      <header className="h-10 bg-[#252525] border-b border-[#3a3a3a] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-[#0078D7] rounded-sm flex items-center justify-center font-bold text-[10px] text-white">U</div>
          <span className="text-xs font-semibold tracking-wider uppercase text-[#999]">UE 5.7 | LensSync Pro v2.4</span>
        </div>
        <div className="flex gap-6 text-[11px] text-[#777]">
          <span>Project: <span className="text-[#ccc]">SHOT_042_PLATE_V03</span></span>
          <span>Format: <span className="text-[#ccc]">4096 x 2160 (1.89:1)</span></span>
          <span>FPS: <span className="text-[#ccc]">24.00</span></span>
        </div>
      </header>

      {/* Main Container Wrapper */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-4 flex flex-col space-y-4">

        {/* 4 Pipeline Step Navigation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          {[
            { step: 1, label: 'Tracking Markers', desc: 'Auto / manual templates', ico: Eye },
            { step: 2, label: 'Camera Solving', desc: 'Sensor alignment & triangulation', ico: Cpu },
            { step: 3, label: 'Distortion Mapping', desc: 'Symmetrical grids & K1 calibration', ico: Sliders },
            { step: 4, label: '3D Scene Export', desc: 'WebGL inspection & UE5 Code', ico: PackageCheck }
          ].map((item) => {
            const isCompleted = activeStep > item.step;
            const isActive = activeStep === item.step;

            return (
              <button
                key={item.step}
                onClick={() => {
                  setActiveStep(item.step);
                  addLog(`[PIPELINE] Navigated to Step ${item.step}: ${item.label}`);
                }}
                className={`text-left p-2.5 rounded-sm border transition-all relative overflow-hidden flex items-start space-x-2.5 group ${
                  isActive 
                    ? 'bg-[#1b1b1b] border-[#0078D7] text-white' 
                    : isCompleted 
                    ? 'bg-[#252525]/40 border-[#3a3a3a] text-[#ccc] hover:border-[#555]' 
                    : 'bg-[#1b1b1b]/20 border-[#2a2a2a] text-[#999] opacity-70 hover:opacity-100'
                }`}
              >
                <div className={`p-1.5 rounded-sm ${
                  isActive 
                    ? 'bg-[#0078D7] text-white' 
                    : isCompleted 
                    ? 'bg-[#333] text-[#4ade80]' 
                    : 'bg-[#252525] text-slate-500'
                }`}>
                  <item.ico className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="flex items-center space-x-1">
                    <span className="font-mono text-[9px] text-slate-500 font-bold">STAGE 0{item.step}</span>
                    {isCompleted && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] inline-block font-mono"></span>
                    )}
                  </div>
                  <h3 className={`text-xs font-bold tracking-wide ${isActive ? 'text-white' : 'text-[#ccc] group-hover:text-white transition-colors'}`}>
                    {item.label}
                  </h3>
                  <p className="text-[10px] text-slate-500 line-clamp-1 mt-0.5 font-medium">{item.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* 2-Column Creative Work Desk Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT INTERACTIVE SCREEN CANVAS (Takes 7 Cols on desktop) */}
          <div className="lg:col-span-7 flex flex-col space-y-4">
            
            {/* Conditional Renderer based on Active Step */}
            {activeStep !== 4 ? (
              <VideoCanvas
                currentFrame={currentFrame}
                trackers={trackers}
                setTrackers={setTrackers}
                selectedTrackerId={selectedTrackerId}
                setSelectedTrackerId={setSelectedTrackerId}
                focalLength={selectedFocal}
                sensorPreset={sensorPreset}
                lensDistortion={lensDistortion}
                distortionMappingActive={activeStep === 3}
                compareOriginal={compareOriginal}
                actualLensDistortion={actualLensDistortion}
                showGridCalib={showGridCalib}
                onManualStateChange={(val) => {
                  setManualAddedCount(val);
                  addLog(`[TRACKER] Added manual marker index point. Total edits: ${val}`);
                }}
              />
            ) : (
              <ThreeDViewport 
                solveData={solveData} 
                trackers={trackers} 
                currentFrame={currentFrame} 
              />
            )}

            {/* Cinematic Frame Timeline Controllers */}
            <div className="bg-[#1b1b1b] p-3 rounded-sm border border-[#3a3a3a] flex flex-col space-y-2.5 shadow-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-[10px] text-slate-500 font-bold">FPS TIMECODE SLATE</span>
                  <span className="text-[9px] font-mono bg-[#252525] text-[#ccc] border border-[#3a3a3a] px-1.5 py-0.5 rounded-sm">
                    100 Frames Active
                  </span>
                </div>
                <div className="font-mono text-xs text-[#999]">
                  Frame <span className="text-[#0078D7] font-bold">{String(currentFrame).padStart(2, '0')}</span> / 99
                </div>
              </div>

              <div className="flex items-center space-x-4">
                {/* Control Trigger Buttons */}
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => {
                      setCurrentFrame(0);
                      setIsPlaying(false);
                      addLog('[TIMELINE] Rewound playhead to frame 0.');
                    }}
                    title="Rewind to Frame 0"
                    className="p-1.5 rounded-sm bg-[#333] hover:bg-[#444] text-[#ccc] hover:text-white transition-colors border border-[#555]"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  
                  <button
                    onClick={() => {
                      setIsPlaying(!isPlaying);
                      addLog(`[TIMELINE] Playback ${!isPlaying ? 'started' : 'paused'}.`);
                    }}
                    className={`p-1.5 rounded-sm flex items-center justify-center font-bold px-3.5 space-x-1 shadow-md transition-all border ${
                      isPlaying 
                        ? 'bg-amber-700 hover:bg-amber-600 border-amber-600 text-white' 
                        : 'bg-[#0078D7] hover:bg-blue-600 border-[#0078D7] text-white'
                    }`}
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="w-3 h-3 text-white" />
                        <span className="text-[11px]">PAUSE</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 text-white fill-white" />
                        <span className="text-[11px] font-bold">PLAY PLATFORM</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Main scrubbing timeline bar slider */}
                <div className="flex-1 relative flex items-center group">
                  <input
                    type="range"
                    min="0"
                    max="99"
                    value={currentFrame}
                    onChange={(e) => {
                      setCurrentFrame(parseInt(e.target.value));
                      setIsPlaying(false);
                    }}
                    className="w-full h-1 bg-[#151515] roundedappearance-none cursor-pointer accent-[#0078D7] transition-colors"
                  />
                  {/* Subtle keyframe ticks */}
                  <div className="absolute left-1/4 w-1 h-1 bg-[#3a3a3a] rounded-full pointer-events-none"></div>
                  <div className="absolute left-1/2 w-1 h-1 bg-[#3a3a3a] rounded-full pointer-events-none"></div>
                  <div className="absolute left-3/4 w-1 h-1 bg-[#3a3a3a] rounded-full pointer-events-none"></div>
                </div>
              </div>
            </div>

            {/* Real-time System Event Terminal Console */}
            <div className="bg-[#111] p-3 rounded-sm border border-[#3a3a3a] font-mono text-xs shadow-lg relative overflow-hidden">
              <div className="border-b border-[#3a3a3a] pb-2 mb-2 flex items-center justify-between">
                <div className="flex items-center space-x-2 text-[#777] font-mono text-[10px]">
                  <Terminal className="w-3.5 h-3.5 text-[#0078D7]" />
                  <span>CINE-SOLVE EVENT REPORT LOGGER</span>
                </div>
                <button
                  onClick={() => setLogs(['[INIT] Log console cleared. Standing by.'])}
                  className="text-[#555] hover:text-[#aaa] text-[10px]"
                >
                  Clear Console logs
                </button>
              </div>
              <div className="h-28 overflow-y-auto space-y-1 custom-scrollbar pr-2 focus:outline-none text-[11px]">
                {logs.map((log, index) => {
                  let logColor = 'text-[#999]';
                  if (log.includes('[INIT]') || log.includes('[SUCCESS]')) logColor = 'text-[#4ade80]';
                  if (log.includes('[ERROR]')) logColor = 'text-red-400';
                  if (log.includes('[TRACKER]')) logColor = 'text-blue-400';
                  if (log.includes('[SOLVER]')) logColor = 'text-yellow-400';
                  return (
                    <div key={index} className={`font-mono leading-normal truncate ${logColor}`}>
                      {log}
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* RIGHT CONTROL SIDEBAR (Takes 5 Cols on desktop) */}
          <div className="lg:col-span-5 flex flex-col space-y-5">
            
            {/* Step 1: Tracking Markers Creation controls */}
            {activeStep === 1 && (
              <div className="bg-[#252525] border border-[#3a3a3a] rounded-sm flex flex-col shadow-lg animate-fadeIn overflow-hidden">
                <div className="p-3 border-b border-[#3a3a3a] bg-[#2a2a2a]">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#ccc] flex items-center gap-2">
                    <Sliders className="w-3.5 h-3.5 text-[#0078D7]" />
                    STAGE 1: MARKER CREATION
                  </h2>
                </div>

                <div className="p-3 flex flex-col space-y-3">
                  {/* Subsections: Auto tracking */}
                  <div className="p-2.5 bg-[#1b1b1b] rounded-sm border border-[#3a3a3a] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white font-bold">Auto Feature Extraction</span>
                      <span className="text-[10px] font-mono text-[#0078D7] font-semibold">Harris Corner Solver</span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-medium leading-normal">
                      Scans frame pixels and automatically places high-contrast sector markers under typical tracking constraints.
                    </p>

                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <div>
                        <label className="text-[9px] font-mono text-slate-500 uppercase font-bold">Max Locators</label>
                        <select className="w-full bg-[#151515] border border-[#444] rounded-sm px-2 py-1 text-[11px] font-mono mt-0.5 text-white">
                          <option>32 Markers</option>
                          <option>48 Markers</option>
                          <option>64 Markers</option>
                          <option>120 Markers</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] font-mono text-slate-500 uppercase font-bold">Min Correlation</label>
                        <select className="w-full bg-[#151515] border border-[#444] rounded-sm px-2 py-1 text-[11px] font-mono mt-0.5 text-white">
                          <option>0.90 NCC</option>
                          <option>0.95 NCC</option>
                          <option>0.85 NCC</option>
                        </select>
                      </div>
                    </div>

                    <button
                      onClick={triggerAutoTracking}
                      disabled={autoTrackingProgress !== null}
                      className="w-full mt-1.5 py-1.5 px-3 text-xs font-bold bg-[#0078D7] hover:bg-blue-600 disabled:bg-[#333] text-white rounded-sm font-sans flex items-center justify-center gap-1.5 transition-colors"
                    >
                      {autoTrackingProgress !== null ? (
                        <>
                          <div className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
                          <span>AUTOTRACKING ({autoTrackingProgress}%)</span>
                        </>
                      ) : (
                        <>
                          <Cpu className="w-3.5 h-3.5" />
                          <span>RUN AUTO TRACK FORWARD</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Manual Tracking Tips */}
                  <div className="p-2.5 bg-blue-900/10 border border-blue-500/30 rounded-sm font-medium flex gap-2.5 text-[11px] leading-relaxed text-blue-300">
                    <HelpCircle className="w-4 h-4 flex-shrink-0 text-blue-400 mt-0.5" />
                    <div>
                      <strong className="text-white block font-sans text-xs">Manual Marker Tuning Guide:</strong>
                      Click directly on the raw visual feed to deposit manual tracking locators. They will lock to 3D warehouse floor dimensions automatically.
                    </div>
                  </div>

                  {/* Current Active trackers list box */}
                  <div className="flex flex-col space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#777]">ACTIVE SCENE TRACKERS ({trackers.length})</span>
                      <button
                        onClick={handleDatasetReset}
                        className="text-[10px] text-[#0078D7] hover:underline hover:text-blue-400 font-bold"
                      >
                        Reset Dataset points
                      </button>
                    </div>
                    <div className="bg-[#151515] border border-[#3a3a3a] rounded-sm h-40 overflow-y-auto p-1 custom-scrollbar">
                      {trackers.map((t) => (
                        <div
                          key={t.id}
                          onClick={() => setSelectedTrackerId(t.id === selectedTrackerId ? null : t.id)}
                          className={`p-1 px-2.5 rounded-sm text-[11px] select-none transition-colors duration-150 flex items-center justify-between cursor-pointer border ${
                            t.id === selectedTrackerId 
                              ? 'bg-[#0078D7]/20 border-[#0078D7] text-white font-bold' 
                              : 'border-transparent hover:bg-[#1b1b1b] text-slate-300'
                          }`}
                        >
                          <div className="flex items-center space-x-2">
                            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: t.color }}></span>
                            <span className="font-mono text-[11px] truncate tracking-wide">{t.name}</span>
                          </div>
                          <span className="font-mono text-[9px] text-slate-500">
                            {t.id.startsWith('custom') ? 'Manual' : 'Solver Auto'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Camera Solving parameters and solver logic */}
            {activeStep === 2 && (
              <div className="bg-[#252525] border border-[#3a3a3a] rounded-sm flex flex-col shadow-lg animate-fadeIn overflow-hidden">
                <div className="p-3 border-b border-[#3a3a3a] bg-[#2a2a2a]">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#ccc] flex items-center gap-2">
                    <Sliders className="w-3.5 h-3.5 text-[#0078D7]" />
                    STAGE 2: CAMERA SOLVING
                  </h2>
                </div>

                <div className="p-3 flex flex-col space-y-3">
                  {/* Choose preset filmbacks */}
                  <div className="space-y-2.5">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-bold block">Cine Filmback Preset</label>
                      <select
                        value={sensorPreset.name}
                        onChange={(e) => {
                          const sel = SENSOR_PRESETS.find(p => p.name === e.target.value);
                          if (sel) {
                            setSensorPreset(sel);
                            if (sel.name === 'Custom Filmback...') {
                              setCustomWidth(sensorPreset.width);
                              setCustomHeight(sensorPreset.height);
                            }
                            addLog(`[CAMERA] Switched Filmback preset: ${sel.name} (${sel.width}mm x ${sel.height}mm)`);
                          }
                        }}
                        className="w-full bg-[#151515] border border-[#444] rounded-sm px-2.5 py-1.5 text-[11px] font-mono text-white mt-1 focus:border-[#0078D7]"
                      >
                        {SENSOR_PRESETS.map((p) => (
                          <option key={p.name} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2 p-2.5 bg-[#1b1b1b] rounded-sm border border-[#3a3a3a]">
                      <div>
                        <div className="flex justify-between items-center select-none mb-0.5">
                          <label className="text-[9px] font-mono text-slate-500 uppercase font-bold">Sensor Width</label>
                          <span className="text-[9px] font-mono text-slate-600">mm</span>
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          value={sensorPreset.name === 'Custom Filmback...' ? customWidth : sensorPreset.width}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            if (sensorPreset.name !== 'Custom Filmback...') {
                              const customPreset = SENSOR_PRESETS.find(p => p.name === 'Custom Filmback...');
                              if (customPreset) {
                                setSensorPreset(customPreset);
                                setCustomHeight(sensorPreset.height);
                              }
                            }
                            setCustomWidth(val);
                            addLog(`[CAMERA] Dynamic filmback sensor width customized: ${val}mm`);
                          }}
                          className="w-full bg-[#151515] border border-[#444] rounded-sm px-2 py-1 text-xs text-white font-mono focus:border-[#0078D7] focus:outline-none focus:ring-1 focus:ring-[#0078D7]/30 transition-all"
                          placeholder="Width (mm)"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between items-center select-none mb-0.5">
                          <label className="text-[9px] font-mono text-slate-500 uppercase font-bold">Sensor Height</label>
                          <span className="text-[9px] font-mono text-slate-600">mm</span>
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          value={sensorPreset.name === 'Custom Filmback...' ? customHeight : sensorPreset.height}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            if (sensorPreset.name !== 'Custom Filmback...') {
                              const customPreset = SENSOR_PRESETS.find(p => p.name === 'Custom Filmback...');
                              if (customPreset) {
                                setSensorPreset(customPreset);
                                setCustomWidth(sensorPreset.width);
                              }
                            }
                            setCustomHeight(val);
                            addLog(`[CAMERA] Dynamic filmback sensor height customized: ${val}mm`);
                          }}
                          className="w-full bg-[#151515] border border-[#444] rounded-sm px-2 py-1 text-xs text-white font-mono focus:border-[#0078D7] focus:outline-none focus:ring-1 focus:ring-[#0078D7]/30 transition-all"
                          placeholder="Height (mm)"
                        />
                      </div>
                    </div>

                    {/* Calibration Focal length slider */}
                    <div className="py-1">
                      <div className="flex justify-between text-[11px] text-slate-400 font-bold">
                        <span>Equiv. Focal Length (mm)</span>
                        <span className="text-[#0078D7] font-mono font-bold">{selectedFocal}mm</span>
                      </div>
                      <input
                        type="range"
                        min="12"
                        max="135"
                        step="1"
                        value={selectedFocal}
                        onChange={(e) => {
                          setSelectedFocal(parseInt(e.target.value));
                        }}
                        className="w-full h-1 bg-[#151515] rounded appearance-none cursor-pointer accent-[#0078D7] mt-1.5"
                      />
                      <div className="flex justify-between font-mono text-[9px] text-slate-600 mt-0.5">
                        <span>12mm (Wide)</span>
                        <span>50mm (Standard)</span>
                        <span>135mm (Tele)</span>
                      </div>
                    </div>
                  </div>

                  {/* Solving Trigger */}
                  <div className="p-2.5 bg-[#1b1b1b] border border-[#3a3a3a] rounded-sm flex flex-col space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-bold">Overlapping Target Count</span>
                      <span className="font-mono text-[#0078D7] font-semibold">{trackers.length} locators</span>
                    </div>

                    <p className="text-[10px] text-slate-500 font-medium leading-normal">
                      At least 8 overlapping trackers must be visible concurrently to guarantee 3D fundamental convergence vectors.
                    </p>

                    <button
                      onClick={handleCameraSolve}
                      disabled={isSolving}
                      className="w-full py-1.5 px-3 text-xs bg-[#0078D7] hover:bg-blue-600 disabled:bg-[#333] text-white rounded-sm font-sans font-bold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      {isSolving ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>PERFORMING BUNDLE ADJUSTMENT...</span>
                        </>
                      ) : (
                        <>
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>RUN CAMERA SOLVER TRIANGULATION</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Error diagnostics log values summary */}
                  {solveData.solved && (
                    <div className={`p-2.5 rounded-sm border font-medium flex flex-col space-y-1 ${
                      solveData.rmsError < 0.35 
                        ? 'bg-[#1b1b1b] border-[#4ade80]/30 text-[#4ade80]' 
                        : 'bg-[#1b1b1b] border-amber-500/30 text-amber-500'
                    }`}>
                      <div className="flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wider">
                        {solveData.rmsError < 0.35 ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#4ade80]" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        )}
                        <span>SOLVE EVALUATION: {solveData.rmsError < 0.35 ? 'EXCELLENT' : 'AVERAGE'}</span>
                      </div>
                      <div className="text-xl font-bold font-mono tracking-tight">
                        {solveData.rmsError} <span className="text-xs font-normal text-slate-500">RMS px</span>
                      </div>
                      <p className="text-[10px] font-medium leading-normal opacity-90 block text-slate-400">
                        {solveData.rmsError < 0.35 
                          ? 'Sub-pixel accuracy achieved. Lens coordinates undistorted perfectly. Ready for export.' 
                          : 'Good convergence, but minor radial distortion slippage remains. Calibrate lens in step 3 to lower drift.'
                        }
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 3: Lens Distortion Calibration Mapping */}
            {activeStep === 3 && (
              <div className="bg-[#252525] border border-[#3a3a3a] rounded-sm flex flex-col shadow-lg animate-fadeIn overflow-hidden">
                <div className="p-3 border-b border-[#3a3a3a] bg-[#2a2a2a]">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#ccc] flex items-center gap-2">
                    <Sliders className="w-3.5 h-3.5 text-[#0078D7]" />
                    STAGE 3: DISTORTION CALIBRATION
                  </h2>
                </div>

                <div className="p-3 flex flex-col space-y-3">
                  {/* Sub-panels for visual helpers */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        setShowGridCalib(prev => !prev);
                        addLog(`[CALIBRATOR] Symmetrical grid overlay ${!showGridCalib ? 'enabled' : 'disabled'}.`);
                      }}
                      className={`p-1.5 rounded-sm border text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-1 ${
                        showGridCalib 
                          ? 'bg-[#1b1b1b] border-[#0078D7] text-white' 
                          : 'bg-[#151515] border-[#3a3a3a] text-[#777] hover:text-white hover:border-[#555]'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      Grid: {showGridCalib ? 'ON' : 'OFF'}
                    </button>

                    <button
                      onClick={() => {
                        setCompareOriginal(prev => !prev);
                        addLog(`[CALIBRATOR] Comparative split screen ${!compareOriginal ? 'enabled' : 'disabled'}.`);
                      }}
                      className={`p-1.5 rounded-sm border text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-1 ${
                        compareOriginal 
                          ? 'bg-[#1b1b1b] border-[#0078D7] text-white' 
                          : 'bg-[#151515] border-[#3a3a3a] text-[#777] hover:text-white hover:border-[#555]'
                      }`}
                    >
                      <Video className="w-3.5 h-3.5" />
                      Split-Screen: {compareOriginal ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  <div className="p-2.5 bg-blue-900/10 border border-blue-500/25 rounded-md text-[10px] text-blue-300 font-medium leading-normal">
                    <span className="text-white block font-bold mb-0.5">Calibration Challenge Directions:</span>
                    The camera lens footage has severe barrel distortion (K1 value mismatch). Drag the K1 slider to align perspective grids perfectly.
                  </div>

                  {/* Distortion Coeff Slider controls */}
                  <div className="space-y-3">
                    {/* K1 - Radial 1st order */}
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 font-bold">
                        <span>K1 - Radial Distortion (First Order)</span>
                        <span className="text-[#0078D7] font-mono font-bold text-xs">{lensDistortion.k1.toFixed(3)}</span>
                      </div>
                      <input
                        type="range"
                        min="-0.45"
                        max="0.15"
                        step="0.005"
                        value={lensDistortion.k1}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setLensDistortion(prev => ({ ...prev, k1: val }));
                        }}
                        className="w-full h-1 bg-[#151515] rounded appearance-none cursor-pointer accent-[#0078D7] mt-1.5"
                      />
                      <div className="flex justify-between font-mono text-[9px] text-slate-600 mt-0.5">
                        <span>-0.450 (Barrel)</span>
                        <span>0.000 (Pin)</span>
                        <span>0.150 (Pincushion)</span>
                      </div>
                    </div>

                    {/* K2 - Radial 2nd order */}
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 font-bold">
                        <span>K2 - Radial Distortion (Second Order)</span>
                        <span className="text-[#0078D7] font-mono font-bold text-xs">{lensDistortion.k2.toFixed(3)}</span>
                      </div>
                      <input
                        type="range"
                        min="-0.15"
                        max="0.15"
                        step="0.005"
                        disabled={!isLensMatched}
                        value={lensDistortion.k2}
                        className="w-full h-1 bg-[#151515] rounded appearance-none cursor-pointer disabled:opacity-30 mt-1.5"
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setLensDistortion(prev => ({ ...prev, k2: val }));
                        }}
                      />
                    </div>

                    {/* Stretch / Crop scale size slider to fill boundaries */}
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 font-bold">
                        <span>Calibrated Crop/Scale Stretch Factor</span>
                        <span className="text-[#0078D7] font-mono font-bold text-xs">{lensDistortion.scale.toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.90"
                        max="1.25"
                        step="0.01"
                        value={lensDistortion.scale}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setLensDistortion(prev => ({ ...prev, scale: val }));
                        }}
                        className="w-full h-1 bg-[#151515] rounded appearance-none cursor-pointer accent-[#0078D7] mt-1.5"
                      />
                    </div>
                  </div>

                  {/* Target Alignment validation feedback panel */}
                  <div className={`p-2.5 rounded-sm font-medium border flex items-center justify-between ${
                    isLensMatched 
                      ? 'bg-emerald-950/20 border-emerald-800/30 text-emerald-400' 
                      : 'bg-amber-950/20 border-amber-800/30 text-amber-400'
                  }`}>
                    <div className="flex items-center space-x-2">
                      {isLensMatched ? (
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-dashed border-amber-400 animate-spin"></div>
                      )}
                      <div>
                        <span className="block text-xs font-bold font-sans">
                          {isLensMatched ? 'LENS MATCH SUCCESSFUL!' : 'CALIBRATING CURVATURE...'}
                        </span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          {isLensMatched 
                            ? 'Grid vectors matched. Camera trajectory solver convergence locked!' 
                            : 'Fringe perspective lines are bent. Move K1 to align lines horizontal.'
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Final 3D Scene Export panel */}
            {activeStep === 4 && (
              <div className="bg-[#252525] border border-[#3a3a3a] rounded-sm flex flex-col shadow-lg animate-fadeIn overflow-hidden">
                <div className="p-3 border-b border-[#3a3a3a] bg-[#2a2a2a]">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[#ccc] flex items-center gap-2">
                    <Download className="w-3.5 h-3.5 text-[#0078D7]" />
                    STAGE 4: FINAL 3D SCENE EXPORT
                  </h2>
                </div>

                <div className="p-3 flex flex-col space-y-3">
                  {/* Exporter actions buttons list */}
                  <div className="flex flex-col space-y-2">
                    <button
                      onClick={downloadPythonScript}
                      className="w-full p-2.5 rounded-sm bg-[#0078D7] hover:bg-blue-600 text-white font-sans font-bold text-xs flex items-center justify-between shadow-md transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <Code2 className="w-4 h-4" />
                        <span>DOWNLOAD UNREAL PYTHON INTEGRATOR</span>
                      </div>
                      <span className="text-[9px] font-mono bg-[#151515] text-[#ccc] px-1.5 py-0.5 rounded-sm border border-[#3a3a3a]">.PY FILE</span>
                    </button>

                    <button
                      onClick={downloadTrackingJSON}
                      className="w-full p-2.5 rounded-sm bg-[#222] hover:bg-[#333] border border-[#3a3a3a] text-xs font-bold text-[#ccc] flex items-center justify-between transition-colors shadow-sm"
                    >
                      <div className="flex items-center space-x-2">
                        <Layers className="w-4 h-4 text-slate-500" />
                        <span>DOWNLOAD SOLVED MARKERS JSON</span>
                      </div>
                      <span className="text-[9px] font-mono bg-[#151515] text-slate-500 px-1.5 py-0.5 rounded-sm border border-[#3a3a3a]">.JSON</span>
                    </button>
                  </div>

                  <div className="p-2.5 bg-[#171717] rounded-sm border border-[#3a3a3a] flex flex-col space-y-1 text-[11px]">
                    <span className="text-[#999] font-bold uppercase tracking-wider text-[9px] font-mono">EXPORT REPORT SUMMARY:</span>
                    <div className="grid grid-cols-2 gap-y-1 bg-[#111] border border-[#252525] p-2 rounded text-slate-400 font-mono text-[10px]">
                      <span>Solved Camera Pose:</span>
                      <span className="text-[#ccc] text-right">100 keys (100%)</span>
                      <span>Solved Locators:</span>
                      <span className="text-[#ccc] text-right">{trackers.filter(t => t.solved3D).length} points</span>
                      <span>Final Mean Error:</span>
                      <span className="text-emerald-400 text-right font-bold">{solveData.rmsError} pixels</span>
                      <span>Intended UE Target:</span>
                      <span className="text-[#ccc] text-right">UE 5.7+</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>

        </div>

        {/* Dynamic section: UE5 Custom In-Editor Importer Utility Widget (Detailed Unreal Plugin Interface mockup) */}
        <section className="bg-[#202020] border border-[#3a3a3a] rounded-sm overflow-hidden shadow-xl">
          {/* Unreal styled top editor ribbon bar header */}
          <div className="bg-[#2a2a2a] px-4 py-2 border-b border-[#3a3a3a] flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                UNREAL ENGINE 5.7 IN-EDITOR BRIDGE UTILITY WIDGET (SIMULATOR)
              </h3>
            </div>
            <span className="font-mono text-[9px] text-slate-500 font-bold uppercase">UE5 integration engine v1.2</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 items-start">
            
            {/* Unreal Utility Widget Panel Layout */}
            <div className="md:col-span-5 bg-[#151515] border border-[#3a3a3a] rounded-sm p-4 flex flex-col space-y-3">
              <div className="border-b border-[#3a3a3a] pb-1.5 mb-1">
                <div className="flex justify-between items-center">
                  <span className="text-[#777] font-mono text-[10px] font-bold">EditorUtilityWidget:</span>
                  <span className="text-[9px] font-mono text-[#4ade80] bg-[#4ade80]/10 px-1 py-0.5 rounded-sm">CONNECTED</span>
                </div>
                <h4 className="text-[11px] font-bold text-slate-300 font-sans mt-0.5 uppercase tracking-wide">
                  Cinema Camera Solver Bridge
                </h4>
              </div>

              {/* Unreal styled interface inputs */}
              <div className="space-y-2.5 font-mono text-xs">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-slate-500 text-[9px] font-bold block uppercase">
                      UNREAL CAMERA & SEQUENCER IMPORT TARGET
                    </label>
                    <span className="text-[9px] text-[#0078D7] font-bold font-mono">
                      (Seq: {ueSequenceName})
                    </span>
                  </div>
                  
                  <div className="relative flex items-center bg-[#202020] border border-[#3a3a3a] rounded-sm group focus-within:border-[#0078D7] transition-all">
                    <input
                      type="text"
                      value={ueCombinedPath}
                      onChange={(e) => setUeCombinedPath(e.target.value)}
                      className="w-full bg-transparent px-2.5 py-1 text-slate-200 text-xs font-mono outline-none"
                    />
                    
                    {/* Browse Folder Icon Button */}
                    <button
                      onClick={() => {
                        try {
                          const clean = ueCombinedPath.replace(/\\/g, '/');
                          const idx = clean.lastIndexOf('/');
                          if (idx !== -1) {
                            const parentDir = clean.substring(0, idx);
                            if (SIMULATED_FS[parentDir]) {
                              setPickerCurrentDir(parentDir);
                            }
                          }
                        } catch (err) {}
                        setIsPickerOpen(true);
                      }}
                      title="Open In-Editor Asset Browser or Windows Explorer"
                      className="h-7 px-2 border-l border-[#3a3a3a] text-slate-400 hover:text-white hover:bg-[#2e2e2e] transition-colors flex items-center justify-center cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                    </button>
                  </div>
                  <div className="text-[9px] text-slate-500 font-mono mt-1 flex justify-between">
                    <span className="truncate max-w-[180px]">File: {ueCombinedPath.split(/[/\\]/).pop()}</span>
                    <button 
                      onClick={() => setIsPickerOpen(true)}
                      className="text-[#0078D7] hover:underline font-bold cursor-pointer"
                    >
                      Browse Workspace...
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[9px] font-bold">
                  <div>
                    <span className="text-slate-500 block uppercase tracking-wider">FPS OVERRIDE</span>
                    <span className="bg-[#202020] border border-[#3a3a3a] text-[#ccc] rounded-sm block mt-0.5 transition-all focus-within:border-[#0078D7]">
                      <select
                        value={selectedFps}
                        onChange={(e) => setSelectedFps(e.target.value)}
                        className="w-full bg-[#202020] text-slate-200 outline-none border-0 px-1 py-1 text-center font-mono text-[10px] cursor-pointer"
                      >
                        <option value="auto">Auto ({detectedFps} fps)</option>
                        <option value="23.976">23.976 (Film)</option>
                        <option value="24">24 (PAL)</option>
                        <option value="29.976">29.976 (NTSC)</option>
                        <option value="30">30 (Broadcast)</option>
                      </select>
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block uppercase tracking-wider">CLIP RANGE</span>
                    <span className="bg-[#202020] border border-[#3a3a3a] text-[#ccc] rounded-sm block mt-0.5 transition-all focus-within:border-[#0078D7]">
                      <select
                        value={selectedClipRange}
                        onChange={(e) => setSelectedClipRange(e.target.value)}
                        className="w-full bg-[#202020] text-slate-200 outline-none border-0 px-1 py-1 text-center font-mono text-[10px] cursor-pointer"
                      >
                        <option value="auto">Auto ({detectedClipRange})</option>
                        <option value="custom">Full (0 - 99)</option>
                        <option value="head">Trim Head (10 - auto)</option>
                        <option value="tail">Trim Tail (0 - 89)</option>
                        <option value="half">First Half (0 - 49)</option>
                      </select>
                    </span>
                  </div>
                </div>

                {/* World Level Spawn Ingress Options */}
                <div className="pt-2.5 border-t border-[#3a3a3a] space-y-2 mt-2">
                  <span className="text-slate-500 block uppercase tracking-wider text-[8px] font-mono font-black">WORLD INGRESS OPTIONS</span>
                  <div className="flex flex-col space-y-2.5 pl-0.5">
                    <label className="flex items-center space-x-2 text-slate-300 hover:text-white cursor-pointer select-none text-[10px] font-mono">
                      <input
                        type="checkbox"
                        checked={spawnCameraInActiveLevel}
                        onChange={(e) => setSpawnCameraInActiveLevel(e.target.checked)}
                        className="rounded-sm bg-[#111] border border-[#3a3a3a] checked:bg-[#0078D7] checked:border-[#0078D7] focus:ring-0 w-3.5 h-3.5 accent-[#0078D7] cursor-pointer"
                      />
                      <span>Spawn CineCamera Actor into Active Level</span>
                    </label>
                    <label className="flex items-center space-x-2 text-slate-300 hover:text-white cursor-pointer select-none text-[10px] font-mono">
                      <input
                        type="checkbox"
                        checked={spawnBackplateInActiveLevel}
                        onChange={(e) => setSpawnBackplateInActiveLevel(e.target.checked)}
                        className="rounded-sm bg-[#111] border border-[#3a3a3a] checked:bg-[#0078D7] checked:border-[#0078D7] focus:ring-0 w-3.5 h-3.5 accent-[#0078D7] cursor-pointer"
                      />
                      <span>Inject projection backplate into Active Level</span>
                    </label>
                  </div>
                </div>

                <button
                  onClick={testUnrealBridgeImport}
                  disabled={unrealImporting || !solveData.solved}
                  className="w-full py-1.5 px-3 bg-[#0078D7] hover:bg-blue-600 disabled:bg-[#333] text-white font-sans font-black text-xs rounded-sm shadow-md uppercase tracking-wider transition-colors mt-2"
                >
                  {unrealImporting ? (
                    'Processing solver keyframes...'
                  ) : !solveData.solved ? (
                    'Run camera solver in Stage 2 first'
                  ) : (
                    'Import Deserialized Solve into Sequence'
                  )}
                </button>
              </div>
            </div>

            {/* Unreal editor execution console reporting outputs */}
            <div className="md:col-span-7 bg-[#151515] border border-[#3a3a3a] rounded-sm p-4">
              <span className="text-[#666] font-mono text-[10px] block pb-1.5 uppercase font-bold tracking-wider">Unreal Python Terminal Console:</span>
              <div className="bg-[#111] border border-[#252525] rounded-sm h-52 p-2.5 font-mono text-[11px] overflow-y-auto space-y-1 text-[#ccc]">
                {unrealImportConsole.map((line, lIdx) => {
                  let color = 'text-slate-500';
                  if (line.includes('SUCCESS')) color = 'text-[#4ade80] font-bold';
                  if (line.includes('Creating') || line.includes('Spawning')) color = 'text-[#0078D7]';
                  return (
                    <div key={lIdx} className={`font-mono leading-normal pb-0.5 ${color}`}>
                      {line}
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </section>

        {/* Detailed step-by-step UE5 system instructions / readme drawer */}
        <section className="bg-[#1b1b1b] border border-[#3a3a3a] rounded-sm p-4">
          <div className="flex items-center space-x-2 pb-2.5 border-b border-[#3a3a3a]">
            <Code2 className="w-4 h-4 text-[#0078D7]" />
            <span className="text-xs font-bold text-white uppercase tracking-wider font-sans">
              UNREAL ENGINE 5.7 BRIDGE INSTALL & INTEGRATION MANUAL
            </span>
          </div>
          <div className="text-[11px] text-slate-400 font-sans mt-3 space-y-3">
            <p className="font-medium">
              Find below the system integration instructions to copy and build files into your custom local UE5 project directory layout:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3" id="bridge_instructions_cards">
              <div className="bg-[#151515] p-3 rounded-sm border border-[#3a3a3a] flex flex-col space-y-1">
                <span className="font-mono text-[#0078D7] text-[10px] font-bold">01. COPY THE PY FILE</span>
                <p className="text-slate-500 leading-normal font-medium text-[10px]">
                  Copy the generated Python script code and save it in your local folder: <code className="text-[#ccc] px-1 py-0.5 rounded-sm bg-[#222] border border-[#333]">Content/Python/import_tracker_data.py</code>.
                </p>
              </div>
              <div className="bg-[#151515] p-3 rounded-sm border border-[#3a3a3a] flex flex-col space-y-1">
                <span className="font-mono text-[#0078D7] text-[10px] font-bold">02. ACTIVATE UE5 PYTHON</span>
                <p className="text-slate-500 leading-normal font-medium text-[10px]">
                  Verify Python developer scripts are active in editor. Enable <code className="text-[#ccc] px-1 py-0.5 rounded-sm bg-[#222] border border-[#333]">Python Editor Script Plugin</code> under Plugins settings.
                </p>
              </div>
              <div className="bg-[#151515] p-3 rounded-sm border border-[#3a3a3a] flex flex-col space-y-1">
                <span className="font-mono text-[#0078D7] text-[10px] font-bold">03. RUN TERMINAL CMD</span>
                <p className="text-slate-500 leading-normal font-medium text-[10px]">
                  Open Unreal log outputs panel, switch standard input line to Python, and execute: <code className="text-[#ccc] px-1 py-0.5 rounded-sm bg-[#222] border border-[#333]">import import_tracker_data</code>.
                </p>
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* Corporate Dashboard Footer */}
      <footer className="h-9 border-t border-[#3a3a3a] bg-[#1a1a1a] flex items-center justify-between px-4 text-[10px] text-slate-500 font-mono shrink-0">
        <span>Unreal Engine Motion Tracker Platform • Built for UE 5.7</span>
        <span>alexhall3d@gmail.com</span>
      </footer>

      {/* Interactive Combined Simulated Workspace Picker Modal */}
      {isPickerOpen && (() => {
        const currentDirectoryItems = SIMULATED_FS[pickerCurrentDir] || [];
        const filteredItems = currentDirectoryItems.filter(item => 
          item.name.toLowerCase().includes(pickerSearch.toLowerCase())
        );

        const handleGoUp = () => {
          const cleanPath = pickerCurrentDir.replace(/\\/g, '/');
          const bits = cleanPath.split('/');
          if (bits.length > 1) {
            bits.pop();
            const parent = bits.join('/');
            if (SIMULATED_FS[parent] || parent === 'D:') {
              setPickerCurrentDir(parent);
              setSelectedFileSystemItem(null);
            }
          }
        };

        const handleItemClick = (item: SimulatedFile) => {
          setSelectedFileSystemItem(item.name);
        };

        const handleItemDoubleClick = (item: SimulatedFile) => {
          if (item.type === 'folder') {
            const nextDir = pickerCurrentDir === 'D:' ? `D:/${item.name}` : `${pickerCurrentDir}/${item.name}`;
            setPickerCurrentDir(nextDir);
            setSelectedFileSystemItem(null);
            setPickerSearch('');
          } else {
            const filePath = pickerCurrentDir === 'D:' ? `D:/${item.name}` : `${pickerCurrentDir}/${item.name}`;
            setUeCombinedPath(filePath);
            setIsPickerOpen(false);
            setSelectedFileSystemItem(null);
            setPickerSearch('');
          }
        };

        const handleConfirmSelect = () => {
          if (selectedFileSystemItem) {
            const item = currentDirectoryItems.find(i => i.name === selectedFileSystemItem);
            if (item) {
              if (item.type === 'folder') {
                const nextDir = pickerCurrentDir === 'D:' ? `D:/${item.name}` : `${pickerCurrentDir}/${item.name}`;
                setPickerCurrentDir(nextDir);
                setSelectedFileSystemItem(null);
                setPickerSearch('');
              } else {
                const filePath = pickerCurrentDir === 'D:' ? `D:/${item.name}` : `${pickerCurrentDir}/${item.name}`;
                setUeCombinedPath(filePath);
                setIsPickerOpen(false);
                setSelectedFileSystemItem(null);
                setPickerSearch('');
              }
            }
          }
        };

        return (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-sans select-none">
            <div className={`w-full max-w-4xl h-[560px] rounded border shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${
              pickerType === 'unreal' 
                ? 'bg-[#151515] border-[#3a3a3a] text-slate-300' 
                : 'bg-[#1f1f1f] border-[#2b2b2b] text-slate-200'
            }`}>
              
              {/* Modal Top Title Bar / Ribbon */}
              <div className={`h-11 px-4 border-b flex items-center justify-between shrink-0 ${
                pickerType === 'unreal' 
                  ? 'bg-[#212121] border-[#3a3a3a]' 
                  : 'bg-[#1c1c1c] border-[#2b2b2b]'
              }`}>
                <div className="flex items-center space-x-2">
                  <FolderOpen className={`w-4 h-4 ${pickerType === 'unreal' ? 'text-amber-500' : 'text-blue-500'}`} />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {pickerType === 'unreal' ? 'UE5.7 Content Asset Browser' : 'Windows 11 Explorer'}
                  </span>
                </div>

                {/* View Switcher Controls */}
                <div className="flex items-center space-x-1.5 bg-[#111] p-0.5 border border-[#333] rounded-sm text-[10px] font-bold font-mono">
                  <button
                    type="button"
                    onClick={() => {
                      setPickerType('unreal');
                      setSelectedFileSystemItem(null);
                    }}
                    className={`px-2.5 py-1 rounded-sm transition-all cursor-pointer ${
                      pickerType === 'unreal' 
                        ? 'bg-amber-600 text-black font-black' 
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    UE5.7 Browser
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPickerType('windows');
                      setSelectedFileSystemItem(null);
                    }}
                    className={`px-2.5 py-1 rounded-sm transition-all cursor-pointer ${
                      pickerType === 'windows' 
                        ? 'bg-[#0078D7] text-white font-bold' 
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    Windows Explorer
                  </button>
                </div>

                <button 
                  type="button"
                  onClick={() => setIsPickerOpen(false)}
                  className="p-1 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Navigation Bar: Arrow guides, Breadcrumbs and Search */}
              <div className={`h-10 px-3 border-b flex items-center space-x-2 shrink-0 ${
                pickerType === 'unreal' 
                  ? 'bg-[#1a1a1a] border-[#3a3a3a]' 
                  : 'bg-[#202020] border-[#2b2b2b]'
              }`}>
                {/* Back button */}
                <button
                  type="button"
                  onClick={handleGoUp}
                  disabled={pickerCurrentDir === 'D:'}
                  className={`p-1 rounded-sm transition-colors border ${
                    pickerCurrentDir === 'D:' 
                      ? 'opacity-30 border-transparent cursor-not-allowed' 
                      : pickerType === 'unreal'
                        ? 'bg-[#2e2e2e] border-[#444] text-slate-300 hover:bg-[#3e3e3e] cursor-pointer'
                        : 'bg-[#2a2a2a] border-[#333] text-slate-200 hover:bg-[#353535] cursor-pointer'
                  }`}
                  title="Go Up One Directory"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {/* Breadcrumb Path Viewer */}
                <div className={`flex-1 flex items-center h-7 px-2.5 rounded-sm text-xs font-mono select-all overflow-x-auto truncate ${
                  pickerType === 'unreal' 
                    ? 'bg-[#121212] border border-[#303030] text-amber-500' 
                    : 'bg-[#181818] border border-[#333] text-slate-300'
                }`}>
                  {pickerType === 'unreal' ? '/Game/Cinematics' : 'D:\\unreal_project\\Content\\Cinematics'}
                  {pickerCurrentDir.replace('D:/unreal_project/Content/Cinematics', '').replace(/\//g, ' \\ ')}
                </div>

                {/* Filter Search */}
                <div className={`relative w-48 h-7 flex items-center border rounded-sm ${
                  pickerType === 'unreal' ? 'bg-[#121212] border-[#303030]' : 'bg-[#181818] border-[#333]'
                }`}>
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search folder assets..."
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    className="w-full bg-transparent pl-7 pr-2 text-xs font-medium font-sans outline-none text-slate-200"
                  />
                  {pickerSearch && (
                    <button 
                      onClick={() => setPickerSearch('')}
                      className="p-1 hover:text-white"
                    >
                      <X className="w-3 h-3 text-slate-500" />
                    </button>
                  )}
                </div>
              </div>

              {/* Central Split Layout: Sidebar and main items list */}
              <div className="flex-1 flex overflow-hidden">
                
                {/* Left Hierarchy Sidebar Panel */}
                <div className={`w-48 border-r overflow-y-auto flex flex-col p-2 select-none shrink-0 ${
                  pickerType === 'unreal' 
                    ? 'bg-[#1b1b1b] border-[#3a3a3a]' 
                    : 'bg-[#191919] border-[#2a2a2a]'
                }`}>
                  <span className={`text-[9px] font-bold tracking-wider font-mono my-1 uppercase ${
                    pickerType === 'unreal' ? 'text-amber-600' : 'text-slate-500'
                  }`}>
                    {pickerType === 'unreal' ? 'Project Folders' : 'This PC / Devices'}
                  </span>

                  <div className="space-y-1 mt-1 font-mono text-[10px]">
                    <button
                      type="button"
                      onClick={() => {
                        setPickerCurrentDir('D:');
                        setSelectedFileSystemItem(null);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded-sm flex items-center space-x-2 transition-colors cursor-pointer ${
                        pickerCurrentDir === 'D:' 
                          ? 'bg-[#333] text-white font-bold' 
                          : 'text-slate-400 hover:bg-[#252525] hover:text-slate-200'
                      }`}
                    >
                      <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                      <span>Local Disk (D:)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPickerCurrentDir('D:/unreal_project');
                        setSelectedFileSystemItem(null);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded-sm flex items-center space-x-2 transition-colors cursor-pointer ${
                        pickerCurrentDir === 'D:/unreal_project' 
                          ? 'bg-[#333] text-white font-bold' 
                          : 'text-slate-400 hover:bg-[#252525] hover:text-slate-200'
                      }`}
                    >
                      <Folder className="w-3.5 h-3.5 text-amber-500" />
                      <span>unreal_project</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPickerCurrentDir('D:/unreal_project/Content');
                        setSelectedFileSystemItem(null);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-sm flex items-center space-x-2 transition-colors cursor-pointer ${
                        pickerCurrentDir === 'D:/unreal_project/Content' 
                          ? 'bg-[#333] text-white font-bold' 
                          : 'text-slate-400 hover:bg-[#252525] hover:text-slate-200'
                      }`}
                    >
                      <Folder className="w-3.5 h-3.5 text-amber-500" />
                      <span>┗ Content</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPickerCurrentDir('D:/unreal_project/Content/Cinematics');
                        setSelectedFileSystemItem(null);
                      }}
                      className={`w-full text-left px-4 py-1.5 rounded-sm flex items-center space-x-2 transition-colors cursor-pointer ${
                        pickerCurrentDir === 'D:/unreal_project/Content/Cinematics' 
                          ? 'bg-[#333] text-white font-bold' 
                          : 'text-slate-400 hover:bg-[#252525] hover:text-slate-200'
                      }`}
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                      <span>┗ ┗ Cinematics</span>
                    </button>
                    
                    {/* Inner virtual workspace subfolders */}
                    {['Shot_01_SolverSequence', 'Shot_02_DesertPan', 'Shot_03_TrackingGrid'].map(fold => {
                      const fullP = `D:/unreal_project/Content/Cinematics/${fold}`;
                      return (
                        <button
                          key={fold}
                          type="button"
                          onClick={() => {
                            setPickerCurrentDir(fullP);
                            setSelectedFileSystemItem(null);
                          }}
                          className={`w-full text-left pl-7 pr-2 py-1 rounded-sm flex items-center space-x-1.5 transition-colors cursor-pointer ${
                            pickerCurrentDir === fullP 
                              ? 'bg-[#333] text-white font-bold' 
                              : 'text-slate-500 hover:bg-[#252525] hover:text-slate-300'
                          }`}
                        >
                          <Folder className="w-3 h-3 text-amber-600/75 shrink-0" />
                          <span className="truncate">{fold}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Main Content Explorer Display Panel */}
                <div className="flex-1 p-4 overflow-y-auto bg-[#111111]">
                  
                  {filteredItems.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center space-y-2 text-slate-500 font-mono text-xs">
                      <FolderOpen className="w-10 h-10 stroke-1 opacity-40 text-slate-600" />
                      <span>No matching assets or files found in workspace</span>
                    </div>
                  ) : pickerType === 'unreal' ? (
                    /* UE5.7 Premium Content Browser visual bento style layout */
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {filteredItems.map(item => {
                        const isSelected = selectedFileSystemItem === item.name;
                        const isUasset = item.extension === 'uasset';
                        const isMov = item.extension === 'mov';
                        
                        return (
                          <div
                            key={item.name}
                            onClick={() => handleItemClick(item)}
                            onDoubleClick={() => handleItemDoubleClick(item)}
                            className={`group relative rounded border flex flex-col aspect-square overflow-hidden cursor-pointer transition-all duration-150 ${
                              isSelected 
                                ? 'border-amber-500 bg-amber-550/10 ring-1 ring-amber-500/50' 
                                : 'border-[#2d2d2d] bg-[#1a1a1a] hover:border-[#444] hover:bg-[#202020]'
                            }`}
                          >
                            {/* Graphic asset preview box */}
                            <div className={`flex-1 flex flex-col items-center justify-center p-3 relative ${
                              item.type === 'folder' 
                                ? 'bg-amber-950/5' 
                                : isUasset 
                                  ? 'bg-[#004e3e]/15' 
                                  : 'bg-[#553300]/10'
                            }`}>
                              {item.type === 'folder' ? (
                                <div className="relative">
                                  <Folder className="w-14 h-14 text-amber-500 drop-shadow-lg" />
                                  <span className="absolute bottom-1 right-2 font-mono text-[8px] bg-[#111] text-amber-400 px-1 py-0.2 rounded-sm border border-amber-500/30">Folder</span>
                                </div>
                              ) : isUasset ? (
                                <div className="text-center flex flex-col items-center space-y-1">
                                  <div className="w-12 h-12 rounded bg-[#004d40] border border-[#00695c] flex items-center justify-center text-teal-400 font-black text-lg shadow-md font-mono">
                                    LS
                                  </div>
                                  <span className="text-[8px] tracking-wide font-extrabold uppercase bg-emerald-900 border border-emerald-500 text-white px-1 py-0.2 rounded-sm font-mono scale-90">LEVEL SEQ</span>
                                </div>
                              ) : (
                                <div className="text-center flex flex-col items-center space-y-1">
                                  <div className="w-12 h-12 rounded bg-amber-950 border border-amber-600 flex items-center justify-center text-amber-400 shadow-md">
                                    <FileVideo className="w-6 h-6 text-amber-500" />
                                  </div>
                                  <span className="text-[8px] tracking-wide font-extrabold uppercase bg-[#bd5300] border border-[#ff8800] text-white px-1 py-0.2 rounded-sm font-mono scale-90">MEDIA</span>
                                </div>
                              )}
                            </div>

                            {/* Info Slate Bar */}
                            <div className={`p-2 font-sans flex flex-col border-t ${
                              pickerType === 'unreal' ? 'border-[#2d2d2d] bg-[#1f1f1f]' : 'border-[#333] bg-[#222]'
                            }`}>
                              <span className="text-xs text-slate-200 font-bold truncate tracking-wide" title={item.name}>
                                {item.name.replace(/\.[^/.]+$/, '')}
                              </span>
                              <div className="flex justify-between items-center text-[8px] text-slate-500 font-mono mt-0.5">
                                <span>{item.type === 'folder' ? 'Folder' : `${item.extension?.toUpperCase()}`}</span>
                                {item.size && <span>{item.size}</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Windows File Explorer list row details style layout */
                    <table className="w-full text-left font-sans text-xs select-none">
                      <thead>
                        <tr className="border-b border-[#2b2b2b] text-[10px] uppercase font-bold text-slate-500 font-mono">
                          <th className="pb-2 font-bold w-1/2">Name</th>
                          <th className="pb-2 font-bold w-1/4">Type</th>
                          <th className="pb-2 font-bold w-1/4 text-right">Size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.map(item => {
                          const isSelected = selectedFileSystemItem === item.name;
                          return (
                            <tr
                              key={item.name}
                              onClick={() => handleItemClick(item)}
                              onDoubleClick={() => handleItemDoubleClick(item)}
                              className={`border-b border-[#222] transition-colors hover:bg-[#2a2a2a] cursor-pointer ${
                                isSelected ? 'bg-blue-950/40 text-blue-200 font-bold' : ''
                              }`}
                            >
                              <td className="py-2.5 flex items-center space-x-2.5 max-w-xs truncate">
                                {item.type === 'folder' ? (
                                  <Folder className="w-4 h-4 text-yellow-500 shrink-0" />
                                ) : (
                                  <FileVideo className="w-4 h-4 text-blue-400 shrink-0" />
                                )}
                                <span className="truncate text-[11px]">{item.name}</span>
                              </td>
                              <td className="py-2.5 text-slate-400 font-mono text-[10px]">
                                {item.type === 'folder' ? 'File Folder' : `${item.extension?.toUpperCase()} Video Clip`}
                              </td>
                              <td className="py-2.5 text-slate-400 text-right font-mono text-[10px]">
                                {item.size || '--'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                </div>
              </div>

              {/* Modal Bottom Selection Details / Control Footer Bar */}
              <div className={`h-14 px-4 border-t flex items-center justify-between shrink-0 text-xs font-mono select-none ${
                pickerType === 'unreal' 
                  ? 'bg-[#1e1e1e] border-[#3a3a3a] text-slate-400' 
                  : 'bg-[#1c1c1c] border-[#2b2b2b] text-slate-300'
              }`}>
                <div className="flex flex-col">
                  <div className="flex items-center space-x-1">
                    <span className="text-slate-500 font-bold">Selected Element:</span>
                    <span className={`font-bold font-sans text-xs ${selectedFileSystemItem ? 'text-white' : 'text-slate-500 font-normal italic'}`}>
                      {selectedFileSystemItem || 'None'}
                    </span>
                  </div>
                  <span className="text-[9px] text-slate-500 truncate max-w-[400px]">
                    Import folder: {pickerCurrentDir}
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsPickerOpen(false);
                      setSelectedFileSystemItem(null);
                    }}
                    className={`px-3 py-1.5 font-bold text-xs rounded-sm transition-colors cursor-pointer ${
                      pickerType === 'unreal' 
                        ? 'bg-[#333] hover:bg-[#444] text-slate-300 border border-[#444]' 
                        : 'bg-[#2a2a2a] hover:bg-[#353535] text-slate-200 border border-[#333]'
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmSelect}
                    disabled={!selectedFileSystemItem}
                    className={`px-4 py-1.5 font-sans font-black text-xs rounded-sm shadow uppercase tracking-wide transition-all cursor-pointer ${
                      !selectedFileSystemItem 
                        ? 'opacity-40 bg-slate-800 text-slate-500 cursor-not-allowed' 
                        : pickerType === 'unreal'
                          ? 'bg-amber-600 hover:bg-amber-500 text-black font-extrabold'
                          : 'bg-[#0078D7] hover:bg-blue-600 text-white font-bold'
                    }`}
                  >
                    {selectedFileSystemItem && (currentDirectoryItems.find(i => i.name === selectedFileSystemItem)?.type === 'folder') 
                      ? 'Open Folder' 
                      : pickerType === 'unreal' ? 'Link Solve Target' : 'Select Solve & Movie'}
                  </button>
                </div>
              </div>

            </div>
          </div>
        );
      })()}

    </div>
  );
}
