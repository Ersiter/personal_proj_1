import { createCadSnapshotViewer } from './cad-snapshot-viewer.js';

const snapshotUrl = 'https://cdn.jsdelivr.net/gh/Ersiter/personal_proj_1@main/assets/cad/floorplan.mlcad';
// Calibrated against the title geometry outside the apartment plan.
const FLOORPLAN_FIT_OFFSET = Object.freeze({ x: 0.02, y: -0.078 });

export function loadCadViewer({ container, onLayersChanged }) {
  return createCadSnapshotViewer({
    container,
    snapshotUrl,
    onLayersChanged,
    fitOffset: FLOORPLAN_FIT_OFFSET
  });
}
