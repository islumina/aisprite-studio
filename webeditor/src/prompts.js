// AI Sprite Studio — generation prompts for the editor's panels
//
// Local mode shows the prompt an agent would get: a saved prompt file, else the task
// the local server builds with the MCP server's workspace module. A static host has
// neither, so it shows short demo prompts instead.

/** Frame file stem, e.g. `idle_front_03`. */
export const frameName = (animName, frameIdx) => `${animName}_${String(frameIdx).padStart(2, '0')}`;

/** Prompt text plus its reference files, as the panels and clipboard show it. */
export function taskText(task) {
  if (task.error) return `(no generation task: ${task.error})`;
  const references = task.references?.length ? `\n\nReferences:\n${task.references.map((reference) => `  ${reference}`).join('\n')}` : '';
  return `${task.prompt}${references}`;
}

export function demoAnimPrompt(animName) {
  return `Preview-only demo: create a coherent ${animName} animation for the same subject. Keep identity, scale, palette, framing, and baseline stable across every frame. Use a flat chroma background, even lighting, no shadows, no scenery, and no detached effects. The hosted Playground cannot accept files; use the local MCP server for a real asset task.`;
}

/** @param {{ w: number, h: number }} size  Untrimmed frame size. */
export function demoFramePrompt(animName, frameIdx, total, size) {
  return `Preview-only demo: generate ${frameName(animName, frameIdx)}.png, frame ${frameIdx + 1} of ${total}. ${demoPose(animName, frameIdx, total)} Output exactly ${size.w}x${size.h} PNG on a flat chroma background with even lighting, no shadows, no scenery, and no detached effects. Keep identity, scale, palette, framing, and baseline stable. The hosted Playground cannot accept files; use the local MCP server for a validated task.`;
}

function demoPose(animName, frameIdx, total) {
  if (animName === 'idle') return 'Show a subtle breathing or bobbing phase that loops cleanly.';
  if (animName === 'run') return 'Show a distinct running stride phase with continuous forward motion.';
  if (animName === 'hit') return 'Show a readable impact reaction without changing the subject identity.';
  return `Show the intended ${animName} motion at phase ${frameIdx + 1} of ${total}.`;
}

/**
 * Prompt sources for one editor session.
 * @param {{ staticMode: boolean }} options
 */
export function createPromptSource({ staticMode }) {
  /**
   * A generation task from the local server; `{ error }` when it has none, null on a static host.
   * @param {'frame-task'|'animation-task'|'reference-task'} kind
   * @param {Record<string, string>} params
   * @returns {Promise<{ prompt?: string, references?: string[], error?: string } | null>}
   */
  async function fetchTask(kind, params) {
    if (staticMode) return null;
    try {
      const response = await fetch(`/api/${kind}?${new URLSearchParams(params)}`);
      const payload = await response.json();
      return response.ok ? payload : { error: payload.error || `HTTP ${response.status}` };
    } catch {
      return { error: 'local server unavailable' };
    }
  }

  /** A saved prompt file via the dev-server API (always 200, so no console 404). */
  async function fetchSaved(charName, name) {
    if (staticMode) return null;
    try {
      const response = await fetch(`/api/prompt?char=${encodeURIComponent(charName)}&name=${encodeURIComponent(name)}`);
      if (response.ok) {
        const saved = await response.json();
        if (saved.exists) return saved.text.trim();
      }
    } catch { /* no API: fall through to the task or demo prompt */ }
    return null;
  }

  async function animPrompt(charName, animName) {
    const saved = await fetchSaved(charName, animName);
    if (saved) return saved;
    const task = await fetchTask('animation-task', { char: charName, animation: animName });
    return task ? taskText(task) : demoAnimPrompt(animName);
  }

  /** @param {{ w: number, h: number }} size  Untrimmed frame size, for the demo prompt. */
  async function framePrompt(charName, animName, frameIdx, total, size) {
    const saved = await fetchSaved(charName, frameName(animName, frameIdx));
    if (saved) return saved;
    const task = await fetchTask('frame-task', { char: charName, frame: frameName(animName, frameIdx) });
    return task ? taskText(task) : demoFramePrompt(animName, frameIdx, total, size);
  }

  return { fetchTask, animPrompt, framePrompt };
}
