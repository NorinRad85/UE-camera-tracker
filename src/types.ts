export interface TrackerFrameData {
  x: number; // 0 to 1 normalized coordinates of point in image
  y: number; // 0 to 1 normalized coordinates of point in image
  active: boolean; // Is it tracked in this frame?
  correlation?: number; // Match confidence (0 - 1)
  manual?: boolean; // Was this manually placed/corrected on this frame?
}

export interface Tracker {
  id: string;
  name: string;
  color: string;
  frames: { [frameIndex: number]: TrackerFrameData };
  solved3D?: [number, number, number]; // [x, y, z] in world units
  rmsError?: number; // Reprojection error in pixels
  visible: boolean;
}

export interface CameraFrameSolve {
  pos: [number, number, number];  // Translation [x, y, z] (Unreal coordinates)
  rot: [number, number, number];  // Rotation [pitch, yaw, roll] (Unreal coordinates)
  focalLength: number;
}

export interface CameraSolveData {
  frames: { [frameIndex: number]: CameraFrameSolve };
  rmsError: number;
  solved: boolean;
}

export interface LensDistortion {
  k1: number; // Radial 1st order
  k2: number; // Radial 2nd order
  p1: number; // Tangential 1st order
  p2: number; // Tangential 2nd order
  scale: number; // Undistort sensor crop/stretch scale
}

export interface SensorPreset {
  name: string;
  width: number; // in mm
  height: number; // in mm
  cropFactor: number;
}

export interface FootageMedia {
  name: string;
  type: 'video' | 'sequence';
  fps: number;
  frameCount: number;
  width: number;
  height: number;
  url?: string;
}
