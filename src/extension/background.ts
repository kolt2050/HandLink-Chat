chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
})

let creatingOffscreen: Promise<void> | null = null

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const request = message as { channel?: string; command?: unknown }
  if (request.channel !== 'ui-command') return

  void forwardToOffscreen(request.command)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  return true
})

async function forwardToOffscreen(command: unknown) {
  await ensureOffscreenDocument()
  return chrome.runtime.sendMessage({ channel: 'offscreen-command', command })
}

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return
  creatingOffscreen ??= chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.WEB_RTC, chrome.offscreen.Reason.LOCAL_STORAGE, chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Keep WebRTC chat connections alive while the extension UI refreshes and play mention alerts.'
  }).finally(() => {
    creatingOffscreen = null
  })
  await creatingOffscreen
}
