// AI Sprite Studio — Reference Pose and T-Pose Grid panels
//
// Local mode only: both read assets/<name>/ from server.mjs. The T-Pose image is
// keyed with its own border colour through the preview's GPU chroma filter.
import * as preview from './preview.js';

/**
 * @param {Record<string, HTMLElement>} els  The editor's element map (refPose*, tpose*, btnCopyTposeUrl).
 * @returns {{ showReferencePose: (charName: string, hasInput: boolean) => void, showTpose: (charName: string) => Promise<void> }}
 */
export function createPosePanels(els) {
  let tposeUrl = null; // object URL shown in the T-Pose panel, revoked when replaced
  let tposeRequest = 0; // latest showTpose() call; older ones drop their result

  /** Show the user's original input.png as Reference Pose; /api/assets says whether it exists. */
  function showReferencePose(charName, hasInput) {
    if (hasInput) {
      els.refPoseImg.src = `assets/${charName}/input.png`;
      els.refPoseFilename.textContent = 'input.png';
    }
    els.refPoseImg.style.display = hasInput ? 'block' : 'none';
    els.refPoseInfo.style.display = hasInput ? 'block' : 'none';
    els.refPosePlaceholder.style.display = hasInput ? 'none' : 'block';
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

    els.tposePromptText.textContent = await tposePrompt(charName);
  }

  /** The saved tpose prompt, else the MCP reference task's prompt. Both APIs answer 200 or a JSON error. */
  async function tposePrompt(charName) {
    try {
      const saved = await (await fetch(`/api/prompt?char=${encodeURIComponent(charName)}&name=tpose`)).json();
      if (saved.exists) return saved.text.trim();
      const response = await fetch(`/api/reference-task?char=${encodeURIComponent(charName)}`);
      const task = await response.json();
      return response.ok ? task.prompt : `(no reference task: ${task.error})`;
    } catch {
      return '(failed to load prompt)';
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
