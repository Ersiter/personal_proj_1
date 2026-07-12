/* Build-only browser runner: turns a DWG into the compact display snapshot. */
import {
  AcApHtmlConvertor,
  AcApHtmlSnapshotBuilder,
  encodeSnapshot,
  resolveAcApHtmlExportOptions
} from '@mlightcad/cad-html-plugin';
import { AcApDocManager, AcEdOpenMode } from '@mlightcad/cad-simple-viewer';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

let ready = false;

async function ensureViewer() {
  if (ready) return;

  AcApDocManager.createInstance({
    container: document.getElementById('cad-root'),
    width: 1280,
    height: 720,
    autoResize: false,
    baseUrl: 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/',
    useMainThreadDraw: true,
    webworkerFileUrls: {
      dxfParser: '/workers/dxf-parser-worker.js',
      dwgParser: '/workers/libredwg-parser-worker.js',
      mtextRender: '/workers/mtext-renderer-worker.js'
    }
  });

  // Ensure CJK fallback glyphs are available before entities turn into geometry.
  await AcApDocManager.instance.loadDefaultFonts();
  ready = true;
}

function readLayerState(layerStore) {
  return layerStore.getLayers().map((layer) => ({
    name: layer.name,
    isOn: Boolean(layer.isOn),
    isFrozen: Boolean(layer.isFrozen)
  }));
}

async function materializeHiddenLayers(layerStore, view, layers) {
  const changedLayers = [];

  for (const layer of layers) {
    if (layer.isFrozen) {
      layerStore.setLayerFrozen(layer.name, false);
      changedLayers.push(layer.name);
    }
    if (!layer.isOn) {
      layerStore.setLayerOn(layer.name, true);
      changedLayers.push(layer.name);
    }
  }

  for (const name of new Set(changedLayers)) {
    if (typeof view.convertMissingEntitiesOnLayer === 'function') {
      await view.convertMissingEntitiesOnLayer(name);
    }
  }

  await nextFrame();
  await nextFrame();
}

function restoreLayerState(layerStore, layers) {
  for (const layer of layers) {
    if (!layer.isOn) layerStore.setLayerOn(layer.name, false);
    if (layer.isFrozen) layerStore.setLayerFrozen(layer.name, true);
  }
}

window.exportCadSnapshot = async (fileName, bytes) => {
  await ensureViewer();

  const manager = AcApDocManager.instance;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const opened = await manager.openDocument(fileName, buffer, { mode: AcEdOpenMode.Read });
  if (!opened) throw new Error(`Failed to open "${fileName}".`);

  const layerStore = manager.curDocument.layerStore;
  const originalLayers = readLayerState(layerStore);

  try {
    await materializeHiddenLayers(layerStore, manager.curView, originalLayers);

    const options = resolveAcApHtmlExportOptions({
      exportInvisibleLayers: true,
      initialView: 'fit'
    });
    const view = await new AcApHtmlConvertor().prepareAcTrView2dForHtmlExport(manager.curView, options);
    const snapshot = await new AcApHtmlSnapshotBuilder().buildAsync(
      view.cadScene,
      manager.curDocument.database,
      {
        title: fileName,
        background: view.backgroundColor,
        locale: 'zh',
        exportInvisibleLayers: true,
        initialView: 'fit'
      }
    );
    const originalByName = new Map(originalLayers.map((layer) => [layer.name, layer]));
    snapshot.layers.forEach((layer) => {
      const original = originalByName.get(layer.name);
      if (original) layer.visible = original.isOn && !original.isFrozen;
    });

    return encodeSnapshot(snapshot);
  } finally {
    restoreLayerState(layerStore, originalLayers);
  }
};
