import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CameraSolveData, Tracker } from '../types';
import { generate3DLocators } from '../utils/motionSimulation';

interface ThreeDViewportProps {
  solveData: CameraSolveData;
  trackers: Tracker[];
  currentFrame: number;
}

export default function ThreeDViewport({ solveData, trackers, currentFrame }: ThreeDViewportProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const controlsRef = useRef<any>(null); // simple orbit state
  
  // Track visual objects for animation
  const cineCameraMeshRef = useRef<THREE.Group | null>(null);
  const frustumLinesRef = useRef<THREE.LineSegments | null>(null);
  const pathLineRef = useRef<THREE.Line | null>(null);
  const locatorsGroupRef = useRef<THREE.Group | null>(null);

  // Simple drag-to-orbit state variables
  const isDragging = useRef(false);
  const previousMousePosition = useRef({ x: 0, y: 0 });
  const cameraRot = useRef({ theta: Math.PI / 4, phi: Math.PI / 3 }); // spherical coordinates
  const cameraRadius = useRef(15);
  const cameraTarget = useRef(new THREE.Vector3(0, 0, 5));

  useEffect(() => {
    if (!mountRef.current) return;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#151515'); // flat workstation dark background
    sceneRef.current = scene;

    // Add ambient haze/fog/ambient depth
    scene.fog = new THREE.FogExp2('#151515', 0.015);

    // 2. Camera Setup
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight || 450;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    cameraRef.current = camera;

    // 3. Renderer Setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(10, 20, 10);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x0078D7, 0.5); // cyber blue secondary light
    dirLight2.position.set(-10, -5, -10);
    scene.add(dirLight2);

    // 5. Grid Helper
    const gridHelper = new THREE.GridHelper(40, 40, '#0078D7', '#333333');
    gridHelper.position.y = -1.5;
    scene.add(gridHelper);

    // Coordinate Axes representation (X = red, Y = green, Z = blue)
    const axesHelper = new THREE.AxesHelper(2);
    axesHelper.position.set(0, -1.49, 0);
    scene.add(axesHelper);

    // 6. Draw Spanned 3D Solved Tracking Markers
    const locatorsGroup = new THREE.Group();
    scene.add(locatorsGroup);
    locatorsGroupRef.current = locatorsGroup;

    // 7. Solve Path Tracing Line
    const pathGeometry = new THREE.BufferGeometry();
    const pathMaterial = new THREE.LineBasicMaterial({ color: '#fbbf24', linewidth: 2 }); // gold solved path
    const pathLine = new THREE.Line(pathGeometry, pathMaterial);
    scene.add(pathLine);
    pathLineRef.current = pathLine;

    // 8. Add Solved Cine Camera visual mesh (Yellow pyramid represent camera lens + body box)
    const cameraGroup = new THREE.Group();
    scene.add(cameraGroup);
    cineCameraMeshRef.current = cameraGroup;

    // Camera body box
    const bodyGeom = new THREE.BoxGeometry(0.8, 0.6, 1.0);
    const bodyMat = new THREE.MeshLambertMaterial({ color: '#e2e8f0' });
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    bodyMesh.position.z = 0.5; // shift backward
    cameraGroup.add(bodyMesh);

    // Camera Lens Cylinder
    const lensGeom = new THREE.CylinderGeometry(0.2, 0.25, 0.6, 12);
    const lensMat = new THREE.MeshLambertMaterial({ color: '#f59e0b' });
    const lensMesh = new THREE.Mesh(lensGeom, lensMat);
    lensMesh.rotation.x = Math.PI / 2; // face forward along -Z direction
    lensMesh.position.z = -0.3;
    cameraGroup.add(lensMesh);

    // Camera Top Handle
    const handleGeom = new THREE.BoxGeometry(0.12, 0.2, 0.7);
    const handleMesh = new THREE.Mesh(handleGeom, bodyMat);
    handleMesh.position.set(0, 0.4, 0.3);
    cameraGroup.add(handleMesh);

    // Lens Matte-Box / Frustum Outline
    // Represent a camera wireframe pyramid pointing into distance
    const frustumGeom = new THREE.BufferGeometry();
    const fCoords = new Float32Array([
      0, 0, 0,   -0.5,  0.35, -0.8,
      0, 0, 0,    0.5,  0.35, -0.8,
      0, 0, 0,   -0.5, -0.35, -0.8,
      0, 0, 0,    0.5, -0.35, -0.8,
      // Front flat face
      -0.5,  0.35, -0.8,   0.5,  0.35, -0.8,
       0.5,  0.35, -0.8,   0.5, -0.35, -0.8,
       0.5, -0.35, -0.8,  -0.5, -0.35, -0.8,
      -0.5, -0.35, -0.8,  -0.5,  0.35, -0.8,
    ]);
    frustumGeom.setAttribute('position', new THREE.BufferAttribute(fCoords, 3));
    const frustumMat = new THREE.LineBasicMaterial({ color: '#f59e0b' });
    const frustumLines = new THREE.LineSegments(frustumGeom, frustumMat);
    cameraGroup.add(frustumLines);
    frustumLinesRef.current = frustumLines;

    // 9. Interactive Manual Drag-to-Orbit Logic
    const handleMouseDown = (e: MouseEvent) => {
      isDragging.current = true;
      previousMousePosition.current = {
        x: e.clientX,
        y: e.clientY
      };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const deltaX = e.clientX - previousMousePosition.current.x;
      const deltaY = e.clientY - previousMousePosition.current.y;

      cameraRot.current.theta -= deltaX * 0.007;
      // limit polarization so camera doesn't flip upside down
      cameraRot.current.phi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraRot.current.phi - deltaY * 0.007));

      previousMousePosition.current = {
        x: e.clientX,
        y: e.clientY
      };
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      cameraRadius.current = Math.max(3, Math.min(45, cameraRadius.current + e.deltaY * 0.015));
    };

    const dom = renderer.domElement;
    dom.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    dom.addEventListener('wheel', handleWheel, { passive: false });

    // 10. Animation render loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Compute camera spatial orbit location
      const { theta, phi } = cameraRot.current;
      const radius = cameraRadius.current;

      const orbitalX = cameraTarget.current.x + radius * Math.sin(phi) * Math.sin(theta);
      const orbitalY = cameraTarget.current.y + radius * Math.cos(phi);
      const orbitalZ = cameraTarget.current.z + radius * Math.sin(phi) * Math.cos(theta);

      camera.position.set(orbitalX, orbitalY, orbitalZ);
      camera.lookAt(cameraTarget.current);

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mountRef.current || !renderer || !camera) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight || 450;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      dom.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      dom.removeEventListener('wheel', handleWheel);
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement && mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // Sync Camera and Locators once solveData / frame updates
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // 1. Update 3D Solved Trajectory Path Line
    const pathIndices = Object.keys(solveData.frames)
      .map(Number)
      .sort((a, b) => a - b);
    
    if (pathIndices.length > 0) {
      const vertices: number[] = [];
      pathIndices.forEach((f) => {
        const frameSolve = solveData.frames[f];
        if (frameSolve) {
          // coordinate mapping to match three world: [x, y, z] is perfect directly since simulation uses standard meters
          vertices.push(frameSolve.pos[0], frameSolve.pos[1], frameSolve.pos[2]);
        }
      });

      if (pathLineRef.current) {
        pathLineRef.current.geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(vertices, 3)
        );
        pathLineRef.current.geometry.computeBoundingSphere();
      }
    }

    // 2. Animate Camera position in actual frame
    const activeFrameSolve = solveData.frames[currentFrame];
    if (activeFrameSolve && cineCameraMeshRef.current) {
      const [cx, cy, cz] = activeFrameSolve.pos;
      const [pitch, yaw, roll] = activeFrameSolve.rot;

      cineCameraMeshRef.current.position.set(cx, cy, cz);
      
      // Convert Euler rotation to ThreeJS (Pitch around X, Yaw around Y, Roll around Z)
      cineCameraMeshRef.current.rotation.set(
        (pitch * Math.PI) / 180,
        (yaw * Math.PI) / 180,
        (roll * Math.PI) / 180,
        'YXZ' // match solver Euler order
      );

      // Slide cameraTarget to slightly float around camera position so orbit focus transitions beautifully
      cameraTarget.current.set(cx, cy - 0.5, cz - 3);
    }

    // 3. Render tracking markers in 3D group if solved
    if (locatorsGroupRef.current) {
      // Clear previous children
      while (locatorsGroupRef.current.children.length > 0) {
        const obj = locatorsGroupRef.current.children[0];
        locatorsGroupRef.current.remove(obj);
      }

      const activeLocators = generate3DLocators();

      trackers.forEach((t) => {
        // Find 3D coordinate (use solved if solved, else ground-truth to give accurate representation!)
        const locCoords = t.solved3D || activeLocators.find(o => o.id === t.id)?.pos;

        if (locCoords && t.visible) {
          // Draw tracking point as wireframe Cross locator to look technical and standard
          const itemGroup = new THREE.Group();
          itemGroup.position.set(locCoords[0], locCoords[1], locCoords[2]);

          const color = t.color || '#3b82f6';

          // A sphere at locator center
          const sphereGeo = new THREE.SphereGeometry(0.08, 8, 8);
          const sphereMat = new THREE.MeshBasicMaterial({ color: color });
          const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
          itemGroup.add(sphereMesh);

          // Render cross locators axes
          const lineGeom = new THREE.BufferGeometry();
          const vertices = new Float32Array([
            -0.2, 0, 0,  0.2, 0, 0,
            0, -0.2, 0,  0, 0.2, 0,
            0, 0, -0.2,  0, 0, 0.2
          ]);
          lineGeom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
          
          const lineMat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.7 });
          const crossLines = new THREE.LineSegments(lineGeom, lineMat);
          itemGroup.add(crossLines);

          locatorsGroupRef.current?.add(itemGroup);
        }
      });
    }
  }, [solveData, trackers, currentFrame]);

  return (
    <div className="relative w-full h-[32rem] rounded-sm overflow-hidden border border-[#3a3a3a] bg-[#151515] shadow-lg">
      <div className="absolute top-3 left-3 z-10 bg-[#111]/90 px-2 py-1 rounded-sm border border-[#3a3a3a] font-mono text-[10px] flex items-center space-x-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
        <span className="text-slate-300">SOLVER 3D WORLD SPACE VIEWPORT</span>
      </div>

      <div className="absolute top-3 right-3 z-10 flex space-x-1.5">
        <div className="bg-[#111]/90 px-2.5 py-1 rounded-sm border border-[#3a3a3a] font-mono text-[10px] text-slate-400 flex items-center space-x-1">
          <span className="text-yellow-400 font-bold font-mono">Drag</span> <span className="text-slate-500">to Pan/Orbit</span>
        </div>
        <div className="bg-[#111]/90 px-2.5 py-1 rounded-sm border border-[#3a3a3a] font-mono text-[10px] text-slate-400 flex items-center space-x-1">
          <span className="text-cyan-400 font-bold font-mono">Scroll</span> <span className="text-slate-500">to Zoom</span>
        </div>
      </div>

      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" id="threed_visualizer_canvas" />

      {/* Synchronized 3D frame overlay metadata footer */}
      <div className="absolute bottom-3 left-3 z-10 font-mono text-[10px] bg-[#111]/95 px-3 py-1.5 rounded-sm border border-[#3a3a3a] flex space-x-4 text-slate-400">
        <div>
          Cam Pos: <span className="text-slate-200 font-bold">
            {solveData.frames[currentFrame] 
              ? `${(solveData.frames[currentFrame].pos[0] * 100).toFixed(0)}, ${(solveData.frames[currentFrame].pos[1] * 100).toFixed(0)}, ${(solveData.frames[currentFrame].pos[2] * 100).toFixed(0)} cm`
              : 'N/A'
            }
          </span>
        </div>
        <div>
          Cam Rot (P,Y,R): <span className="text-slate-200 font-bold">
            {solveData.frames[currentFrame] 
              ? `${solveData.frames[currentFrame].rot[0].toFixed(1)}°, ${solveData.frames[currentFrame].rot[1].toFixed(1)}°, ${solveData.frames[currentFrame].rot[2].toFixed(1)}°`
              : 'N/A'
            }
          </span>
        </div>
        <div>
          Solver RMS: <span className={`${solveData.rmsError < 0.3 ? 'text-emerald-400' : solveData.rmsError < 1.0 ? 'text-amber-400' : 'text-rose-400'} font-bold`}>
            {solveData.rmsError.toFixed(2)} px
          </span>
        </div>
      </div>
    </div>
  );
}
