import { CAPTURE_MESSAGE } from '../screenshot/messages.js';

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as { type?: unknown }).type !== CAPTURE_MESSAGE
    ) {
      return false;
    }

    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    if (tabId === undefined || windowId === undefined) {
      sendResponse({ ok: false, error: 'No page to capture.' });
      return false;
    }
    if (sender.frameId !== undefined && sender.frameId !== 0) {
      sendResponse({ ok: false, error: 'Capture runs in the top frame only.' });
      return false;
    }

    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      if (chrome.runtime.lastError || tabs[0]?.id !== tabId) {
        sendResponse({
          ok: false,
          error: 'The page is not the active tab.',
        });
        return;
      }
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          sendResponse({
            ok: false,
            error:
              chrome.runtime.lastError?.message ??
              'The browser did not return a screenshot.',
          });
          return;
        }
        sendResponse({ ok: true, dataUrl });
      });
    });
    return true;
  },
);
