import { createCadSnapshotViewer } from './cad-snapshot-viewer.js';

const assetBaseUrl = new URL('./', import.meta.url);
const snapshotUrl = new URL('./floorplan.mlcad', assetBaseUrl);
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
