// AI Sprite Studio — Reference Pose and T-Pose Grid panels
//
// Local mode only: both read assets/<name>/ from server.mjs. The T-Pose image is
// keyed with its own border colour through the preview's GPU chroma filter.
import * as preview from './preview.js';

/**
 * @param {Record<string, HTMLElement>} els  The editor's element map (refPose*, tpose*, btnCopyTposeUrl).
 * @returns {{ showReferencePose: (charName: string) => Promise<void>, showTpose: (charName: string) => Promise<void> }}
 */
export function createPosePanels(els) {
  let tposeUrl = null; // object URL shown in the T-Pose panel, revoked when replaced
  let tposeRequest = 0; // latest showTpose() call; older ones drop their result

  /** Show the user's original input.png as Reference Pose. */
  async function showReferencePose(charName) {
    const src = `assets/${charName}/input.png`;
    try {
      const res = await fetch(src, { method: 'HEAD' });
      if (res.ok) {
        els.refPoseImg.src = src;
        els.refPoseImg.style.display = 'block';
        els.refPoseInfo.style.display = 'block';
        els.refPosePlaceholder.style.display = 'none';
        els.refPoseFilename.textContent = 'input.png';
        return;
      }
    } catch { /* ignore */ }
    els.refPoseImg.style.display = 'none';
    els.refPoseInfo.style.display = 'none';
    els.refPosePlaceholder.style.display = 'block';
  }

  /** Show generated tpose.png in the T-Pose Grid section (keyed like the sheet) + load its prompt. */
  async function showTpose(charName) {
    const request = ++tposeRequest;
    const src = `assets/${charName}/tpose.png`;
    let blob = null;
    try {
      const response = await fetch(`${src}?_t=${Date.now()}`);
      if (response.ok) blob = await response.blob();
    } catch { /* no server: same as missing */ }
    if (request !== tposeRequest) return;
    if (!blob) {
      els.tposeGenerated.style.display = 'none';
      els.tposePlaceholder.style.display = 'block';
      return;
    }
    els.tposeGenerated.style.display = 'block';
    els.tposePlaceholder.style.display = 'none';
    els.btnCopyTposeUrl.dataset.url = new URL(src, location.href).href;

    const shown = await tposeDisplayBlob(blob);
    if (request !== tposeRequest) return;
    if (tposeUrl) URL.revokeObjectURL(tposeUrl);
    tposeUrl = URL.createObjectURL(shown);
    els.tposeImg.src = tposeUrl;

    // Load generation prompt if available
    try {
      const promptRes = await fetch(`assets/${charName}/prompts/tpose.txt`);
      els.tposePromptText.textContent = promptRes.ok ? (await promptRes.text()).trim() : '(no tpose-prompt.txt found)';
    } catch {
      els.tposePromptText.textContent = '(failed to load prompt)';
    }
  }

  /** The T-Pose image keyed with its own border colour on the GPU, or the original when nothing is keyed. */
  async function tposeDisplayBlob(blob) {
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(blob);
      const keyed = preview.keyedCanvas(bitmap, preview.detectImageKey(bitmap));
      if (!keyed) return blob;
      return await new Promise((resolve) => keyed.toBlob((png) => resolve(png ?? blob), 'image/png'));
    } catch (error) {
      console.warn('Failed to chroma key tpose.png:', error);
      return blob;
    } finally {
      bitmap?.close();
    }
  }

  return { showReferencePose, showTpose };
}
