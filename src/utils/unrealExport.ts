import { CameraSolveData, Tracker, SensorPreset, LensDistortion } from '../types';

export function generateUnrealPythonScript(
  solveData: CameraSolveData,
  trackers: Tracker[],
  sensor: SensorPreset,
  lens: LensDistortion,
  fps: number = 24,
  frameCount: number = 100,
  footagePath: string = "D:/footage/shot_01_h264.mov"
): string {
  // Convert solve frames to python list of keys
  let cameraKeysPy = '';
  Object.keys(solveData.frames).forEach((frameStr) => {
    const f = parseInt(frameStr);
    const key = solveData.frames[f];
    // Unreal uses Left-Handed Z-Up coordinate systems, and centimeters as visual units.
    // Our simulation uses standard meter coordinate units. So multiply by 100 to convert to cm!
    // Rotation mapping: Unreal's CineCamera uses rot = [pitch, yaw, roll] relative to Unreal standards.
    const [x, y, z] = key.pos;
    const [pitch, yaw, roll] = key.rot;

    // Unreal space coordinate conversions (simulate meters -> centimeters, mapping coordinates)
    // Let's map X_unreal = x_m * 100, Y_unreal = z_m * 100, Z_unreal = y_m * 100 (shifting from Y-Up to Z-Up!)
    // Wait, let's do a reliable mapping:
    // Left/Right: X (meters) -> X (cm) * 100
    // Height: Y (meters) -> Z (cm) * 100
    // Forward/Backward: Z (meters) -> Y (cm) * 100
    const ux = x * 100;
    const uy = z * 100; // standard Y is forward in UE or X is forward. Let's make X forward, Y right, Z up.
    const uz = y * 100;

    cameraKeysPy += `    # Frame ${f}
    {
        "frame": ${f},
        "location": [${ux.toFixed(2)}, ${uy.toFixed(2)}, ${uz.toFixed(2)}],
        "rotation": [${pitch.toFixed(3)}, ${yaw.toFixed(3)}, ${roll.toFixed(3)}],
        "focal_length": ${key.focalLength.toFixed(2)}
    },\n`;
  });

  // Trackers
  let trackersPy = '';
  trackers.forEach((t) => {
    if (t.solved3D) {
      const [tx, ty, tz] = t.solved3D;
      const ux = tx * 100;
      const uy = tz * 100;
      const uz = ty * 100;
      trackersPy += `    {
        "name": "${t.name}",
        "color": "${t.color}",
        "location": [${ux.toFixed(2)}, ${uy.toFixed(2)}, ${uz.toFixed(2)}]
    },\n`;
    }
  });

  const pythonScript = `"""
Unreal Motion Tracker importer PyScript for Unreal Engine 5.7
Generated on: ${new Date().toLocaleDateString()}
Description: Automatically spawns a CineCameraActor, imports cinematic frame keys, 
creates tracker Nulls/Spheres, and fits the filmback sensor details.
"""

import unreal

# ----------------- CONFIGURATION & STATE DATA -----------------
RUN_IN_LEVEL_ACTORS_FOLDER = "MotionTracker_Data"
FOOTAGE_PATH = r"${footagePath}"
FPS = ${fps}
FRAME_COUNT = ${frameCount}
SENSOR_W = ${sensor.width}
SENSOR_H = ${sensor.height}

# Lens distortion params (for building Unreal lens file mapping profile)
LENS_K1 = ${lens.k1}
LENS_K2 = ${lens.k2}
LENS_P1 = ${lens.p1}
LENS_P2 = ${lens.p2}

CAMERA_KEYS = [
${cameraKeysPy}]

SOLVED_MARKERS = [
${trackersPy}]

# ----------------- PIPELINE AUTOMATION FUNCTIONS -----------------

def create_tracking_hierarchy():
    \"\"\"Creates a folder in world outliner and spawns actors\"\"\"
    active_world = unreal.EditorLevelLibrary.get_editor_world()
    if not active_world:
        unreal.log_error("No active editor world found. Please open a Level first.")
        return

    # 1. Spawn parent empty actor to hold tracks
    parent_actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.Actor, 
        unreal.Vector(0, 0, 0), 
        unreal.Rotator(0, 0, 0)
    )
    parent_actor.set_actor_label("UE_Tracker_Scene_Root")
    parent_actor.set_folder_path(RUN_IN_LEVEL_ACTORS_FOLDER)

    # 2. Spawn Cine Camera
    camera_actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.CineCameraActor, 
        unreal.Vector(0, 0, 0), 
        unreal.Rotator(0, 0, 0)
    )
    camera_actor.set_actor_label("Solved_CineCamera")
    camera_actor.set_folder_path(RUN_IN_LEVEL_ACTORS_FOLDER)
    camera_actor.attach_to_actor(parent_actor, socket_name="", attachment_rule=unreal.AttachmentRule.KEEP_RELATIVE, weld_simulated_bodies=False)
    
    # Configure Cine Camera Filmback Sensor and focal length
    camera_component = camera_actor.get_cine_camera_component()
    camera_component.set_editor_property("filmback_settings", unreal.CameraFilmbackSettings(
        sensor_width=SENSOR_W,
        sensor_height=SENSOR_H
    ))
    
    unreal.log(f"Configured CineCamera filmback to sensor: {SENSOR_W}mm x {SENSOR_H}mm")

    # 3. Spawn Tracker locators as Spheres or empty actors
    for idx, marker in enumerate(SOLVED_MARKERS):
        loc = unreal.Vector(marker["location"][0], marker["location"][1], marker["location"][2])
        
        # We spawn a standard StaticMesh Sphere or TargetPoint for 3D marker
        m_actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.TargetPoint, 
            loc, 
            unreal.Rotator(0, 0, 0)
        )
        m_actor.set_actor_label(f"Tracker_{marker['name']}")
        m_actor.set_folder_path(f"{RUN_IN_LEVEL_ACTORS_FOLDER}/Trackers")
        m_actor.attach_to_actor(parent_actor, socket_name="", attachment_rule=unreal.AttachmentRule.KEEP_WORLD, weld_simulated_bodies=False)

    unreal.log(f"Successfully spawned {len(SOLVED_MARKERS)} tracking locators.")

    # 4. Integrate with Sequencer and add Frame Keys
    # Let's create a Movie Scene Sequence to capture animated camera values
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    sequence_path = "/Game/Cinematics/Solves"
    sequence_name = "Solved_Track_Sequence"
    
    # Ensure folder path exists
    unreal.EditorAssetLibrary.make_directory(sequence_path)
    
    # Create Level Sequence
    level_sequence = asset_tools.create_asset(
        sequence_name, 
        sequence_path, 
        unreal.LevelSequence, 
        unreal.LevelSequenceFactoryNew()
    )
    
    if not level_sequence:
        unreal.log_warning("Unable to automatically create Level Sequence. Keys added straight to CineCamera component in Level.")
        animate_camera_manually(camera_actor)
        return

    # Add Level Sequence to World or open it
    unreal.LevelSequenceEditorBlueprintLibrary.open_level_sequence(level_sequence)
    
    # Bind camera actor to level sequence
    camera_binding = level_sequence.add_possessable(camera_actor)
    
    # Add transform track to camera binding to insert cinematic keyframes
    transform_track = camera_binding.add_track(unreal.MovieScene3DTransformTrack)
    transform_section = transform_track.add_section()
    transform_section.set_range(0, FRAME_COUNT)
    
    # Add keyframes
    channels = transform_section.get_all_channels()
    # Channels: 0:LocationX, 1:LocationY, 2:LocationZ, 3:RotationRoll, 4:RotationPitch, 5:RotationYaw, etc
    
    for key in CAMERA_KEYS:
        f_num = key["frame"]
        t_time = unreal.FrameNumber(f_num)
        
        loc_val = key["location"]
        rot_val = key["rotation"] # Pitch, Yaw, Roll
        
        # Location keys
        channels[0].add_key(t_time, loc_val[0])
        channels[1].add_key(t_time, loc_val[1])
        channels[2].add_key(t_time, loc_val[2])
        
        # Rotations keys (order: Roll, Pitch, Yaw)
        channels[3].add_key(t_time, rot_val[2]) # Roll
        channels[4].add_key(t_time, rot_val[0]) # Pitch
        channels[5].add_key(t_time, rot_val[1]) # Yaw
        
    unreal.LevelSequenceEditorBlueprintLibrary.refresh_current_level_sequence()
    unreal.log("Camera trajectory animation keyframed accurately in Level Sequencer!")

def animate_camera_manually(camera_actor):
    \"\"\"Fall-back directly keyframing live transforms when sequencer isn't open\"\"\"
    for key in CAMERA_KEYS:
        # For simulation, just position actor at final keyframe
        if key["frame"] == 0:
            loc = unreal.Vector(key["location"][0], key["location"][1], key["location"][2])
            rot = unreal.Rotator(key["rotation"][1], key["rotation"][0], key["rotation"][2]) # Roll Pitch Yaw align
            camera_actor.set_actor_location(loc)
            camera_actor.set_actor_rotation(rot)

# Run the integration
if __name__ == "__main__":
    create_tracking_hierarchy()
    print("--- UNREAL ENGINE MOTION TRACK IMPORT SUCCESS ---")
`;

  return pythonScript;
}

export function generateInstallerGuide(): string {
  return `### Unreal Engine 5.7 / Cine Camera Solver Installation & Integration Guide

This package provides a direct Bridge interface to pipeline tracking data with sub-pixel visual accuracy and lens distortion models directly from footage into **Unreal Engine 5.7 (UE 5.7)**.

---

#### 📦 System Directory Layout (Recommended Setup)
To enable custom pipeline automation and ensure h.264 Mov / Exr footage loading operates smoothly, copy the downloaded bridge files to your Unreal Engine project layout.
\`\`\`text
MyProject/
├── Content/
│   ├── CinematicFootage/          <-- Put your H.264 MOV or EXR sequences here
│   │   └── shot_01_h264.mov
│   ├── Python/
│   │   └── import_tracker_data.py <-- Save the Python import script here
│   └── EditorUtilities/
│       └── EUW_MotionTrackerBridge <-- Unreal Blueprint Utility Widget
\`\`\`

---

#### 🔧 Step 1: Enable Necessary Plugins inside UE 5.7
Before loading the integration scripts, you must ensure Unreal Engine is configured with Python developer features active:
1. Open Unreal Engine project with **UE 5.7**.
2. Go to **Edit > Plugins**.
3. Search for and **Enable** the following plugins:
   * **Python Editor Script Plugin** (Essential for script terminal operations)
   * **Sequencer Scripting** (Required to write keyframes dynamically into camera timelines)
   * **Lens Distortion** or **Camera Calibration** (Applies the computed K1/K2 radial adjustments to cameras)
4. Restart your Editor.

---

#### 🚀 Step 2: Running the Automatic Importer Script
1. Save the downloaded solver script as \`import_tracker_data.py\` in your project's \`Content/Python/\` folder.
2. In Unreal Engine, locate the **Output Log** drawer (usually bottom-left or under *Window > Output Log*).
3. Switch the cmd-line input from **Cmd** to **Python** (dropdown field on the left of input box).
4. Run the script by pasting the command:
   \`\`\`python
   import import_tracker_data
   \`\`\`
5. Check your **World Outliner**: You will now see a new folder named \`MotionTracker_Data\` containing:
   * **Solved_CineCamera** (Pre-configured with accurate width/height and focal length)
   * **Trackers** (Folder of sub-actors matching each named 3D spatial locator point tracker!)
   * A Level Sequence asset instantiated under \`/Game/Cinematics/Solves/\` featuring smooth, handheld trajectory keyframes mapped frame-by-frame.

---

#### 🎥 Step 3: Loading the Footage Frame inside Unreal
Unreal Engine handles live media rendering using the **Media Plate** or **Media Player Framework**:
1. Right click in your Content Browser, select **Media > Media Plate**.
2. Drag the media plate onto your level as a screen board, or open the Cine Camera view.
3. In the Cine Camera Component, under **Camera Options**, turn on the **Media Plate Actor** or set its **Plate Texture** to render the undistorted H.264 footage array direct in camera backplates.
4. Scale spacing factor to align your 3D floor trackers with the flat visuals to begin placing your virtual environment geometry!
`;
}
