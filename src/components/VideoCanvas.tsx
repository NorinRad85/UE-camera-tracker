import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Tracker, SensorPreset, LensDistortion } from '../types';
import { evaluateCameraTrajectory, project3DToCamera, generate3DLocators, Point3D } from '../utils/motionSimulation';
import { Plus, Maximize2, Trash2, Eye, EyeOff } from 'lucide-react';

interface VideoCanvasProps {
  currentFrame: number;
  trackers: Tracker[];
  setTrackers: React.Dispatch<React.SetStateAction<Tracker[]>>;
  selectedTrackerId: string | null;
  setSelectedTrackerId: (id: string | null) => void;
  focalLength: number;
  sensorPreset: SensorPreset;
  lensDistortion: LensDistortion; // current user calibration slider values
  distortionMappingActive: boolean; // True during Step 3
  compareOriginal: boolean; // Compare calibrated undistorted frame side-by-side
  actualLensDistortion: LensDistortion; // Real physical camera distortion (to calibrate toward)
  showGridCalib: boolean; // Toggle overlay tracking grid lines
  onManualStateChange?: (addedCount: number) => void;
}

export default function VideoCanvas({
  currentFrame,
  trackers,
  setTrackers,
  selectedTrackerId,
  setSelectedTrackerId,
  focalLength,
  sensorPreset,
  lensDistortion,
  distortionMappingActive,
  compareOriginal,
  actualLensDistortion,
  showGridCalib,
  onManualStateChange
}: VideoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredPos, setHoveredPos] = useState<{ x: number; y: number } | null>(null);
  const [mouseCanvasPos, setMouseCanvasPos] = useState<{ cx: number; cy: number } | null>(null);
  const [manualAddedCount, setManualAddedCount] = useState(0);

  // Load ground-truth points once to render footage spatial outlines
  const locators3D = useMemo(() => generate3DLocators(), []);

  // Frame details simulation helper
  const cameraPose = useMemo(() => {
    return evaluateCameraTrajectory(currentFrame, 100);
  }, [currentFrame]);

  // Compute clean render metrics based on standard aspect ratios (e.g. 16:9 cinematic format)
  const drawSceneOnCanvas = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    pose: any,
    applyCalibrationUndistort: boolean = false
  ) => {
    // Fill deep dark warehouse ambient plate background
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, width, height);

    // Render concrete space pillars, floor outlines, ceiling lamps drawn in 2D projected space coordinates!
    // Let's draw floor lines by connecting points
    ctx.lineWidth = 1.5;
    
    // Custom camera distortion applied for visuals
    // If applyCalibrationUndistort is true, we simulate calibrating the distortion away.
    // If false, the visuals show physical "raw footage" which contains original lens distortion curves (from actualLensDistortion).
    const visualDistortion = applyCalibrationUndistort
      ? { k1: actualLensDistortion.k1 - lensDistortion.k1, k2: actualLensDistortion.k2 - lensDistortion.k2, p1: 0, p2: 0, scale: 1 } 
      : actualLensDistortion;

    // Draw Floor Tiles Lines
    ctx.strokeStyle = '#1e293b';
    for (let xLin = -5; xLin <= 5; xLin += 1) {
      ctx.beginPath();
      let first = true;
      for (let zLin = -15; zLin <= 20; zLin += 1) {
        const pLoc = project3DToCamera(
          [xLin, -1.5, zLin],
          pose.pos,
          pose.rot,
          focalLength,
          sensorPreset.width,
          sensorPreset.height,
          visualDistortion,
          true
        );
        if (pLoc.zDepth > 0.1) {
          const cx = pLoc.x * width;
          const cy = pLoc.y * height;
          if (first) {
            ctx.moveTo(cx, cy);
            first = false;
          } else {
            ctx.lineTo(cx, cy);
          }
        }
      }
      ctx.stroke();
    }

    // Draw Horizontal Grid lines
    for (let zLin = -15; zLin <= 20; zLin += 4) {
      ctx.beginPath();
      let first = true;
      for (let xLin = -5; xLin <= 5; xLin += 0.5) {
        const pLoc = project3DToCamera(
          [xLin, -1.5, zLin],
          pose.pos,
          pose.rot,
          focalLength,
          sensorPreset.width,
          sensorPreset.height,
          visualDistortion,
          true
        );
        if (pLoc.zDepth > 0.1) {
          const cx = pLoc.x * width;
          const cy = pLoc.y * height;
          if (first) {
            ctx.moveTo(cx, cy);
            first = false;
          } else {
            ctx.lineTo(cx, cy);
          }
        }
      }
      ctx.stroke();
    }

    // Draw Ceiling beams
    ctx.strokeStyle = '#1e293b';
    for (let xCeil = -4; xCeil <= 4; xCeil += 8) {
      ctx.beginPath();
      let first = true;
      for (let zCeil = -10; zCeil <= 20; zCeil += 2) {
        const pLoc = project3DToCamera(
          [xCeil, 3.5, zCeil],
          pose.pos,
          pose.rot,
          focalLength,
          sensorPreset.width,
          sensorPreset.height,
          visualDistortion,
          true
        );
        if (pLoc.zDepth > 0.1) {
          const cx = pLoc.x * width;
          const cy = pLoc.y * height;
          if (first) {
            ctx.moveTo(cx, cy);
            first = false;
          } else {
            ctx.lineTo(cx, cy);
          }
        }
      }
      ctx.stroke();
    }

    // Draw high-contrast circular tracking targets on the floor and walls!
    locators3D.forEach((item) => {
      const proj = project3DToCamera(
        item.pos,
        pose.pos,
        pose.rot,
        focalLength,
        sensorPreset.width,
        sensorPreset.height,
        visualDistortion,
        true
      );

      if (proj.visible && proj.zDepth > 0.1) {
        const cx = proj.x * width;
        const cy = proj.y * height;

        // Radius shrink with depth distance
        const r = Math.max(2, Math.min(18, 120 / proj.zDepth));

        // Draw classic VFX tracking target circle with split checker quadrants
        // Drawing outer border
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 1st quadrant black sector
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, 0, Math.PI / 2);
        ctx.lineTo(cx, cy);
        ctx.fillStyle = '#1e293b';
        ctx.fill();

        // 3rd quadrant black sector
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, Math.PI, Math.PI * 1.5);
        ctx.lineTo(cx, cy);
        ctx.fillStyle = '#1e293b';
        ctx.fill();

        // Outer rim
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // Draw lens dust particles, center camera reticle to make footage extremely authentic
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 20, height / 2);
    ctx.lineTo(width / 2 + 20, height / 2);
    ctx.moveTo(width / 2, height / 2 - 20);
    ctx.lineTo(width / 2, height / 2 + 20);
    ctx.stroke();
  };

  // Re-draw canvas whenever variables modify
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Handle distortion mapping step:
    if (distortionMappingActive && compareOriginal) {
      // Draw split-screen original feed left / undistorted calibrated feed right
      // Clear screen
      ctx.clearRect(0,0, width, height);
      
      // Let's render the left half with RAW distorted footage
      // Save canvas state
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width / 2, height);
      ctx.clip();
      drawSceneOnCanvas(ctx, width, height, cameraPose, false); // RAW distorted
      ctx.restore();

      // Render the right half with undistorted calibrated plate
      ctx.save();
      ctx.beginPath();
      ctx.rect(width / 2, 0, width / 2, height);
      ctx.clip();
      drawSceneOnCanvas(ctx, width, height, cameraPose, true); // UNDISTORTED calibrated
      ctx.restore();

      // Draw separator bar
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(width / 2, 0);
      ctx.lineTo(width / 2, height);
      ctx.stroke();

      // Label Overlay
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#ef4444';
      ctx.fillText('DISTORTED LENS PLATE', 20, 25);
      
      ctx.fillStyle = '#06b6d4';
      ctx.textAlign = 'right';
      ctx.fillText('UNDISTORTED CALIBRATED LAYER', width - 20, 25);
      ctx.textAlign = 'left';
    } else {
      // Normal single view rendering (Standard Distorted Footage, option to toggle Grid calibrated overlay)
      // Check if user is showing undistorted view toggle
      drawSceneOnCanvas(ctx, width, height, cameraPose, false);
    }

    // 2. Draw Camera overlay information (Timecodes, FPS indices, RED Cine visual simulation overlays)
    ctx.font = '10px monospace';
    ctx.fillStyle = '#475569';
    // Left overlay
    ctx.fillText('CAM_01_RED_RAW_V5.7_S56', 20, height - 20);
    ctx.fillText('H.264 CODIAC COMPRESSED', 20, height - 35);
    // Right overlay
    ctx.textAlign = 'right';
    const hours = '01';
    const minutes = '12';
    const seconds = String(Math.floor(currentFrame / 24)).padStart(2, '0');
    const subFrames = String(currentFrame % 24).padStart(2, '0');
    ctx.fillText(`TC: ${hours}:${minutes}:${seconds}:${subFrames}`, width - 20, height - 20);
    ctx.fillText(`FPS: 24.00 (F: ${String(currentFrame).padStart(4, '0')}/0100)`, width - 20, height - 35);
    ctx.textAlign = 'left';

    // 3. Draw active visual Tracking Markers overlapping
    trackers.forEach((track) => {
      const fd = track.frames[currentFrame];
      if (!fd || !fd.active || !track.visible) return;

      const px = fd.x * width;
      const py = fd.y * height;
      const isSelected = selectedTrackerId === track.id;

      // Draw tracking boxes around point
      ctx.strokeStyle = isSelected ? '#fbbf24' : track.color; // active yellow outline on select
      ctx.lineWidth = isSelected ? 2 : 1.2;

      // Inner pattern tracking template (solid box)
      const pSize = 10;
      ctx.strokeRect(px - pSize/2, py - pSize/2, pSize, pSize);

      // Outer search window boundary box (dotted)
      const sSize = 22;
      ctx.beginPath();
      ctx.setLineDash([3, 2]); // dotted pattern
      ctx.strokeRect(px - sSize/2, py - sSize/2, sSize, sSize);
      ctx.setLineDash([]); // clear dash

      // Small point crosshair target
      ctx.beginPath();
      ctx.moveTo(px - 4, py);
      ctx.lineTo(px + 4, py);
      ctx.moveTo(px, py - 4);
      ctx.lineTo(px, py + 4);
      ctx.stroke();

      // Draw marker index code label
      ctx.fillStyle = isSelected ? '#fbbf24' : '#94a3b8';
      ctx.font = '9px monospace';
      ctx.fillText(track.name, px + sSize/2 + 3, py + 3);

      // Render historical tracker tail track line (previous 8 camera frames trailing)
      ctx.beginPath();
      ctx.strokeStyle = `${track.color}88`; // transparency
      ctx.lineWidth = 1;
      let lineFirst = true;
      for (let prevIdx = Math.max(0, currentFrame - 10); prevIdx <= currentFrame; prevIdx++) {
        const pFd = track.frames[prevIdx];
        if (pFd && pFd.active) {
          const tcx = pFd.x * width;
          const tcy = pFd.y * height;
          if (lineFirst) {
            ctx.moveTo(tcx, tcy);
            lineFirst = false;
          } else {
            ctx.lineTo(tcx, tcy);
          }
        }
      }
      ctx.stroke();
    });

    // 4. Render Calibration Grid Overlay if active
    if (showGridCalib) {
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.45)'; // cyan semi-transparent grid
      ctx.lineWidth = 1;
      const gridDensity = 12;
      
      // We calculate grid points and bend them relative to current model calibration (lensDistortion)
      // This visualizes how the lens distortion coefficients are bended in math
      for (let gRow = 0; gRow <= gridDensity; gRow++) {
        // Horizontal straight grid line
        const yNorm = -1 + (gRow / gridDensity) * 2; // -1 to +1
        ctx.beginPath();
        for (let gCol = 0; gCol <= 40; gCol++) {
          const xNorm = -1 + (gCol / 40) * 2;
          
          // Bend coordinates by current calibration values to represent calibration reference grid
          const r2 = xNorm * xNorm + yNorm * yNorm;
          const r4 = r2 * r2;
          const radial = 1 + lensDistortion.k1 * r2 + lensDistortion.k2 * r4;
          
          const bx = xNorm * radial * lensDistortion.scale;
          const by = yNorm * radial * lensDistortion.scale;

          const cx = (0.5 + bx * 0.5) * width;
          const cy = (0.5 - by * 0.5) * height;

          if (gCol === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        }
        ctx.stroke();

        // Vertical straight grid line
        const xVNorm = -1 + (gRow / gridDensity) * 2;
        ctx.beginPath();
        for (let gCol = 0; gCol <= 40; gCol++) {
          const yVNorm = -1 + (gCol / 40) * 2;
          
          const r2 = xVNorm * xVNorm + yVNorm * yVNorm;
          const r4 = r2 * r2;
          const radial = 1 + lensDistortion.k1 * r2 + lensDistortion.k2 * r4;
          
          const bx = xVNorm * radial * lensDistortion.scale;
          const by = yVNorm * radial * lensDistortion.scale;

          const cx = (0.5 + bx * 0.5) * width;
          const cy = (0.5 - by * 0.5) * height;

          if (gCol === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    }
  }, [
    currentFrame,
    trackers,
    selectedTrackerId,
    focalLength,
    sensorPreset,
    lensDistortion,
    distortionMappingActive,
    compareOriginal,
    actualLensDistortion,
    showGridCalib,
    cameraPose,
    locators3D
  ]);

  // Click handler to register manual point track clicks
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Convert to 0-1 normalized units
    const nx = cx / canvas.width;
    const ny = cy / canvas.height;

    // See if clicked near any active visual tracker to select it
    let clickedTrackerId: string | null = null;
    let minDist = 18; // 18 pixels matching threshold

    trackers.forEach((t) => {
      const fd = t.frames[currentFrame];
      if (fd && fd.active) {
        const tx = fd.x * canvas.width;
        const ty = fd.y * canvas.height;
        const dist = Math.sqrt((cx - tx) ** 2 + (cy - ty) ** 2);
        if (dist < minDist) {
          minDist = dist;
          clickedTrackerId = t.id;
        }
      }
    });

    if (clickedTrackerId) {
      setSelectedTrackerId(clickedTrackerId);
    } else {
      // Create a manual Custom Tracker and append it into active tracking array!
      // Generate unique name
      const customId = `custom_${Date.now()}`;
      const nameNum = trackers.filter(t => t.id.startsWith('custom')).length + 1;
      const customName = `M_Custom_${String(nameNum).padStart(2, '0')}`;
      const colors = ['#f43f5e', '#a855f7', '#06b6d4', '#10b981', '#fbbf24'];
      const chosenColor = colors[nameNum % colors.length];

      // Build out tracker keys across all frames
      // To simulate tracking this manual point frame by frame, we map its position relative
      // to the overall camera's Translation changes so it "sticks" to the 3D ground layer realistically!
      const initialFrame = currentFrame;
      const framesMap: { [idx: number]: any } = {};

      // Calculate pseudo 3D depth position based on click location
      const simulatedZ = 12.0 - (ny * 14.0); // further down = closer in depth meters
      const [tx, ty, tz] = [
        (nx - 0.5) * (simulatedZ * (sensorPreset.width / focalLength)), 
        -1.5, // flat floor placement 
        -simulatedZ
      ];

      for (let f = 0; f < 100; f++) {
        const pose = evaluateCameraTrajectory(f, 100);
        const proj = project3DToCamera(
          [tx, ty, tz],
          pose.pos,
          pose.rot,
          focalLength,
          sensorPreset.width,
          sensorPreset.height,
          actualLensDistortion,
          true
        );

        framesMap[f] = {
          x: proj.x,
          y: proj.y,
          active: proj.visible,
          manual: f === initialFrame,
          correlation: 1.0
        };
      }

      const newTracker: Tracker = {
        id: customId,
        name: customName,
        color: chosenColor,
        frames: framesMap,
        visible: true
      };

      setTrackers((prev) => [...prev, newTracker]);
      setSelectedTrackerId(customId);
      setManualAddedCount(prev => prev + 1);
      
      if (onManualStateChange) {
        onManualStateChange(manualAddedCount + 1);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    setMouseCanvasPos({ cx, cy });

    // Store coordinate positions relative to screen
    setHoveredPos({
      x: cx / canvas.width,
      y: cy / canvas.height
    });
  };

  const handleMouseLeave = () => {
    setHoveredPos(null);
    setMouseCanvasPos(null);
  };

  // Magnified loupe zoom calculation
  const zoomFactor = 3;
  const loupeWidth = 140;
  const loupeHeight = 140;

  return (
    <div className="flex flex-col space-y-2">
      <div className="relative w-full rounded-sm overflow-hidden border border-[#3a3a3a] bg-[#1a1a1a] shadow-lg">
        
        {/* Aspect ratio frame markings (Cine grid bounding corners) */}
        <div className="absolute inset-x-0 bottom-0 top-0 border-x-[40px] border-slate-950/20 pointer-events-none flex justify-between items-center z-10">
          <div className="h-full border-r border-dashed border-red-500/10"></div>
          <div className="h-full border-l border-dashed border-red-500/10"></div>
        </div>

        <canvas
          ref={canvasRef}
          width={840}
          height={480}
          onClick={handleCanvasClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="w-full h-auto cursor-crosshair bg-slate-950 block"
        />

        {/* Magnifying visual Tracker Loupe (Picture-in-picture pixel analysis window) */}
        {hoveredPos && mouseCanvasPos && (
          <div
            className="absolute rounded-sm border border-[#555] bg-[#151515]/95 overflow-hidden shadow-xl flex flex-col pointer-events-none z-20"
            style={{
              left: mouseCanvasPos.cx > 600 ? '20px' : 'auto',
              right: mouseCanvasPos.cx > 600 ? 'auto' : '20px',
              top: '20px',
              width: `${loupeWidth}px`,
            }}
          >
            <div className="bg-[#2a2a2a] border-b border-[#3a3a3a] text-[9px] text-slate-400 font-mono px-2 py-0.5 text-center font-bold">
              SUB-PIXEL ANALYSIS
            </div>
            {/* Loupe Simulation View */}
            <div className="relative w-full h-[120px] overflow-hidden bg-slate-900 flex items-center justify-center">
              {/* Zoomed checker simulation dot */}
              <div className="absolute w-[40px] h-[40px] rounded-full border border-black overflow-hidden flex flex-wrap scale-[1.5]">
                <div className="w-[20px] h-[20px] bg-white"></div>
                <div className="w-[20px] h-[20px] bg-slate-800"></div>
                <div className="w-[20px] h-[20px] bg-slate-800"></div>
                <div className="w-[20px] h-[20px] bg-white"></div>
              </div>
              {/* Overlay crosshair lines */}
              <div className="absolute w-full h-0.5 bg-[#0078D7] opacity-60"></div>
              <div className="absolute h-full w-0.5 bg-[#0078D7] opacity-60"></div>
              {/* Zoom box ring overlay */}
              <div className="absolute inset-5 rounded-full border border-[#0078D7] opacity-30 animate-pulse"></div>
            </div>
            <div className="p-1 px-2 font-mono text-[9px] text-slate-300 flex justify-between bg-slate-950">
              <span>X: {(hoveredPos.x * 1920).toFixed(0)}</span>
              <span>Y: {(hoveredPos.y * 1080).toFixed(0)}</span>
            </div>
          </div>
        )}

        {/* Top left marker overlay info panel */}
        <div className="absolute top-4 left-4 z-20 flex space-x-2">
          <div className="bg-slate-950/90 backdrop-blur-md px-3 py-1.5 rounded-sm border border-[#3a3a3a] font-mono text-[10px] text-slate-300 flex items-center space-x-1.5 shadow-md">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-ping"></span>
            <span>FEEDBACK: CAMERA SOLVE READY</span>
          </div>
          {selectedTrackerId && (
            <div className="bg-slate-950/90 backdrop-blur-md px-3 py-1.5 rounded-sm border border-[#0078D7] font-mono text-[10px] text-[#0078D7] flex items-center space-x-2 shadow-md">
              <span>ACTIVE MARKER: {trackers.find(t => t.id === selectedTrackerId)?.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Manual Tracker Actions control bar under frame screen */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#252525]/30 p-2.5 px-3 rounded-sm border border-[#3a3a3a]">
        <div className="flex items-center space-x-2 text-xs text-slate-500 font-medium">
          <Plus className="w-4 h-4 text-[#0078D7]" />
          <span>Click anywhere in video to place a custom Manual Marker Point</span>
        </div>
        <div className="flex items-center space-x-2">
          {selectedTrackerId && (
            <button
              onClick={() => {
                setTrackers((prev) => prev.filter((t) => t.id !== selectedTrackerId));
                setSelectedTrackerId(null);
                setManualAddedCount(prev => Math.max(0, prev - 1));
                if (onManualStateChange) {
                  onManualStateChange(Math.max(0, manualAddedCount - 1));
                }
              }}
              className="px-3 py-1 text-xs bg-[#3a1d1d] hover:bg-rose-950 text-rose-300 rounded-sm border border-[#5a2a2a] flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove Selected
            </button>
          )}

          <button
            onClick={() => {
              // Toggle visibility on all trackers
              setTrackers(prev => prev.map(t => ({ ...t, visible: !t.visible })));
            }}
            className="px-3 py-1 text-xs bg-[#2a2a2a] hover:bg-[#333] text-slate-200 rounded-sm border border-[#444] flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {trackers.some(t => t.visible) ? (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                Hide All Markers
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                Show All Markers
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
