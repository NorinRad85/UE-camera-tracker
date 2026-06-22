# LensSync Pro: Unreal Engine Camera Tracking & Solving Tool

LensSync Pro is a highly polished, interactive camera tracking solver and integration utility suite designed specifically for Unreal Engine 5.7 virtual production, VFX, and post-production pipelines. It calibrates real-world lenses, matches radial distortions, auto/manually tracks visual targets, and spawns cameras and projection backplates in sync with the Unreal Editor active levels.

---

## Key Features

- **Robust 3D Camera Solver**: Triangulate camera poses and reconstruct focal paths from 2D locators with real-time sub-pixel RMS error analysis.
- **Advanced Focal & Sensor Calibration**: Interactive custom sensor size definitions (width and height in millimeters), focal overrides, and custom lens model distortion mappings (K1 symmetrical distortion grids).
- **Flexible Frame Rate & Frame Ranges**: 
  - Dynamic frame-rate controls supporting 23.976 (Film), 24 (PAL), 29.976 (NTSC), or 30 (Broadcast) FPS overrides.
  - Intelligent auto-detection of frame ranges and frame rates directly parsed from video and sequence path layouts.
  - Clip trimming configurations including frame-by-frame offset limits, head trimming, and segment isolates.
- **Active Level Spawning Ingress**: Configure Python scripting outputs to automatically instantiate actors (such as `CineCameraActor` and video projection backplates) directly into the Unreal Editor World Outliner or level sequencer workspace.
- **Zero-Latency In-Browser Simulator**: WebGL preview with an interactive 3D camera workspace, track curves, and synchronized logs.

---

## Local Web Application Setup

### 1. Prerequisites
Ensure you have the following installed on your machine:
- **Node.js** (Version 18.x or premium higher LTS version recommended)
- **NPM** (packaged standardly with Node.js)

### 2. Install Project Dependencies
Extract the workspace files and run the installer terminal script inside the root directory to populate standard modules and dependencies:
```bash
npm install
```

### 3. Spin Up Development Server
Execute the start script to boot the high-speed Vite server locally:
```bash
npm run dev
```
Once initialized, access the active live preview in your browser at:
`http://localhost:3000`

### 4. Code Quality & Formatting Check
Verify TypeScript type-safety and ensure there are no syntax anomalies:
```bash
npm run lint
```

### 5. Production Build Formulation
Compile and bundle optimal responsive web workspace files inside `/dist`:
```bash
npm run build
```

---

## Unreal Engine 5.7 Setup & Integration Manual

To sync solved camera files directly into your active Unreal Engine project level:

1. **Activate Python Plugin**: 
   - Open your project in Unreal Engine.
   - Go to **Edit > Plugins**.
   - Search for **Python Editor Script Plugin** and ensure it is enabled.
   - Restart the editor if prompted.

2. **Save Scripts**:
   - Inside the LensSync Pro interface, click **Download Unreal Python Integrator** to obtain the customized `.py` script.
   - Save or move this file into your Unreal project's directory path: `/Content/Python/import_tracker_data.py`.

3. **In-Editor Execution**:
   - Open the **Output Log** panel inside Unreal Engine (**Window > Output Log**).
   - Switch the command-line field selection dropdown from *Cmd* to **Python**.
   - Paste or enter the solver command string to bake curves and survey markers:
     ```python
     import import_tracker_data
     ```
   - Actors will automatically spawn with keys mapped according to your customized Level Ingress settings!

---

## File and Folder Structure

- `/src/App.tsx`: The primary single-view tracker orchestration dashboard, interactive canvas workspace, solve matrix pipelines, and simulation interface.
- `/src/components/`: Directory containing helper sub-components and modular views.
- `/src/index.css`: Global styles including custom fonts, slate-themed color palettes, and responsive grid setups.
- `/package.json`: System scripts, dev-server ports, and dependency listings.
- `/README.md`: This comprehensive overview and system manual.
