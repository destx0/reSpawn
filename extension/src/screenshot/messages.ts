export const CAPTURE_MESSAGE = 'RESPAWN_SCREENSHOT/CAPTURE';

export type CaptureResponse =
  | { readonly ok: true; readonly dataUrl: string }
  | { readonly ok: false; readonly error: string };

/** Ask the background for a PNG of the visible tab. */
export async function requestCapture(): Promise<CaptureResponse> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: CAPTURE_MESSAGE,
    });
    if (!response) return { ok: false, error: 'No capture response.' };
    return response;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Capture failed.',
    };
  }
}
