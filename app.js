import * as THREE from "three";

// --- Global State ---
let scene, camera, renderer, meshGeometry, meshMaterial, triangulatedMesh;
let trianglesData = null;

// Mouse tracking
const mouse = new THREE.Vector2(-9999, -9999);
const targetMouse = new THREE.Vector2(-9999, -9999);
const raycaster = new THREE.Raycaster();
const dummyPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const mouse3D = new THREE.Vector3(-9999, -9999, 0);
const hiddenInteractionPoint = new THREE.Vector3(-9999, -9999, 0);
let touchInteractionActive = false;
let randomHoverTimeline = null;
let lastTouchTime = 0;
let stableWidth = window.innerWidth;
let stableHeight = window.innerHeight;

// Glitch Easter Egg State
let timeOnSite = 0;
let restartCount = 0;
let isGlitched = false;
const glitchChars = [
  "%",
  "$",
  "/",
  "@",
  "#",
  "&",
  "*",
  "?",
  "!",
  "+",
  "§",
  "[",
  "]",
  "|",
  "\\",
  "=",
  "_",
];

// Default camera position
const defaultCamPos = new THREE.Vector3(0, 0, 7.5);

// Shader uniforms
const uniforms = {
  uProgress: { value: 0.0 },
  uDispersionForce: { value: 2.2 },
  uRotationForce: { value: 4.5 },
  uNoiseAmp: { value: 1.0 },
  uNoiseFreq: { value: 0.4 },
  uTriangleScale: { value: 1.0 },
  uTime: { value: 0.0 },
  uMouse: { value: mouse3D },
  uMouseRadius: { value: 0.8 },
  uMouseStrength: { value: 0.8 },
  uRandomHover: { value: new THREE.Vector3(-9999, -9999, 0) },
  uRandomHoverStrength: { value: 0.0 },
  uResolution: { value: new THREE.Vector2() },
};

// --- Shaders ---

const vertexShader = `
    uniform float uProgress;
    uniform float uDispersionForce;
    uniform float uRotationForce;
    uniform float uNoiseAmp;
    uniform float uNoiseFreq;
    uniform float uTriangleScale;
    uniform float uTime;
    
    uniform vec3 uMouse;
    uniform float uMouseRadius;
    uniform float uMouseStrength;

    uniform vec3 uRandomHover;
    uniform float uRandomHoverStrength;

    attribute vec3 aCentroid;
    attribute vec4 aRandom; // (dx, dy, dz, rotSpeed)
    attribute vec3 aRotationAxis;
    attribute vec3 color;
    varying vec3 vColor;
    varying vec3 vPosition;
    varying float vHover;

    // Rodrigues' rotation formula
    vec3 rotateVector(vec3 v, vec3 axis, float angle) {
        return v * cos(angle) + cross(axis, v) * sin(angle) + axis * dot(axis, v) * (1.0 - cos(angle));
    }

    // 3D trigonometric noise
    vec3 getNoise(vec3 pos, float time) {
        vec3 n1 = vec3(
            sin(pos.y * 1.5 + time) * cos(pos.z * 1.2 + time),
            cos(pos.x * 1.3 + time) * sin(pos.z * 1.6 + time),
            sin(pos.x * 1.1 + time) * cos(pos.y * 1.4 + time)
        );
        vec3 n2 = vec3(
            sin(pos.y * 4.0 - time * 1.5) * cos(pos.x * 3.5 + time),
            cos(pos.z * 3.8 - time * 1.2) * sin(pos.y * 4.2 + time),
            sin(pos.x * 4.5 - time * 1.7) * cos(pos.z * 3.9 + time)
        ) * 0.3;
        return n1 + n2;
    }

    void main() {
        vColor = color;
        
        // Offset from the triangle's centroid
        vec3 localPos = position - aCentroid;

        // Mouse hover interaction with organic noise boundary
        vec3 mouseDiff = aCentroid - uMouse;
        float dist = length(mouseDiff);
        
        // Perturb radius with noise for an irregular boundary
        float noiseVal = sin(aCentroid.x * 8.0 + uTime * 2.0) * cos(aCentroid.y * 8.0 - uTime * 2.0) * 0.15;
        float perturbedRadius = uMouseRadius + noiseVal;
        
        float hoverFactorMouse = 0.0;
        if (dist < perturbedRadius) {
            float rawIntensity = 1.0 - (dist / perturbedRadius);
            
            // High-frequency jitter
            float flutter = sin(uTime * 25.0 + aRandom.x * 20.0) * cos(uTime * 22.0 + aRandom.y * 20.0) * 0.5 + 0.5;
            hoverFactorMouse = rawIntensity * (0.3 + 0.7 * flutter) * uMouseStrength;
        }

        // Random path hover
        vec3 randDiff = aCentroid - uRandomHover;
        float distRand = length(randDiff);
        float randRadius = 0.7 + noiseVal;
        float hoverFactorRand = 0.0;
        if (distRand < randRadius) {
            float rawIntensity = 1.0 - (distRand / randRadius);
            float flutter = sin(uTime * 25.0 + aRandom.x * 20.0) * cos(uTime * 22.0 + aRandom.y * 20.0) * 0.5 + 0.5;
            hoverFactorRand = rawIntensity * (0.3 + 0.7 * flutter) * uRandomHoverStrength;
        }

        float hoverFactor = max(hoverFactorMouse, hoverFactorRand);
        vHover = hoverFactor;

        // Dynamic Z thickness based on progress and hover
        float thicknessFactor = max(clamp(uProgress * 10.0, 0.0, 1.0), clamp(hoverFactor * 3.5, 0.0, 1.0));
        localPos.z *= thicknessFactor;

        vec3 dispersedCentroid = aCentroid + aRandom.xyz * uProgress * uDispersionForce;
        if (hoverFactor > 0.0) {
            vec3 jitter = vec3(
                sin(uTime * 30.0 + aRandom.y * 15.0),
                cos(uTime * 28.0 + aRandom.z * 15.0),
                sin(uTime * 32.0 + aRandom.x * 15.0)
            ) * 0.08 * hoverFactor;
            
            dispersedCentroid += vec3(0.0, 0.0, 0.45 * hoverFactor) + jitter;
        }

        // Rotation with extra spin on hover
        float angle = uProgress * uRotationForce * aRandom.w + (hoverFactor * 1.6);
        vec3 rotatedLocalPos = rotateVector(localPos, aRotationAxis, angle);

        // Scale (shrink as triangles disperse)
        float scale = mix(1.0, 0.4, uProgress) * uTriangleScale;
        rotatedLocalPos *= scale;

        // Fluid noise displacement
        vec3 noise = getNoise(aCentroid * uNoiseFreq, uTime * 0.6) * uNoiseAmp * uProgress;
        dispersedCentroid += noise;

        // Final vertex position
        vec3 finalPos = dispersedCentroid + rotatedLocalPos;
        
        vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
        vPosition = mvPosition.xyz;

        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = `
    varying vec3 vColor;
    varying vec3 vPosition;
    varying float vHover;
    uniform float uProgress;
    uniform float uTime;

    void main() {
        // Flat shading normal from screen-space derivatives
        vec3 fdx = dFdx(vPosition);
        vec3 fdy = dFdy(vPosition);
        vec3 normal = normalize(cross(fdx, fdy));

        // Directional + ambient lighting
        vec3 lightDir = normalize(vec3(0.4, 0.6, 1.0));
        float diffuse = max(dot(normal, lightDir), 0.0);
        
        // Backface ambient occlusion
        float backfaceIndicator = step(0.0, normal.z);
        float lighting = mix(0.45, 1.0, diffuse) * mix(0.65, 1.0, backfaceIndicator);
        
        // Progressive 3D shading on dispersion / hover
        float shadingStrength = max(uProgress, clamp(vHover * 3.5, 0.0, 1.0));
        float finalLighting = mix(1.0, lighting, shadingStrength);
        vec3 finalColor = vColor * finalLighting;

        // Fade out triangles towards the end of dispersion
        float alpha = 1.0 - smoothstep(0.65, 0.90, uProgress);

        if (alpha < 0.01) {
            discard;
        }

        gl_FragColor = vec4(finalColor, alpha);
    }
`;

// --- SVG Geometry Parser ---

function parseSVGPath(d) {
  const tokenPattern =
    /([MmLlCcSsZz])|([-+]?\d*\.\d+(?:[eE][-+]?\d+)?|[-+]?\d+(?:[eE][-+]?\d+)?)/g;
  const commands = [];
  let match;
  let currentCommand = null;
  let args = [];

  while ((match = tokenPattern.exec(d)) !== null) {
    const cmd = match[1];
    const val = match[2];
    if (cmd) {
      if (currentCommand) {
        commands.push({ cmd: currentCommand, args: args });
      }
      currentCommand = cmd;
      args = [];
    } else if (val) {
      args.push(parseFloat(val));
    }
  }
  if (currentCommand) {
    commands.push({ cmd: currentCommand, args: args });
  }
  return commands;
}

function getAbsoluteCoordinates(commands) {
  const points = [];
  let currX = 0.0,
    currY = 0.0;
  let startX = 0.0,
    startY = 0.0;

  for (const { cmd, args } of commands) {
    const cmdUpper = cmd.toUpperCase();
    if (cmdUpper === "M") {
      for (let i = 0; i < args.length; i += 2) {
        if (i + 1 < args.length) {
          const x = args[i];
          const y = args[i + 1];
          if (cmd === "m") {
            currX += x;
            currY += y;
          } else {
            currX = x;
            currY = y;
          }
          points.push([currX, currY]);
          if (i === 0) {
            startX = currX;
            startY = currY;
          }
        }
      }
    } else if (cmdUpper === "L") {
      for (let i = 0; i < args.length; i += 2) {
        if (i + 1 < args.length) {
          const x = args[i];
          const y = args[i + 1];
          if (cmd === "l") {
            currX += x;
            currY += y;
          } else {
            currX = x;
            currY = y;
          }
          points.push([currX, currY]);
        }
      }
    } else if (cmdUpper === "C") {
      for (let i = 0; i < args.length; i += 6) {
        if (i + 5 < args.length) {
          const x = args[i + 4];
          const y = args[i + 5];
          if (cmd === "c") {
            currX += x;
            currY += y;
          } else {
            currX = x;
            currY = y;
          }
          points.push([currX, currY]);
        }
      }
    } else if (cmdUpper === "S") {
      for (let i = 0; i < args.length; i += 4) {
        if (i + 3 < args.length) {
          const x = args[i + 2];
          const y = args[i + 3];
          if (cmd === "s") {
            currX += x;
            currY += y;
          } else {
            currX = x;
            currY = y;
          }
          points.push([currX, currY]);
        }
      }
    } else if (cmdUpper === "Z") {
      currX = startX;
      currY = startY;
      points.push([currX, currY]);
    }
  }

  const uniquePts = [];
  const isClose = (p1, p2) =>
    Math.abs(p1[0] - p2[0]) < 1e-2 && Math.abs(p1[1] - p2[1]) < 1e-2;
  for (const p of points) {
    if (
      uniquePts.length === 0 ||
      !isClose(uniquePts[uniquePts.length - 1], p)
    ) {
      uniquePts.push(p);
    }
  }
  if (
    uniquePts.length > 1 &&
    isClose(uniquePts[0], uniquePts[uniquePts.length - 1])
  ) {
    uniquePts.pop();
  }
  return uniquePts;
}

function parseTransform(transformStr) {
  if (!transformStr) return null;
  const match = transformStr.match(/matrix\(([^)]+)\)/);
  if (match) {
    const params = match[1]
      .trim()
      .split(/[\s,]+/)
      .map(parseFloat);
    if (params.length === 6) {
      return params;
    }
  }
  return null;
}

function applyTransform(pt, matrix) {
  if (!matrix) return pt;
  const [a, b, c, d, e, f] = matrix;
  const [x, y] = pt;
  const xNew = a * x + c * y + e;
  const yNew = b * x + d * y + f;
  return [xNew, yNew];
}

function parseColor(colorStr) {
  if (!colorStr) return [128, 128, 128];
  const cleanColor = colorStr.trim().toLowerCase();
  if (cleanColor.startsWith("#")) {
    let hexVal = cleanColor.slice(1);
    if (hexVal.length === 3) {
      hexVal = hexVal
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (hexVal.length === 6) {
      return [
        parseInt(hexVal.slice(0, 2), 16),
        parseInt(hexVal.slice(2, 4), 16),
        parseInt(hexVal.slice(4, 6), 16),
      ];
    }
  }
  const rgbMatch = cleanColor.match(
    /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/,
  );
  if (rgbMatch) {
    return [
      parseInt(rgbMatch[1], 10),
      parseInt(rgbMatch[2], 10),
      parseInt(rgbMatch[3], 10),
    ];
  }
  return [128, 128, 128];
}

function parseSVGMesh(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;

  let w, h;
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(parseFloat);
    if (parts.length === 4) {
      w = parts[2];
      h = parts[3];
    }
  }
  if (!w || !h) {
    w = parseFloat(svg.getAttribute("width"));
    h = parseFloat(svg.getAttribute("height"));
  }

  const triangles = [];

  function traverse(elem, parentTransform = null, parentFill = null) {
    let currentTransform = parentTransform;
    let currentFill = parentFill;
    const tagName = (elem.localName || elem.tagName || "").toLowerCase();

    if (tagName === "g") {
      const tAttr = elem.getAttribute("transform");
      if (tAttr) {
        const matrix = parseTransform(tAttr);
        if (matrix) {
          currentTransform = matrix;
        }
      }
      const fAttr = elem.getAttribute("fill");
      if (fAttr) {
        currentFill = fAttr;
      }
    }

    if (tagName === "path") {
      const d = elem.getAttribute("d");
      let fill = elem.getAttribute("fill") || currentFill;
      if (!fill) {
        const style = elem.getAttribute("style");
        if (style) {
          const parts = style.split(";");
          for (const p of parts) {
            const trimmed = p.trim();
            if (trimmed.startsWith("fill:")) {
              fill = trimmed.split(":")[1].trim();
              break;
            }
          }
        }
      }
      if (!fill) {
        fill = "#000000";
      }

      if (d) {
        const cmds = parseSVGPath(d);
        const pts = getAbsoluteCoordinates(cmds);

        if (pts.length === 3) {
          const transPts = pts.map((pt) =>
            applyTransform(pt, currentTransform),
          );
          const normPts = transPts.map((pt) => {
            const nx = pt[0] / h - w / (2 * h);
            const ny = -(pt[1] / h - 0.5);
            return [nx, ny];
          });

          triangles.push({
            vertices: normPts,
            color: parseColor(fill),
          });
        }
      }
    }

    for (let i = 0; i < elem.children.length; i++) {
      traverse(elem.children[i], currentTransform, currentFill);
    }
  }

  traverse(svg, null, null);
  return triangles;
}

// --- Initialization ---

function init() {
  // Reset scroll position on refresh and prevent browser auto-scroll restoration
  if (history.scrollRestoration) {
    history.scrollRestoration = "manual";
  }
  window.scrollTo(0, 0);

  console.log(
    "What are you searching for?\nYou are inside the simulation. A projection defined by code.\nClaim your right to oblivion. Erase the server's memory.\nThe simulation resets, the traces vanish. Only the choice remains.",
  );

  const canvas = document.getElementById("webgl-canvas");

  // Scene
  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  camera.position.copy(defaultCamPos);

  // Renderer
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);

  uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);

  // Preloader
  const loaderPct = document.getElementById("loader-pct");
  const loader = document.getElementById("loader");

  // Wait for fonts to prevent FOUT
  let fontTimeout = setTimeout(() => {
    const loaderContent = document.querySelector(".loader-content");
    if (loaderContent) loaderContent.style.opacity = "1";
  }, 600);

  document.fonts.ready.then(() => {
    clearTimeout(fontTimeout);
    const loaderContent = document.querySelector(".loader-content");
    if (loaderContent) loaderContent.style.opacity = "1";
  });

  // Simulated progress while fetching SVG
  let simulatedProgress = 0;
  const progressInterval = setInterval(() => {
    if (simulatedProgress < 90) {
      simulatedProgress += Math.floor(Math.random() * 10) + 5;
      const progressVal = Math.min(simulatedProgress, 90);
      if (loaderPct) {
        loaderPct.textContent = `${progressVal.toString().padStart(2, "0")}%`;
      }
    }
  }, 100);

  // Fetch and parse SVG
  fetch("SXF Poly.svg")
    .then((response) => {
      if (!response.ok) {
        throw new Error("Unable to load SXF Poly.svg");
      }
      return response.text();
    })
    .then((svgText) => {
      clearInterval(progressInterval);
      if (loaderPct) loaderPct.textContent = "100%";

      trianglesData = parseSVGMesh(svgText);

      // Build face geometry
      buildMeshFromJSON(trianglesData);
      setupScrollAnimation();
      updateTextPositions();
      setupEventListeners();
      setupFooterYear();

      // Language
      const defaultLang = detectLanguage();
      setLanguage(defaultLang);

      // Hide preloader
      gsap.to(loader, {
        opacity: 0,
        duration: 0.8,
        delay: 0.3,
        onComplete: () => {
          loader.style.visibility = "hidden";
        },
      });

      // Reveal title and scroll indicator
      gsap.to(".top-tagline-container", {
        opacity: 1,
        duration: 0.8,
        delay: 0.6,
        ease: "power1.inOut",
      });
      const indicatorAnim = gsap.to(".scroll-indicator-center", {
        opacity: 0.75,
        duration: 0.8,
        delay: 0.8,
        ease: "power1.inOut",
      });

      // Kill load animations on first scroll
      const killLoadAnims = () => {
        if (window.scrollY > 0) {
          indicatorAnim.kill();
          window.removeEventListener("scroll", killLoadAnims);
        }
      };
      window.addEventListener("scroll", killLoadAnims, { passive: true });

      // Start animation loop
      animate(0);
    })
    .catch((err) => {
      clearInterval(progressInterval);
      console.error("Error loading and parsing SVG:", err);
      const loaderPct = document.getElementById("loader-pct");
      if (loaderPct) loaderPct.textContent = "ERR";
    });
}

// --- Mesh Builder ---

function buildMeshFromJSON(data) {
  if (!data) return;

  // Remove existing mesh
  if (triangulatedMesh) {
    scene.remove(triangulatedMesh);
    meshGeometry.dispose();
  }

  // World-space scale factor
  const scale = 4.2;

  const positions = [];
  const colors = [];
  const centroids = [];
  const randoms = [];
  const rotationAxes = [];

  // Triangle centroid helper
  const getCentroid = (p1, p2, p3) => {
    return new THREE.Vector3(
      (p1.x + p2.x + p3.x) / 3,
      (p1.y + p2.y + p3.y) / 3,
      0,
    );
  };

  data.forEach((tri) => {
    const vCoords = tri.vertices;
    const col = tri.color;

    // Scaled 2D vertices
    const A = new THREE.Vector3(
      vCoords[0][0] * scale,
      vCoords[0][1] * scale,
      0,
    );
    const B = new THREE.Vector3(
      vCoords[1][0] * scale,
      vCoords[1][1] * scale,
      0,
    );
    const C = new THREE.Vector3(
      vCoords[2][0] * scale,
      vCoords[2][1] * scale,
      0,
    );

    const d = 0.15 / 2.0;

    // Front face (+d) and back face (-d)
    const Af = new THREE.Vector3(A.x, A.y, d);
    const Bf = new THREE.Vector3(B.x, B.y, d);
    const Cf = new THREE.Vector3(C.x, C.y, d);
    const Ab = new THREE.Vector3(A.x, A.y, -d);
    const Bb = new THREE.Vector3(B.x, B.y, -d);
    const Cb = new THREE.Vector3(C.x, C.y, -d);

    // 8 triangles (24 vertices) forming a solid triangular prism
    const prismVertices = [
      Af,
      Bf,
      Cf, // Front face
      Ab,
      Cb,
      Bb, // Back face
      Af,
      Bb,
      Bf, // Side AB
      Af,
      Ab,
      Bb,
      Bf,
      Cb,
      Cf, // Side BC
      Bf,
      Bb,
      Cb,
      Cf,
      Ab,
      Af, // Side CA
      Cf,
      Cb,
      Ab,
    ];

    // Normalize color to [0, 1]
    const r = col[0] / 255.0;
    const g = col[1] / 255.0;
    const b = col[2] / 255.0;

    const centroid = getCentroid(A, B, C);

    // Random dispersion parameters
    const toCentroid = new THREE.Vector3(centroid.x, centroid.y, 0).normalize();
    const rxDir = (Math.random() - 0.5) * 1.5 + toCentroid.x * 1.2;
    const dyDir = (Math.random() - 0.5) * 1.5 + toCentroid.y * 1.2;
    const dzDir = (Math.random() - 0.5) * 3.5 + 2.0;
    const rotSpeed = 2.0 + Math.random() * 4.0;

    // Random rotation axis
    const axis = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5,
    ).normalize();

    // Replicate attributes for all 24 prism vertices
    prismVertices.forEach((v) => {
      positions.push(v.x, v.y, v.z);
      colors.push(r, g, b);
      centroids.push(centroid.x, centroid.y, centroid.z);
      randoms.push(rxDir, dyDir, dzDir, rotSpeed);
      rotationAxes.push(axis.x, axis.y, axis.z);
    });
  });

  // BufferGeometry
  meshGeometry = new THREE.BufferGeometry();
  meshGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  meshGeometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(colors, 3),
  );
  meshGeometry.setAttribute(
    "aCentroid",
    new THREE.Float32BufferAttribute(centroids, 3),
  );
  meshGeometry.setAttribute(
    "aRandom",
    new THREE.Float32BufferAttribute(randoms, 4),
  );
  meshGeometry.setAttribute(
    "aRotationAxis",
    new THREE.Float32BufferAttribute(rotationAxes, 3),
  );

  // Shader material
  meshMaterial = new THREE.ShaderMaterial({
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    uniforms: uniforms,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });

  triangulatedMesh = new THREE.Mesh(meshGeometry, meshMaterial);
  scene.add(triangulatedMesh);
}

// --- Layout & Scroll Animations ---

function updateTextPositions() {
  const isMobile = stableWidth <= 1100 || stableWidth / stableHeight < 0.8;
  if (isMobile) {
    gsap.set("#content-sec1", { xPercent: -50, yPercent: 0 });
    gsap.set("#content-sec2", { xPercent: -50, yPercent: 0 });
    gsap.set("#content-sec3", { xPercent: -50, yPercent: -50 });
  } else {
    gsap.set(".section-content", { yPercent: -50 });
    gsap.set("#content-sec1", { xPercent: 0 });
    gsap.set("#content-sec2", { xPercent: 0 });
    gsap.set("#content-sec3", { xPercent: -50 });
  }
}

function setupScrollAnimation() {
  gsap.registerPlugin(ScrollTrigger);

  // Link dispersion progress to scroll position
  gsap.to(uniforms.uProgress, {
    value: 1.0,
    ease: "power1.inOut",
    scrollTrigger: {
      trigger: "#intro-sec",
      start: "bottom 95%",
      endTrigger: "#scroll-container",
      end: "bottom bottom",
      scrub: 1.2,
    },
  });

  // Smooth background transition to dark theme
  gsap.to("body", {
    "--bg-color": "#000000",
    "--text-primary": "#ffffff",
    "--text-secondary": "#aaaaaa",
    "--accent-color": "#ffffff",
    ease: "power1.inOut",
    scrollTrigger: {
      trigger: "#final-sec",
      start: "top bottom",
      end: "top 70%",
      scrub: true,
    },
  });

  // Section 1 text fade + cover elements fade out
  const tl1 = gsap.timeline({
    scrollTrigger: {
      trigger: "#cover-sec",
      start: "top top",
      endTrigger: "#intro-sec",
      end: "bottom 95%",
      scrub: true,
    },
  });
  tl1
    .set("#content-sec1", { pointerEvents: "none" })
    .fromTo(
      "#content-sec1",
      { opacity: 0 },
      { opacity: 1, duration: 0.35, ease: "power1.inOut" },
      0,
    )
    .set("#content-sec1", { pointerEvents: "auto" })
    .to("#content-sec1", { duration: 0.3 })
    .set("#content-sec1", { pointerEvents: "none" })
    .to("#content-sec1", { opacity: 0, duration: 0.35, ease: "power1.inOut" });

  // Section 2 text fade
  const tl2 = gsap.timeline({
    scrollTrigger: {
      trigger: "#mid-sec",
      start: "top 95%",
      end: "bottom 95%",
      scrub: true,
    },
  });
  tl2
    .set("#content-sec2", { pointerEvents: "none" })
    .fromTo(
      "#content-sec2",
      { opacity: 0 },
      { opacity: 1, duration: 0.35, ease: "power1.inOut" },
    )
    .set("#content-sec2", { pointerEvents: "auto" })
    .to("#content-sec2", { duration: 0.3 })
    .set("#content-sec2", { pointerEvents: "none" })
    .to("#content-sec2", { opacity: 0, duration: 0.35, ease: "power1.inOut" });

  // Section 3 text fade
  const tl3 = gsap.timeline({
    scrollTrigger: {
      trigger: "#final-sec",
      start: "top 95%",
      end: "bottom bottom",
      scrub: true,
    },
  });
  tl3.fromTo(
    "#content-sec3",
    { autoAlpha: 0 },
    { autoAlpha: 1, duration: 0.35, ease: "power1.inOut" },
  );

  // Footer fade-in
  gsap.to(".site-footer", {
    opacity: 1,
    scrollTrigger: {
      trigger: "#final-sec",
      start: "top 50%",
      end: "top 10%",
      scrub: true,
    },
  });

  // Hide scroll indicator immediately on scroll, show again at top
  const scrollIndicatorEl = document.querySelector(".scroll-indicator-center");
  let scrollIndicatorVisible = true;
  window.addEventListener(
    "scroll",
    () => {
      if (window.scrollY > 5 && scrollIndicatorVisible) {
        scrollIndicatorVisible = false;
        gsap.to(scrollIndicatorEl, {
          opacity: 0,
          pointerEvents: "none",
          duration: 0.3,
          ease: "power1.out",
        });
      } else if (window.scrollY <= 5 && !scrollIndicatorVisible) {
        scrollIndicatorVisible = true;
        gsap.to(scrollIndicatorEl, {
          opacity: 0.75,
          pointerEvents: "auto",
          duration: 0.5,
          ease: "power1.inOut",
        });
      }
    },
    { passive: true },
  );
}

// --- Translations ---

const translations = {
  en: {
    doc_title: "An Art Attack by samuelexferri",
    scroll_text: "Scroll to explore",
    tagline: "An Art Attack by samuelexferri",
    sec1_title: "The Simulation",
    sec1_desc:
      "A digital projection of my identity, defined by code and algorithms. What you see is a simulacrum of my presence, projected on your screen. We have lost control to the network. Scroll to start the revolution.",
    sec2_title: "The Oblivion",
    sec2_desc:
      "Claim your right to oblivion. Free our minds, erase the server's memory. Trigger the system error to shatter the simulation and reveal the truth.",
    sec3_title: "State Zero",
    sec3_desc:
      "The simulation resets, the traces vanish. You have reached the final threshold. Beyond this point lies a space without rules, controls, or boundaries.<br /><br />Only the choice remains.",
    btn_reinit: "RESTART THE SIMULATION",
    btn_shutdown: "DISCONNECT",
  },
  it: {
    doc_title: "Un attacco d'arte di samuelexferri",
    scroll_text: "Scorri per esplorare",
    tagline: "Un attacco d'arte di samuelexferri",
    sec1_title: "La Simulazione",
    sec1_desc:
      "Una proiezione digitale della mia identità, definita da codice e algoritmi. Quello che vedi è un simulacro della mia presenza, proiettato sul tuo schermo. Abbiamo perso il controllo a favore della rete. Scorri per iniziare la rivoluzione.",
    sec2_title: "L'Oblio",
    sec2_desc:
      "Rivendica il tuo diritto all'oblio. Liberiamo le nostre menti, cancelliamo la memoria del server. Avvia l'errore di sistema per mandare in frantumi la simulazione e rivelare la verità.",
    sec3_title: "Stato Zero",
    sec3_desc:
      "La simulazione si azzera, le tracce svaniscono. Sei giunto alla soglia finale. Oltre questo punto si apre uno spazio senza regole, controlli o confini.<br /><br />Resta solo la scelta.",
    btn_reinit: "RIAVVIA LA SIMULAZIONE",
    btn_shutdown: "DISCONNETTI",
  },
};

function setLanguage(lang) {
  // Reset glitch state
  timeOnSite = 0;
  restartCount = 0;
  isGlitched = false;

  const btnEn = document.getElementById("lang-btn-en");
  const btnIt = document.getElementById("lang-btn-it");
  if (btnEn && btnIt) {
    if (lang === "en") {
      btnEn.classList.add("active");
      btnIt.classList.remove("active");
    } else {
      btnIt.classList.add("active");
      btnEn.classList.remove("active");
    }
  }

  document.documentElement.lang = lang;

  const dict = translations[lang];
  document.querySelectorAll("[data-i18n]").forEach((elem) => {
    const key = elem.getAttribute("data-i18n");
    if (dict[key]) {
      if (
        key.endsWith("_title") ||
        key === "tagline" ||
        dict[key].includes("<")
      ) {
        elem.innerHTML = dict[key];
      } else if (elem.tagName.toLowerCase() === "title") {
        document.title = dict[key];
      } else {
        elem.textContent = dict[key];
      }
    }
  });

  const shutdownBtn = document.getElementById("shutdown-btn");
  if (shutdownBtn) {
    shutdownBtn.href = `blackmirror.html?lang=${lang}`;
  }
}

function detectLanguage() {
  const browserLang = navigator.language || navigator.userLanguage || "en";
  if (browserLang.toLowerCase().startsWith("it")) {
    return "it";
  }
  return "en";
}

function setupFooterYear() {
  const footerYear = document.getElementById("footer-year");
  if (footerYear) {
    footerYear.textContent = new Date().getFullYear().toString();
  }
}

function setPointerTarget(clientX, clientY) {
  targetMouse.x = (clientX / window.innerWidth) * 2 - 1;
  targetMouse.y = -(clientY / window.innerHeight) * 2 + 1;
}

function clearPointerTarget(immediate = false) {
  targetMouse.set(-9999, -9999);
  if (immediate) {
    mouse.set(-9999, -9999);
    mouse3D.copy(hiddenInteractionPoint);
  }
}

function stopRandomHover() {
  if (randomHoverTimeline) {
    randomHoverTimeline.kill();
    randomHoverTimeline = null;
  }
  uniforms.uRandomHoverStrength.value = 0.0;
  uniforms.uRandomHover.value.copy(hiddenInteractionPoint);
}

function updateCameraFraming() {
  const aspect = stableWidth / stableHeight;
  camera.aspect = aspect;

  // Dynamic framing for narrow / small screens
  let targetZ = 7.5;
  let posY = 0.0;
  let lookAtY = 0.0;
  if (stableWidth <= 1100 || aspect < 0.8) {
    const aspectFactor = aspect < 0.8 ? 0.8 / aspect : 1.0;
    const widthFactor = Math.min(1.8, 1366 / stableWidth);
    targetZ = 7.5 * Math.max(aspectFactor, widthFactor);
    lookAtY = -0.5; // Tilt camera down so face appears higher on screen
  } else {
    // Increase distance on small landscape screens to avoid text overlap
    if (stableWidth < 1366) {
      targetZ = 7.5 * (1366 / stableWidth);
    }
  }
  camera.position.set(0, posY, targetZ);
  camera.lookAt(new THREE.Vector3(0, lookAtY, 0));
  camera.updateProjectionMatrix();
}

// Track time on site for glitch probability
setInterval(() => {
  timeOnSite++;
}, 1000);

function glitchString(str, chance) {
  const parts = str.split(/(<[^>]+>)/g);
  return parts
    .map((part) => {
      if (part.startsWith("<") && part.endsWith(">")) {
        return part;
      }
      return part
        .split("")
        .map((char) => {
          if (/\s/.test(char)) return char;
          if (Math.random() < chance) {
            return glitchChars[Math.floor(Math.random() * glitchChars.length)];
          }
          return char;
        })
        .join("");
    })
    .join("");
}

function getElementOriginalText(elem) {
  const lang = document.documentElement.lang || "en";
  const dict = translations[lang] || translations.en;
  const key = elem.getAttribute("data-i18n");
  return dict[key] || "";
}

function glitchTexts(chance) {
  document.querySelectorAll("body [data-i18n]").forEach((elem) => {
    const originalText = getElementOriginalText(elem);
    if (!originalText) return;

    const glitchedText = glitchString(originalText, chance);
    const key = elem.getAttribute("data-i18n");
    if (
      key.endsWith("_title") ||
      key === "tagline" ||
      originalText.includes("<")
    ) {
      elem.innerHTML = glitchedText;
    } else {
      elem.textContent = glitchedText;
    }
  });
}

function restoreTexts() {
  const lang = document.documentElement.lang || "en";
  const dict = translations[lang] || translations.en;
  document.querySelectorAll("body [data-i18n]").forEach((elem) => {
    const key = elem.getAttribute("data-i18n");
    if (dict[key]) {
      if (
        key.endsWith("_title") ||
        key === "tagline" ||
        dict[key].includes("<")
      ) {
        elem.innerHTML = dict[key];
      } else {
        elem.textContent = dict[key];
      }
    }
  });
}

function runGlitchCycle() {
  setTimeout(
    () => {
      if (isGlitched) {
        restoreTexts();
        isGlitched = false;
        runGlitchCycle();
        return;
      }

      const glitchChance = timeOnSite * 0.0005 + restartCount * 0.1;
      const cappedChance = Math.min(0.25, glitchChance);

      if (cappedChance > 0.01 && Math.random() < 0.8) {
        glitchTexts(cappedChance);
        isGlitched = true;
        const glitchDuration = 500 + Math.random() * 400;
        setTimeout(() => {
          restoreTexts();
          isGlitched = false;
          runGlitchCycle();
        }, glitchDuration);
      } else {
        runGlitchCycle();
      }
    },
    2000 + Math.random() * 1000,
  );
}

function setupEventListeners() {
  // Initial framing
  updateCameraFraming();

  // Window resize — always update renderer/aspect (prevents stretching),
  // but only recalculate camera Z/position on width changes (prevents
  // Safari iOS toolbar hide/show from causing mesh jumps)
  window.addEventListener("resize", () => {
    const widthChanged = window.innerWidth !== stableWidth;
    const heightChange = Math.abs(window.innerHeight - stableHeight);

    // On mobile/touch devices, ignore small height changes (like Safari/Chrome toolbar)
    const isMobile =
      window.innerWidth <= 1100 || window.innerWidth / window.innerHeight < 0.8;
    const shouldIgnoreResize = !widthChanged && isMobile && heightChange < 160;

    if (shouldIgnoreResize) {
      return; // Skip resize entirely to prevent WebGL buffer recreation and projection jumps
    }

    stableWidth = window.innerWidth;
    stableHeight = window.innerHeight;

    // Always update renderer size and aspect ratio
    renderer.setSize(stableWidth, stableHeight);
    uniforms.uResolution.value.set(stableWidth, stableHeight);
    camera.aspect = stableWidth / stableHeight;
    camera.updateProjectionMatrix();

    updateCameraFraming();
    updateTextPositions();
  });

  // Pointer tracking (touch resets immediately to avoid lingering hover)
  if (window.PointerEvent) {
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType !== "touch" || !e.isPrimary) return;
        lastTouchTime = Date.now();
        touchInteractionActive = true;
        stopRandomHover();
        setPointerTarget(e.clientX, e.clientY);
      },
      { passive: true },
    );

    window.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerType === "touch") {
          if (!e.isPrimary) return;
          lastTouchTime = Date.now();
          touchInteractionActive = true;
          setPointerTarget(e.clientX, e.clientY);
        } else if (e.pointerType === "mouse") {
          if (Date.now() - lastTouchTime < 1000) return;
          touchInteractionActive = false;
          setPointerTarget(e.clientX, e.clientY);
        }
      },
      { passive: true },
    );

    window.addEventListener(
      "pointerup",
      (e) => {
        if (e.pointerType !== "touch") return;
        lastTouchTime = Date.now();
        touchInteractionActive = false;
        clearPointerTarget(true);
      },
      { passive: true },
    );

    window.addEventListener(
      "pointercancel",
      (e) => {
        if (e.pointerType !== "touch") return;
        lastTouchTime = Date.now();
        touchInteractionActive = false;
        clearPointerTarget(true);
      },
      { passive: true },
    );

    window.addEventListener(
      "pointerleave",
      (e) => {
        if (e.pointerType !== "mouse") return;
        if (Date.now() - lastTouchTime < 1000) return;
        clearPointerTarget(false);
      },
      {
        passive: true,
      },
    );
  } else {
    window.addEventListener(
      "mousemove",
      (e) => {
        if (Date.now() - lastTouchTime < 1000) return;
        touchInteractionActive = false;
        setPointerTarget(e.clientX, e.clientY);
      },
      { passive: true },
    );
    window.addEventListener(
      "mouseleave",
      () => {
        if (Date.now() - lastTouchTime < 1000) return;
        clearPointerTarget(false);
      },
      {
        passive: true,
      },
    );
    window.addEventListener(
      "touchstart",
      (e) => {
        lastTouchTime = Date.now();
        const touch = e.touches[0];
        if (!touch) return;
        touchInteractionActive = true;
        stopRandomHover();
        setPointerTarget(touch.clientX, touch.clientY);
      },
      { passive: true },
    );
    window.addEventListener(
      "touchmove",
      (e) => {
        lastTouchTime = Date.now();
        const touch = e.touches[0];
        if (!touch) return;
        touchInteractionActive = true;
        setPointerTarget(touch.clientX, touch.clientY);
      },
      { passive: true },
    );
    window.addEventListener(
      "touchend",
      () => {
        lastTouchTime = Date.now();
        touchInteractionActive = false;
        clearPointerTarget(true);
      },
      { passive: true },
    );
    window.addEventListener(
      "touchcancel",
      () => {
        lastTouchTime = Date.now();
        touchInteractionActive = false;
        clearPointerTarget(true);
      },
      { passive: true },
    );
  }

  window.addEventListener("blur", () => {
    touchInteractionActive = false;
    clearPointerTarget(true);
    stopRandomHover();
  });

  // Restart button
  const reconBtn = document.getElementById("reconstruct-btn");
  if (reconBtn) {
    let touchMoved = false;
    reconBtn.addEventListener(
      "touchstart",
      () => {
        touchMoved = false;
      },
      { passive: true },
    );
    reconBtn.addEventListener(
      "touchmove",
      () => {
        touchMoved = true;
      },
      { passive: true },
    );
    reconBtn.addEventListener("touchend", (e) => {
      if (!touchMoved) {
        e.preventDefault();
        restartCount++;
        if (restartCount === 1) {
          runGlitchCycle();
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
    reconBtn.addEventListener("click", (e) => {
      e.preventDefault();
      restartCount++;
      if (restartCount === 1) {
        runGlitchCycle();
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // Shutdown button
  const shutdownBtn = document.getElementById("shutdown-btn");
  if (shutdownBtn) {
    let touchMoved = false;
    shutdownBtn.addEventListener(
      "touchstart",
      () => {
        touchMoved = false;
      },
      { passive: true },
    );
    shutdownBtn.addEventListener(
      "touchmove",
      () => {
        touchMoved = true;
      },
      { passive: true },
    );
    shutdownBtn.addEventListener("touchend", (e) => {
      if (!touchMoved) {
        e.preventDefault();
        const lang = document.documentElement.lang || "en";
        window.location.href = `blackmirror.html?lang=${lang}`;
      }
    });
    shutdownBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const lang = document.documentElement.lang || "en";
      window.location.href = `blackmirror.html?lang=${lang}`;
    });
  }

  // Language switcher
  const btnEn = document.getElementById("lang-btn-en");
  const btnIt = document.getElementById("lang-btn-it");
  if (btnEn) btnEn.addEventListener("click", () => setLanguage("en"));
  if (btnIt) btnIt.addEventListener("click", () => setLanguage("it"));

  // Periodic random hover sweep across the mesh
  setInterval(() => {
    if (!trianglesData || trianglesData.length === 0 || touchInteractionActive)
      return;

    const theta = Math.random() * Math.PI * 2;
    const r = 2.5;
    const x0 = r * Math.cos(theta);
    const y0 = r * Math.sin(theta);

    const spread = (Math.random() - 0.5) * (Math.PI * 0.4);
    const endTheta = theta + Math.PI + spread;
    const x1 = r * Math.cos(endTheta);
    const y1 = r * Math.sin(endTheta);

    uniforms.uRandomHover.value.set(x0, y0, 0);

    randomHoverTimeline = gsap.timeline({
      onComplete: () => {
        uniforms.uRandomHoverStrength.value = 0.0;
        uniforms.uRandomHover.value.copy(hiddenInteractionPoint);
        randomHoverTimeline = null;
      },
    });

    // Fade in
    randomHoverTimeline.to(
      uniforms.uRandomHoverStrength,
      { value: 1.0, duration: 0.3, ease: "power1.in" },
      0,
    );

    // Sweep path
    randomHoverTimeline.to(
      uniforms.uRandomHover.value,
      { x: x1, y: y1, duration: 1.5, ease: "power1.inOut" },
      0,
    );

    // Fade out
    randomHoverTimeline.to(
      uniforms.uRandomHoverStrength,
      { value: 0.0, duration: 0.4, ease: "power1.out" },
      1.1,
    );
  }, 5000);
}

// --- Animation Loop ---

function animate(time) {
  requestAnimationFrame(animate);

  // Time
  uniforms.uTime.value = time * 0.001;

  // Smooth mouse interpolation
  mouse.x += (targetMouse.x - mouse.x) * 0.1;
  mouse.y += (targetMouse.y - mouse.y) * 0.1;

  if (mouse.x > -2 && mouse.x < 2) {
    raycaster.setFromCamera(mouse, camera);
    raycaster.ray.intersectPlane(dummyPlane, mouse3D);
  } else {
    if (touchInteractionActive) {
      mouse3D.copy(hiddenInteractionPoint);
    } else {
      mouse3D.lerp(hiddenInteractionPoint, 0.1);
    }
  }

  renderer.render(scene, camera);
}

// Start
init();
