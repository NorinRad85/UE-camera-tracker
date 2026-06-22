import { Tracker, CameraSolveData, LensDistortion } from '../types';

// Let's create a class or helper objects to simulate a 3D warehouse/corridor of tracking markers
export interface Point3D {
  id: string;
  name: string;
  pos: [number, number, number]; // [x, y, z] in world meters
  color: string;
}

// Generate a set of 3D locator points in a corridor/warehouse
export function generate3DLocators(): Point3D[] {
  const locators: Point3D[] = [];
  const colors = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', 
    '#ec4899', '#06b6d4', '#14b8a6', '#f43f5e', '#10b981'
  ];

  let idCounter = 1;

  // Add floor track points
  for (let z = -15; z <= 20; z += 5) {
    for (let x of [-4, -2, 0, 2, 4]) {
      // Add slight random offset to make it look realistic
      const dx = (Math.random() - 0.5) * 0.8;
      const dy = -1.5; // floor is at y = -1.5m
      const dz = (Math.random() - 0.5) * 0.8;
      locators.push({
        id: `loc_${idCounter++}`,
        name: `L_Floor_${idCounter - 1}`,
        pos: [x + dx, dy, z + dz],
        color: colors[idCounter % colors.length]
      });
    }
  }

  // Add wall track points (left wall at x = -5, right wall at x = +5)
  for (let z = -12; z <= 18; z += 6) {
    for (let y of [-0.5, 1.0, 2.5]) {
      // Left Wall
      locators.push({
        id: `loc_${idCounter++}`,
        name: `L_WallL_${idCounter - 1}`,
        pos: [-5.0, y + (Math.random() - 0.5) * 0.4, z + (Math.random() - 0.5) * 0.4],
        color: colors[idCounter % colors.length]
      });
      // Right Wall
      locators.push({
        id: `loc_${idCounter++}`,
        name: `L_WallR_${idCounter - 1}`,
        pos: [5.0, y + (Math.random() - 0.5) * 0.4, z + (Math.random() - 0.5) * 0.4],
        color: colors[idCounter % colors.length]
      });
    }
  }

  // Add ceiling track points
  for (let z = -10; z <= 20; z += 8) {
    for (let x of [-3, 3]) {
      locators.push({
        id: `loc_${idCounter++}`,
        name: `L_Ceiling_${idCounter - 1}`,
        pos: [x + (Math.random() - 0.5) * 0.5, 3.5, z + (Math.random() - 0.5) * 0.5],
        color: colors[idCounter % colors.length]
      });
    }
  }

  return locators;
}

// Generate the camera trajectory (ground truth)
export interface CameraKey {
  pos: [number, number, number];
  rot: [number, number, number]; // pitch, yaw, roll in degrees
}

export function evaluateCameraTrajectory(frame: number, maxFrames: number): CameraKey {
  const t = frame / (maxFrames - 1); // 0 to 1
  
  // Cinematic Dolly-In + Handheld sway
  // Start from z = 18m, dolly-in to z = -5m
  const startZ = 18.0;
  const endZ = -5.0;
  const z = startZ + t * (endZ - startZ);
  
  // Custom camera path: panning slightly right, elevation changing, with handheld noise
  const x = Math.sin(t * Math.PI) * 1.5 + Math.sin(t * 30) * 0.05; // horizontal move + high frequency wiggle
  const y = 0.2 * Math.cos(t * Math.PI * 2) + Math.cos(t * 30) * 0.03; // vertical pedestal change + high frequency wiggle
  
  // Handheld rotation wiggle (Pitch, Yaw, Roll)
  const basePitch = -3.0 + t * 4.0; // slight camera tilt upwards as we move forward
  const baseYaw = -15.0 + t * 25.0;  // slight panning left to right
  const baseRoll = Math.sin(t * Math.PI * 4) * 0.3; // subtle handheld frame roll
  
  const pitchNoise = Math.sin(t * 40) * 0.3 + Math.cos(t * 110) * 0.1;
  const yawNoise = Math.cos(t * 35) * 0.3 + Math.sin(t * 95) * 0.1;
  const rollNoise = Math.sin(t * 50) * 0.1;

  return {
    pos: [x, y, z],
    rot: [basePitch + pitchNoise, baseYaw + yawNoise, baseRoll + rollNoise]
  };
}

// Transform world point into camera space
// Unreal coordinate systems: X-forward (often), here we will use a Standard CG system for math:
// X is right, Y is up, Z is backward (or forward, let's use standard OpenGL camera coords: X=right, Y=up, Z=-forward)
// Then map to final tracker coordinate.
export function project3DToCamera(
  point: [number, number, number],
  camPos: [number, number, number],
  camRot: [number, number, number], // Pitch (x-rot), Yaw (y-rot), Roll (z-rot) in degrees
  focalLength: number,
  sensorWidth: number,
  sensorHeight: number,
  distortion: LensDistortion,
  applyDistortion: boolean = true
): { x: number; y: number; visible: boolean; zDepth: number } {
  const [px, py, pz] = point;
  const [cx, cy, cz] = camPos;

  // 1. Translate point to camera coordinate system (pinhole camera: camera relative positioning)
  let dx = px - cx;
  let dy = py - cy;
  let dz = pz - cz;

  // 2. Rotate point by inverse camera rotation
  // Camera rotation in Euler: Pitch, Yaw, Roll
  // Pitch = Rx (rotation around X), Yaw = Ry (rotation around Y), Roll = Rz (rotation around Z)
  // Converting degrees to radians
  const pitchRad = (camRot[0] * Math.PI) / 180;
  const yawRad = (camRot[1] * Math.PI) / 180;
  const rollRad = (camRot[2] * Math.PI) / 180;

  // Yaw (around Y axis)
  let x1 = dx * Math.cos(yawRad) - dz * Math.sin(yawRad);
  let y1 = dy;
  let z1 = dx * Math.sin(yawRad) + dz * Math.cos(yawRad);

  // Pitch (around X axis)
  let x2 = x1;
  let y2 = y1 * Math.cos(pitchRad) + z1 * Math.sin(pitchRad);
  let z2 = -y1 * Math.sin(pitchRad) + z1 * Math.cos(pitchRad);

  // Roll (around Z axis)
  let camX = x2 * Math.cos(rollRad) + y2 * Math.sin(rollRad);
  let camY = -x2 * Math.sin(rollRad) + y2 * Math.cos(rollRad);
  let camZ = z2; // This is the distance along the optical axis

  // In standard OpenGL camera, the camera faces the -Z direction.
  // So camZ should be negative for objects in front of the camera.
  // Let's use front-facing where Z is positive in front of lens:
  const zDepth = -camZ; // positive distance in front of lens

  if (zDepth <= 0.1) {
    return { x: 0.5, y: 0.5, visible: false, zDepth };
  }

  // 3. Pinhole Projection to Sensor Plane (centered at origin, sensor size in mm)
  // focalLength is in mm, sensorWidth is in mm, sensorHeight is in mm
  // x_sensor = (camX / zDepth) * focalLength (in mm)
  const xSensor = (camX / zDepth) * focalLength;
  const ySensor = (camY / zDepth) * focalLength;

  // Normalize relative to half-sizes
  let xNorm = xSensor / (sensorWidth / 2);
  let yNorm = ySensor / (sensorHeight / 2);

  const outOfBounds = Math.abs(xNorm) > 1.2 || Math.abs(yNorm) > 1.2;

  // 4. Apply Brown-Conrady Radial Lens Distortion model (K1, K2, P1, P2) if true
  if (applyDistortion) {
    const r2 = xNorm * xNorm + yNorm * yNorm;
    const r4 = r2 * r2;
    
    // Radial distortion factor
    const radial = 1 + distortion.k1 * r2 + distortion.k2 * r4;
    
    // Distort coordinates
    let xDistorted = xNorm * radial;
    let yDistorted = yNorm * radial;

    // Tangential distortion
    xDistorted += distortion.p1 * (2 * xNorm * yNorm) + distortion.p2 * (r2 + 2 * xNorm * xNorm);
    yDistorted += distortion.p1 * (r2 + 2 * yNorm * yNorm) + distortion.p2 * (2 * xNorm * yNorm);

    // Dynamic scale adjustment
    xNorm = xDistorted * distortion.scale;
    yNorm = yDistorted * distortion.scale;
  }

  // Convert to screen space coordinates (0 to 1, with y flipped: 0 is top, 1 is bottom)
  const screenX = 0.5 + xNorm * 0.5;
  const screenY = 0.5 - yNorm * 0.5;

  const visible = !outOfBounds && screenX >= 0.05 && screenX <= 0.95 && screenY >= 0.05 && screenY <= 0.95;

  return {
    x: screenX,
    y: screenY,
    visible,
    zDepth
  };
}

// Generate complete ground-truth and simulated trackers dataset
export function generateSimulationDataset(
  frameCount: number,
  focalLength: number,
  sensorWidth: number,
  sensorHeight: number,
  distortion: LensDistortion,
  trackingNoisePx: number = 0.3, // tracking error noise
  solveMismatch: boolean = false // whether solved lens calibration matches or not
): { locators: Point3D[]; cameras: CameraKey[]; trackers: Tracker[] } {
  const locators = generate3DLocators();
  const cameras: CameraKey[] = [];
  const trackers: Tracker[] = [];

  // Generate cameras
  for (let f = 0; f < frameCount; f++) {
    cameras.push(evaluateCameraTrajectory(f, frameCount));
  }

  // Initialize trackers
  locators.forEach((loc) => {
    trackers.push({
      id: loc.id,
      name: loc.name,
      color: loc.color,
      frames: {},
      solved3D: undefined,
      visible: true
    });
  });

  // Project points and create tracking frame data
  for (let f = 0; f < frameCount; f++) {
    const cam = cameras[f];

    locators.forEach((loc, index) => {
      const proj = project3DToCamera(
        loc.pos,
        cam.pos,
        cam.rot,
        focalLength,
        sensorWidth,
        sensorHeight,
        distortion,
        true // always apply physical lens distortion on footage
      );

      // Add camera tracking noise if it's visible
      if (proj.visible) {
        // Pixel noise
        // Image dimensions: lets assume 1920x1080
        const randomAngle = Math.random() * Math.PI * 2;
        const radius = Math.random() * (trackingNoisePx / 1920); // normalized coords noise
        const noiseX = Math.cos(randomAngle) * radius;
        const noiseY = Math.sin(randomAngle) * (radius * (1920 / 1080)); // aspect ratio account

        trackers[index].frames[f] = {
          x: Math.max(0, Math.min(1, proj.x + noiseX)),
          y: Math.max(0, Math.min(1, proj.y + noiseY)),
          active: true,
          correlation: 0.92 + Math.random() * 0.08,
          manual: false
        };
      } else {
        trackers[index].frames[f] = {
          x: proj.x,
          y: proj.y,
          active: false
        };
      }
    });
  }

  return { locators, cameras, trackers };
}

// Perform camera tracking solve sequence
// We generate a solved camera path with adjustable error based on how many parameters match.
// For a fully valid cinematic solver, if the user's lens calibration is off from physical distortion,
// the Solver Error (RMS or residual) will be very high (e.g. 2-5 pixels).
// If they adjust distortion mapping parameters to correct the lens distortion, the solve will converge to sub-pixel accuracy.
export function solveCamera(
  trackers: Tracker[],
  frameCount: number,
  selectedFocalLength: number,
  selectedSensorWidth: number,
  selectedSensorHeight: number,
  calibratedDistortion: LensDistortion,
  actualDistortion: LensDistortion, // physical camera distortion
  actualFocalLength: number,
  actualSensorWidth: number,
  actualSensorHeight: number,
  manualPointsCount: number = 0
): CameraSolveData {
  const solverFrames: { [frameIndex: number]: any } = {};
  
  // Compute focal/sensor discrepancies and distortion calibration error
  const fDiff = Math.abs(selectedFocalLength - actualFocalLength) / actualFocalLength;
  const sensorDiff = Math.abs(selectedSensorWidth - actualSensorWidth) / actualSensorWidth;
  
  // Distortion calibrate differences
  const k1Diff = Math.abs(calibratedDistortion.k1 - actualDistortion.k1);
  const k2Diff = Math.abs(calibratedDistortion.k2 - actualDistortion.k2);
  const p1Diff = Math.abs(calibratedDistortion.p1 - actualDistortion.p1);
  const p2Diff = Math.abs(calibratedDistortion.p2 - actualDistortion.p2);
  
  const totalCalibrationMismatch = k1Diff * 4.0 + k2Diff * 8.0 + p1Diff * 15.0 + p2Diff * 15.0 + fDiff * 2.0 + sensorDiff * 2.0;
  
  // Minimum count of tracked points across frames
  // Professional solvers need at least 8 overlapping points for a 3D solve
  let overEightCount = 0;
  for (let f = 0; f < frameCount; f++) {
    let activeInFrame = 0;
    trackers.forEach(t => {
      if (t.frames[f] && t.frames[f].active) activeInFrame++;
    });
    if (activeInFrame >= 8) overEightCount++;
  }
  
  // Compute final RMS projection error model
  // Base RMS error is around 0.15 pixels under perfect conditions
  let rmsError = 0.15 + (totalCalibrationMismatch * 8.5);
  
  // Solve state validation
  const overlapRatio = overEightCount / frameCount;
  if (overlapRatio < 0.5) {
    // Not enough markers
    rmsError += (1 - overlapRatio) * 12.0;
  }
  
  // Reduce error slightly with manual inputs (proportional tracker user edits)
  const manualBonus = Math.min(0.12, manualPointsCount * 0.015);
  rmsError = Math.max(0.08, rmsError - manualBonus);

  // Generate solved cameras
  // If calibration mismatch is high, the solved path will wobble from ground-truth
  const noiseScale = Math.min(1.5, totalCalibrationMismatch * 0.8);
  
  for (let f = 0; f < frameCount; f++) {
    const groundTruth = evaluateCameraTrajectory(f, frameCount);
    
    // Add path drift and wobbles based on noise scale
    const driftX = Math.sin(f / 10) * 0.1 * noiseScale + (Math.random() - 0.5) * 0.02 * noiseScale;
    const driftY = Math.cos(f / 12) * 0.08 * noiseScale + (Math.random() - 0.5) * 0.015 * noiseScale;
    const driftZ = Math.sin(f / 15) * 0.15 * noiseScale + (Math.random() - 0.5) * 0.02 * noiseScale;
    
    const rotDriftP = Math.cos(f / 8) * 0.8 * noiseScale + (Math.random() - 0.5) * 0.1 * noiseScale;
    const rotDrifY = Math.sin(f / 10) * 1.2 * noiseScale + (Math.random() - 0.5) * 0.15 * noiseScale;
    const rotDriftR = Math.sin(f / 14) * 0.3 * noiseScale;

    solverFrames[f] = {
      pos: [
        groundTruth.pos[0] + driftX,
        groundTruth.pos[1] + driftY,
        groundTruth.pos[2] + driftZ
      ],
      rot: [
        groundTruth.rot[0] + rotDriftP,
        groundTruth.rot[1] + rotDrifY,
        groundTruth.rot[2] + rotDriftR
      ],
      focalLength: selectedFocalLength
    };
  }

  // Populate solved 3D locations for trackers
  // Apply visual drift to Solved positions based on overall simulation accuracy
  const origLocators = generate3DLocators();
  trackers.forEach((t) => {
    const orig = origLocators.find(o => o.id === t.id);
    if (orig) {
      const driftMult = Math.min(2.0, totalCalibrationMismatch * 0.5);
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.15 * driftMult;
      
      t.solved3D = [
        orig.pos[0] + Math.cos(angle) * r,
        orig.pos[1] + (Math.random() - 0.5) * 0.1 * driftMult,
        orig.pos[2] + Math.sin(angle) * r
      ];
      t.rmsError = rmsError * (0.8 + Math.random() * 0.4);
    }
  });

  return {
    frames: solverFrames,
    rmsError: parseFloat(rmsError.toFixed(3)),
    solved: true
  };
}
