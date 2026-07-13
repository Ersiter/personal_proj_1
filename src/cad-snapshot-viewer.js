/*
 * Read-only MLightCAD snapshot viewer.
 *
 * This is a small MIT-derived runtime built around the official HTML snapshot
 * format. It deliberately excludes the command line, selection, measurement,
 * editing, export, OSNAP, locale controls, and the built-in toolbar.
 */
import { decodeSnapshotBinary } from 'mlightcad-snapshot-codec';
import { gunzipSync } from 'fflate';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const CAMERA_FRUSTUM = 400;
const CAMERA_DISTANCE = 500;
const CAD_BACKGROUND = 0x0D1B2A;
const VIEW_FIT_PADDING = 0.9;

function colorToCss(color) {
  return `#${(color >>> 0).toString(16).padStart(6, '0')}`;
}

function copyFloat32(values) {
  return new Float32Array(values);
}

function copyUint32(values) {
  return new Uint32Array(values);
}

function createLineMaterial(batch) {
  return new THREE.LineBasicMaterial({ color: batch.color });
}

function createPointMaterial(batch) {
  return new THREE.PointsMaterial({ color: batch.color, size: 1, sizeAttenuation: false });
}

function createMeshMaterial(batch) {
  return new THREE.MeshBasicMaterial({ color: batch.color, side: THREE.DoubleSide });
}

function createLineObject(batch) {
  if (batch.positions.length < 6) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(copyFloat32(batch.positions), 3));
  if (batch.indices?.length) geometry.setIndex(new THREE.BufferAttribute(copyUint32(batch.indices), 1));
  const object = new THREE.LineSegments(geometry, createLineMaterial(batch));
  object.position.set(...batch.offset);
  return object;
}

function createPointObject(batch) {
  if (batch.positions.length < 3) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(copyFloat32(batch.positions), 3));
  const object = new THREE.Points(geometry, createPointMaterial(batch));
  object.position.set(...batch.offset);
  return object;
}

function createMeshObject(batch) {
  if (!batch.indices?.length || batch.indices.length < 3) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(copyFloat32(batch.positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(copyUint32(batch.indices), 1));
  if (batch.gradientFill && batch.gradientPositions?.length >= 2) {
    geometry.setAttribute('gradientPosition', new THREE.Float32BufferAttribute(copyFloat32(batch.gradientPositions), 2));
  }
  const object = new THREE.Mesh(geometry, createMeshMaterial(batch));
  object.position.set(...batch.offset);
  return object;
}

function createControls(camera, canvas) {
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.autoRotate = false;
  controls.enableRotate = false;
  controls.zoomSpeed = 1.2;
  controls.zoomToCursor = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: -1, RIGHT: -1 };
  // Rotation is disabled, so DOLLY_ROTATE yields a stable pinch-only gesture.
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.update();
  return controls;
}

function resolveExtents(snapshot) {
  const extents = snapshot.meta.viewExtents ?? snapshot.meta.extents;
  const values = [extents?.minX, extents?.minY, extents?.maxX, extents?.maxY];
  if (!values.every(Number.isFinite) || extents.maxX <= extents.minX || extents.maxY <= extents.minY) {
    throw new Error('图纸范围无效。');
  }
  return { ...extents };
}

/** Fetches one gzip-compressed snapshot and mounts a small, read-only WebGL view. */
export async function createCadSnapshotViewer({ container, snapshotUrl, onLayersChanged, fitOffset = { x: 0, y: 0 } }) {
  const response = await fetch(snapshotUrl);
  if (!response.ok) throw new Error(response.status === 404 ? '图纸暂未发布。' : '图纸快照加载失败。');

  let snapshot;
  try {
    snapshot = decodeSnapshotBinary(gunzipSync(new Uint8Array(await response.arrayBuffer())));
  } catch {
    throw new Error('图纸快照无法读取。');
  }

  let layout = snapshot.layouts.find((item) => item.btrId === snapshot.activeLayoutBtrId) ?? snapshot.layouts[0];
  if (!layout) throw new Error('图纸不包含可显示的布局。');

  const extents = resolveExtents(snapshot);
  const layerState = new Map(snapshot.layers.map((layer) => [layer.name, {
    name: layer.name,
    color: layer.color,
    visible: layer.visible
  }]));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.touchAction = 'none';
  container.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  const getSize = () => ({ width: Math.max(container.clientWidth, 1), height: Math.max(container.clientHeight, 1) });
  const initialSize = getSize();
  const camera = new THREE.OrthographicCamera(-initialSize.width / 2, initialSize.width / 2, initialSize.height / 2, -initialSize.height / 2, 0.1, 1000);
  camera.position.set(0, 0, CAMERA_DISTANCE);
  camera.up.set(0, 1, 0);
  camera.updateProjectionMatrix();

  const controls = createControls(camera, renderer.domElement);
  const groups = new Map();
  const getGroup = (layerName) => {
    let group = groups.get(layerName);
    if (!group) {
      group = new THREE.Group();
      group.name = layerName;
      group.visible = layerState.get(layerName)?.visible !== false;
      groups.set(layerName, group);
      scene.add(group);
    }
    return group;
  };

  for (const batch of layout.lineBatches) {
    const object = createLineObject(batch);
    if (object) getGroup(batch.layer).add(object);
  }
  for (const batch of layout.meshBatches) {
    const object = batch.points ? createPointObject(batch) : createMeshObject(batch);
    if (object) getGroup(batch.layer).add(object);
  }

  const render = () => renderer.render(scene, camera);
  let initialFitPending = true;
  const updateFrustum = (width, height) => {
    const aspect = width / height;
    camera.left = -aspect * CAMERA_FRUSTUM;
    camera.right = aspect * CAMERA_FRUSTUM;
    camera.top = CAMERA_FRUSTUM;
    camera.bottom = -CAMERA_FRUSTUM;
    camera.updateProjectionMatrix();
    controls.update();
  };
  const resize = () => {
    const { width, height } = getSize();
    renderer.setSize(width, height);
    updateFrustum(width, height);
    if (initialFitPending && width > 1 && height > 1) {
      initialFitPending = false;
      zoomToExtents();
      return;
    }
    render();
  };
  const zoomToExtents = () => {
    const { width, height } = getSize();
    const aspect = width / height;
    const spanX = Math.max(extents.maxX - extents.minX, Number.EPSILON);
    const spanY = Math.max(extents.maxY - extents.minY, Number.EPSILON);
    const centerX = (extents.minX + extents.maxX) / 2 + spanX * fitOffset.x;
    const centerY = (extents.minY + extents.maxY) / 2 + spanY * fitOffset.y;
    camera.position.set(centerX, centerY, CAMERA_DISTANCE);
    controls.target.set(centerX, centerY, 0);
    camera.zoom = Math.min(
      (CAMERA_FRUSTUM * 2 * aspect) / spanX,
      (CAMERA_FRUSTUM * 2) / spanY
    ) * VIEW_FIT_PADDING;
    camera.updateProjectionMatrix();
    controls.update();
    render();
  };
  const publishLayers = () => {
    onLayersChanged([...layerState.values()].map((layer) => ({
      name: layer.name,
      isOn: layer.visible,
      cssColor: colorToCss(layer.color)
    })));
  };
  const syncTheme = () => {
    scene.background = new THREE.Color(CAD_BACKGROUND);
    container.style.background = '#0D1B2A';
    render();
  };

  controls.addEventListener('change', () => {
    render();
  });
  renderer.domElement.addEventListener('mousedown', (event) => {
    if (event.button === 1) event.preventDefault();
  }, { capture: true });
  renderer.domElement.addEventListener('auxclick', (event) => {
    if (event.button === 1) event.preventDefault();
  }, { capture: true });
  renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
  new ResizeObserver(resize).observe(container);

  // Geometry has been copied into WebGL buffers; release parse-only references.
  layout = null;
  snapshot = null;
  syncTheme();
  resize();
  publishLayers();

  return {
    setLayerOn(name, isOn) {
      const layer = layerState.get(name);
      if (!layer) return;
      layer.visible = Boolean(isOn);
      const group = groups.get(name);
      if (group) group.visible = layer.visible;
      publishLayers();
      render();
    },
    zoomToExtents,
    syncTheme
  };
}
